<?php
declare(strict_types=1);

// The two public endpoints, reached through the site's .htaccess: /e receives the events sent
// by the site's script, /get/<installer> records a download request and sends it on to GitHub.
const OPT_OUT_COOKIE = 'aoze_optout';
const INSTALLER_FILE = '/^Aoze_(\d+\.\d+\.\d+)_x64-setup\.exe$/';
const SESSION_FLAGS = ['ds' => 'saw_download', 'dc' => 'clicked', 'dk' => 'confirmed'];
const MAX_ENGAGED_MS = 30 * 60 * 1000;

function is_public_route(string $path): bool
{
    return $path === '/e' || str_starts_with($path, '/get/');
}

function handle_public(string $path): never
{
    try {
        $path === '/e' ? collect_event() : download_redirect(substr($path, strlen('/get/')));
    } catch (Throwable $e) {
        log_error($e);
    }
    finish_public();
}

/** Ends the response, then gives the server its hourly upkeep without making anyone wait. */
function finish_public(): never
{
    if (http_response_code() === 200) {
        http_response_code(204);
    }
    header('Cache-Control: no-store');
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    try {
        analytics_maintenance();
    } catch (Throwable $e) {
        log_error($e);
    }
    exit;
}

/** Opted out, asking browsers not to be tracked, a robot, or the owner (who holds the /admin key). */
function is_counted(): bool
{
    $agent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    return analytics_enabled()
        && !is_bot($agent)
        && ($_COOKIE[OPT_OUT_COOKIE] ?? '') !== '1'
        && ($_SERVER['HTTP_SEC_GPC'] ?? '') !== '1'
        && ($_SERVER['HTTP_DNT'] ?? '') !== '1'
        && !has_gate_cookie();
}

function collect_event(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        header('Allow: POST');
        return;
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referrer = $_SERVER['HTTP_REFERER'] ?? '';
    if ($origin !== '' ? $origin !== config()['origin'] : !str_starts_with($referrer, config()['origin'] . '/')) {
        return;
    }
    $in = json_decode((string) file_get_contents('php://input', length: 4096), true);
    $kind = is_array($in) && is_string($in['t'] ?? null) ? $in['t'] : '';
    if ($kind === 'optout' || $kind === 'optin') {
        set_opt_out($kind === 'optout');
        return;
    }
    $path = is_string($in['p'] ?? null) && preg_match('#^/(?!/)[A-Za-z0-9/_.%-]{0,200}$#', $in['p']) === 1 ? $in['p'] : null;
    if ($path === null || !is_counted() || !within_rate()) {
        return;
    }
    $text = fn (string $key, int $max) => is_string($in[$key] ?? null) ? mb_substr($in[$key], 0, $max) : '';
    match ($kind) {
        'pv' => record_pageview($path, in_array($in['l'] ?? '', ['fr', 'en'], true) ? $in['l'] : '', $text('r', 500), $text('u', 500)),
        'en' => record_engagement($path, is_int($in['ms'] ?? null) ? max(0, min($in['ms'], MAX_ENGAGED_MS)) : 0),
        'ds', 'dc', 'dk' => record_step($path, $kind),
        default => null,
    };
}

function set_opt_out(bool $out): void
{
    $options = ['path' => '/', 'secure' => true, 'samesite' => 'Lax'];
    setcookie(OPT_OUT_COOKIE, $out ? '1' : '', $options + ['expires' => $out ? time() + VISITOR_SECONDS : 1]);
    if ($out) {
        setcookie(VISITOR_COOKIE, '', $options + ['expires' => 1, 'httponly' => true]);
    }
}

function visitor_cookie(): ?string
{
    $cookie = $_COOKIE[VISITOR_COOKIE] ?? '';
    return is_string($cookie) && preg_match('/^[a-f0-9]{32}$/', $cookie) === 1 ? $cookie : null;
}

/** The visit still going on for this browser: its last event is less than 30 minutes old. */
function current_visit(): ?array
{
    $cookie = visitor_cookie();
    if ($cookie === null) {
        return null;
    }
    $stmt = analytics_db()->prepare('SELECT id, source_type, source FROM sessions WHERE visitor = ? AND last_at >= ? ORDER BY last_at DESC LIMIT 1');
    $stmt->execute([keyed_hash("visitor|$cookie"), time() - SESSION_GAP_SECONDS]);
    return $stmt->fetch() ?: null;
}

