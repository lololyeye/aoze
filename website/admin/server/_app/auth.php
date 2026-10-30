<?php
declare(strict_types=1);

const FAILS_PER_IP = 5;
const FAILS_PER_EMAIL = 10;
const FAIL_WINDOW_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 12;
const GENERIC_LOGIN_ERROR = 'Identifiants incorrects.';

/** @return array{id: int, email: string, role: string, csrf: string, session_id: int}|null */
function current_session(): ?array
{
    static $resolved = false;
    static $session = null;
    if ($resolved) {
        return $session;
    }
    $resolved = true;
    $token = $_COOKIE[COOKIE_NAME] ?? '';
    if (!is_string($token) || strlen($token) !== 43) {
        return null;
    }
    $row = db()->prepare(
        'SELECT s.id AS session_id, s.csrf, s.created_at, s.last_seen_at, u.id, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
    );
    $row->execute([hash('sha256', $token)]);
    $found = $row->fetch();
    if (!$found) {
        return null;
    }
    $now = time();
    if ($now - $found['last_seen_at'] > IDLE_SECONDS || $now - $found['created_at'] > SESSION_MAX_SECONDS) {
        db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$found['session_id']]);
        clear_cookie();
        return null;
    }
    if ($now - $found['last_seen_at'] >= 60) {
        db()->prepare('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?')->execute([$now, client_ip(), $found['session_id']]);
    }
    return $session = [
        'id' => (int) $found['id'],
        'email' => $found['email'],
        'role' => $found['role'],
        'csrf' => $found['csrf'],
        'session_id' => (int) $found['session_id'],
    ];
}

/**
 * Every administrative endpoint starts here. Reads need a valid session; writes also need the
 * same origin and the session's CSRF token in the X-CSRF-Token header.
 *
 * @return array{id: int, email: string, role: string, csrf: string, session_id: int}
 */
function require_admin(bool $write = false): array
{
    $session = current_session();
    if ($session === null) {
        throw new HttpError(401, 'Session expirée. Reconnectez-vous.');
    }
    if ($write) {
        require_same_origin();
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($sent) || !hash_equals($session['csrf'], $sent)) {
            throw new HttpError(403, 'Jeton de sécurité invalide. Rechargez la page.');
        }
    }
    return $session;
}

function start_session(int $userId): void
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $now = time();
    db()->prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([hash('sha256', $token), $userId, bin2hex(random_bytes(32)), $now, $now, client_ip(), user_agent()]);
    setcookie(COOKIE_NAME, $token, [
        'expires' => $now + SESSION_MAX_SECONDS,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function clear_cookie(): void
{
    setcookie(COOKIE_NAME, '', ['expires' => 1, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
}

function audit(?int $userId, string $action, string $detail = ''): void
{
    db()->prepare('INSERT INTO audit_log (at, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)')
        ->execute([time(), $userId, $action, $detail, client_ip()]);
}

function hash_password(string $password): string
{
    return password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
}

function check_new_password(string $password): void
{
    if (mb_strlen($password) < MIN_PASSWORD_LENGTH) {
        throw new HttpError(422, 'Le mot de passe doit faire au moins ' . MIN_PASSWORD_LENGTH . ' caractères.');
    }
}

function admin_exists(): bool
{
    return (bool) db()->query('SELECT 1 FROM users LIMIT 1')->fetchColumn();
}

/** Too many recent failures from this address, or on this account: refuse before checking anything. */
function check_rate_limit(string $email): void
{
    $since = time() - FAIL_WINDOW_SECONDS;
    $byIp = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND success = 0 AND at > ?');
    $byIp->execute([client_ip(), $since]);
    $byEmail = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE email = ? AND success = 0 AND at > ?');
    $byEmail->execute([strtolower($email), $since]);
    if ((int) $byIp->fetchColumn() >= FAILS_PER_IP || (int) $byEmail->fetchColumn() >= FAILS_PER_EMAIL) {
        throw new HttpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.', ['Retry-After' => (string) FAIL_WINDOW_SECONDS]);
    }
}

function record_attempt(string $email, bool $success): void
{
    db()->prepare('INSERT INTO login_attempts (at, ip, email, success, user_agent) VALUES (?, ?, ?, ?, ?)')
        ->execute([time(), client_ip(), strtolower($email), $success ? 1 : 0, user_agent()]);
}

function login(string $email, string $password, string $code): void
{
    check_rate_limit($email);
    $stmt = db()->prepare('SELECT id, password_hash, totp_secret, totp_last_step FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    // Unknown addresses still pay for a hash check (a hash of random bytes nobody knows), so
    // timing does not reveal which accounts exist.
    $hash = $user['password_hash'] ?? '$argon2id$v=19$m=65536,t=4,p=1$TFYvMWtBNEd5UXl6eTV3ZQ$c9KpPFo+aE4ruIbgUsYJqJL9UDewe7I6naKS3NxdSKA';
    $passwordOk = password_verify($password, $hash) && $user !== false;
    $step = null;
    if ($passwordOk && $user['totp_secret'] !== null) {
        $step = totp_verify($user['totp_secret'], $code, (int) $user['totp_last_step']);
    }
    if (!$passwordOk || ($user['totp_secret'] !== null && $step === null)) {
        record_attempt($email, false);
        if ($user !== false) {
            audit((int) $user['id'], 'Connexion refusée', $passwordOk ? 'Code de double authentification incorrect' : 'Mot de passe incorrect');
        }
        throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    if ($step !== null) {
        db()->prepare('UPDATE users SET totp_last_step = ? WHERE id = ?')->execute([$step, $user['id']]);
    }
    if (password_needs_rehash($user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([hash_password($password), $user['id']]);
    }
    record_attempt($email, true);
    start_session((int) $user['id']);
    audit((int) $user['id'], 'Connexion', $step !== null ? 'Avec double authentification' : 'Sans double authentification');
}

/**
 * Creates the one administrator. Only possible while no account exists and with the one-time
 * token from config.php; the token is then useless and should be removed from the file.
 */
function setup(string $token, string $email, string $password): void
{
    $expected = config()['setup_token'];
    check_rate_limit('setup');
    if (strlen($expected) < 24 || !hash_equals($expected, $token)) {
        record_attempt('setup', false);
        throw new HttpError(403, 'Code de mise en place incorrect.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new HttpError(422, 'Adresse e-mail invalide.');
    }
    check_new_password($password);
    $pdo = db();
    $pdo->beginTransaction();
    if (admin_exists()) {
        $pdo->rollBack();
        throw new HttpError(409, 'Le compte administrateur existe déjà.');
    }
    $now = time();
    $pdo->prepare('INSERT INTO users (email, password_hash, password_changed_at, created_at) VALUES (?, ?, ?, ?)')
        ->execute([$email, hash_password($password), $now, $now]);
    $id = (int) $pdo->lastInsertId();
    $pdo->commit();
    audit($id, 'Compte créé', $email);
    start_session($id);
}
