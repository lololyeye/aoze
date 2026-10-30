<?php
declare(strict_types=1);

const HISTORY_LIMIT = 100;

/** Short, readable device label from a user agent; the full string is kept in the database. */
function device_label(string $agent): string
{
    $browser = match (true) {
        str_contains($agent, 'Edg/') => 'Edge',
        str_contains($agent, 'Firefox/') => 'Firefox',
        str_contains($agent, 'Chrome/') => 'Chrome',
        str_contains($agent, 'Safari/') => 'Safari',
        default => 'Navigateur',
    };
    $system = match (true) {
        str_contains($agent, 'Windows') => 'Windows',
        str_contains($agent, 'iPhone') || str_contains($agent, 'iPad') => 'iOS',
        str_contains($agent, 'Android') => 'Android',
        str_contains($agent, 'Mac OS') => 'macOS',
        str_contains($agent, 'Linux') => 'Linux',
        default => 'inconnu',
    };
    return "$browser · $system";
}

function iso(int $timestamp): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $timestamp);
}

/** @return array<string, mixed> */
function security_settings(int $userId): array
{
    $stmt = db()->prepare('SELECT totp_secret, password_changed_at FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    return [
        'twoFactor' => $user['totp_secret'] !== null,
        'passwordChangedAt' => iso((int) $user['password_changed_at']),
        'idleMinutes' => intdiv(IDLE_SECONDS, 60),
    ];
}

/** Checks the password again before a sensitive change, with the same rate limit as signing in. */
function confirm_password(array $admin, string $password): void
{
    check_rate_limit($admin['email']);
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$admin['id']]);
    if (!password_verify($password, (string) $stmt->fetchColumn())) {
        record_attempt($admin['email'], false);
        throw new HttpError(403, 'Mot de passe incorrect.');
    }
}