function record_pageview(string $path, string $lang, string $referrer, string $query): void
{
    $now = time();
    $db = analytics_db();
    $visit = current_visit();
    if ($visit === null) {
        $cookie = visitor_cookie();
        $returning = $cookie !== null;
        if ($cookie === null) {
            // Set once and never extended: it expires 13 months after the first visit.
            $cookie = bin2hex(random_bytes(16));
            setcookie(VISITOR_COOKIE, $cookie, ['expires' => $now + VISITOR_SECONDS, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
        }
        $agent = agent_traits((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
        $source = traffic_source($referrer, $query);
        $db->prepare(<<<'SQL'
            INSERT INTO sessions (visitor, started_at, last_at, returning_visitor, country, device, browser, os, lang,
                source_type, source, medium, campaign, entry_path, exit_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL)->execute([
            keyed_hash("visitor|$cookie"), $now, $now, (int) $returning, country_of(client_ip()),
            $agent['device'], $agent['browser'], $agent['os'], $lang,
            $source['source_type'], $source['source'], $source['medium'], $source['campaign'], $path, $path,
        ]);
        $visit = ['id' => (int) $db->lastInsertId()];
    }
    $db->prepare('INSERT INTO pageviews (session_id, at, path, lang) VALUES (?, ?, ?, ?)')->execute([$visit['id'], $now, $path, $lang]);
    $db->prepare('UPDATE sessions SET pageviews = pageviews + 1, exit_path = ?, last_at = ? WHERE id = ?')->execute([$path, $now, $visit['id']]);
}

/** Time the page was actually visible, sent when it is hidden or left. */
function record_engagement(string $path, int $ms): void
{
    $visit = current_visit();
    if ($visit === null || $ms === 0) {
        return;
    }
    $db = analytics_db();
    $db->prepare('UPDATE pageviews SET engaged_ms = engaged_ms + ? WHERE id = (SELECT id FROM pageviews WHERE session_id = ? AND path = ? ORDER BY at DESC, id DESC LIMIT 1)')
        ->execute([$ms, $visit['id'], $path]);
    $db->prepare('UPDATE sessions SET engaged_ms = engaged_ms + ?, last_at = ? WHERE id = ?')->execute([$ms, time(), $visit['id']]);
}

/** Download funnel steps: the button seen, clicked, then the install notice confirmed. */
function record_step(string $path, string $kind): void
{
    $visit = current_visit();
    if ($visit === null) {
        return;
    }
    $now = time();
    $db = analytics_db();
    $db->prepare('INSERT INTO events (session_id, at, kind, path) VALUES (?, ?, ?, ?)')->execute([$visit['id'], $now, $kind, $path]);
    $db->prepare('UPDATE sessions SET ' . SESSION_FLAGS[$kind] . ' = 1, last_at = ? WHERE id = ?')->execute([$now, $visit['id']]);
}

/**
 * The installer stays on GitHub Releases: this records the request and redirects there. Whether
 * the file then arrives in full cannot be known from here.
 */
function download_redirect(string $file): void
{
    if (preg_match(INSTALLER_FILE, $file, $m) !== 1) {
        not_found();
    }
    header('Cache-Control: no-store');
    header('Location: ' . DOWNLOAD_PREFIX . "v{$m[1]}/$file", true, 302);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET' || !is_counted() || !within_rate()) {
        return;
    }
    $visit = current_visit();
    $source = $visit ?? traffic_source((string) ($_SERVER['HTTP_REFERER'] ?? ''), '');
    $agent = agent_traits((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $now = time();
    $db = analytics_db();
    $db->prepare('INSERT INTO downloads (session_id, at, version, file, country, device, browser, os, source_type, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$visit['id'] ?? null, $now, $m[1], $file, country_of(client_ip()), $agent['device'], $agent['browser'], $agent['os'], $source['source_type'], $source['source']]);
    if ($visit !== null) {
        $db->prepare('UPDATE sessions SET requested = 1, last_at = ? WHERE id = ?')->execute([$now, $visit['id']]);
    }
}