function handle_api(string $method, string $route): never
{
    $key = "$method $route";
    switch ($key) {
        case 'GET session':
            if (!admin_exists()) {
                json_response(200, ['state' => 'setup', 'setupReady' => strlen(config()['setup_token']) >= 24]);
            }
            $session = current_session();
            json_response(200, $session === null
                ? ['state' => 'signed-out']
                : ['state' => 'signed-in', 'email' => $session['email'], 'role' => $session['role'], 'csrf' => $session['csrf']]);

        case 'POST setup':
            require_same_origin();
            $in = json_input();
            setup(input_string($in, 'token'), trim(input_string($in, 'email', 254)), input_string($in, 'password', 1024));
            json_response(201, ['ok' => true]);

        case 'POST login':
            require_same_origin();
            $in = json_input();
            login(trim(input_string($in, 'email', 254)), input_string($in, 'password', 1024), trim(input_string($in, 'code', 12)));
            json_response(200, ['ok' => true]);

        case 'POST logout':
            $admin = require_admin(write: true);
            db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$admin['session_id']]);
            audit($admin['id'], 'Déconnexion');
            clear_cookie();
            json_response(200, ['ok' => true]);

        case 'GET security':
            $admin = require_admin();
            json_response(200, security_settings($admin['id']));

        case 'POST password':
            $admin = require_admin(write: true);
            $in = json_input();
            confirm_password($admin, input_string($in, 'current', 1024));
            $next = input_string($in, 'next', 1024);
            check_new_password($next);
            db()->prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')->execute([hash_password($next), time(), $admin['id']]);
            // Every other session is closed: a stolen session does not survive a password change.
            db()->prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')->execute([$admin['id'], $admin['session_id']]);
            audit($admin['id'], 'Mot de passe modifié', 'Les autres sessions ont été fermées');
            json_response(200, ['ok' => true]);

        case 'POST 2fa/start':
            $admin = require_admin(write: true);
            $secret = totp_new_secret();
            db()->prepare('UPDATE users SET totp_pending = ? WHERE id = ?')->execute([$secret, $admin['id']]);
            json_response(200, ['secret' => $secret, 'uri' => totp_uri($secret, $admin['email'])]);

        case 'POST 2fa/confirm':
            $admin = require_admin(write: true);
            $code = trim(input_string(json_input(), 'code', 12));
            $stmt = db()->prepare('SELECT totp_pending FROM users WHERE id = ?');
            $stmt->execute([$admin['id']]);
            $pending = $stmt->fetchColumn();
            $step = is_string($pending) ? totp_verify($pending, $code, 0) : null;
            if ($step === null) {
                throw new HttpError(422, 'Code incorrect. Vérifiez l\'heure de votre téléphone et réessayez.');
            }
            db()->prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?')->execute([$step, $admin['id']]);
            audit($admin['id'], 'Double authentification activée');
            json_response(200, security_settings($admin['id']));

        case 'POST 2fa/disable':
            $admin = require_admin(write: true);
            $in = json_input();
            confirm_password($admin, input_string($in, 'password', 1024));
            $stmt = db()->prepare('SELECT totp_secret, totp_last_step FROM users WHERE id = ?');
            $stmt->execute([$admin['id']]);
            $user = $stmt->fetch();
            if ($user['totp_secret'] === null || totp_verify($user['totp_secret'], trim(input_string($in, 'code', 12)), (int) $user['totp_last_step']) === null) {
                throw new HttpError(422, 'Code incorrect.');
            }
            db()->prepare('UPDATE users SET totp_secret = NULL, totp_last_step = 0 WHERE id = ?')->execute([$admin['id']]);
            audit($admin['id'], 'Double authentification désactivée');
            json_response(200, security_settings($admin['id']));

        case 'GET sessions':
            $admin = require_admin();
            $stmt = db()->prepare('SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC');
            $stmt->execute([$admin['id']]);
            json_response(200, array_map(fn (array $s) => [
                'id' => (string) $s['id'],
                'createdAt' => iso((int) $s['created_at']),
                'lastSeenAt' => iso((int) $s['last_seen_at']),
                'ip' => $s['ip'],
                'device' => device_label($s['user_agent']),
                'current' => (int) $s['id'] === $admin['session_id'],
            ], $stmt->fetchAll()));

        case 'POST sessions/revoke':
            $admin = require_admin(write: true);
            $id = (int) input_string(json_input(), 'id', 20);
            if ($id === $admin['session_id']) {
                throw new HttpError(422, 'Pour fermer cette session, déconnectez-vous.');
            }
            $stmt = db()->prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
            $stmt->execute([$id, $admin['id']]);
            if ($stmt->rowCount() === 1) {
                audit($admin['id'], 'Session fermée', 'Fermée à distance');
            }
            json_response(200, ['ok' => true]);

        case 'GET logins':
            $admin = require_admin();
            $stmt = db()->prepare('SELECT at, ip, success, user_agent FROM login_attempts WHERE email = ? ORDER BY at DESC LIMIT ' . HISTORY_LIMIT);
            $stmt->execute([strtolower($admin['email'])]);
            json_response(200, array_map(fn (array $l) => [
                'at' => iso((int) $l['at']),
                'ip' => $l['ip'],
                'success' => (bool) $l['success'],
                'device' => device_label($l['user_agent']),
            ], $stmt->fetchAll()));

        case 'GET activity':
            require_admin();
            $rows = db()->query('SELECT at, action, detail FROM audit_log ORDER BY id DESC LIMIT ' . HISTORY_LIMIT)->fetchAll();
            json_response(200, array_map(fn (array $a) => ['at' => iso((int) $a['at']), 'action' => $a['action'], 'detail' => $a['detail']], $rows));

        case 'GET releases':
            require_admin();
            json_response(200, releases());

        case 'GET manifest':
            require_admin();
            json_response(200, manifest());

        case 'GET build':
            require_admin();
            json_response(200, website_run());

        case 'GET deploy':
            require_admin();
            json_response(200, deploy_status());

        case 'GET certificates':
            require_admin();
            json_response(200, certificates());

        case 'GET pages':
            require_admin();
            json_response(200, page_status());

        case 'GET server':
            require_admin();
            json_response(200, server_status());

        case 'GET announcement':
            require_admin();
            json_response(200, ['data' => announcement(), 'fetchedAt' => iso(time())]);

        case 'POST announcement':
            $admin = require_admin(write: true);
            json_response(200, ['data' => save_announcement($admin, json_input()), 'fetchedAt' => iso(time())]);

        default:
            throw new HttpError(404, 'Introuvable.');
    }
}
