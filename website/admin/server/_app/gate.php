<?php
declare(strict_types=1);

// Hides /admin entirely. Without the access key's cookie, every path under /admin (shell, API,
// assets) answers exactly like a page that does not exist on the site, so nobody can tell the
// dashboard is there or reach its sign-in. Opening /admin/?key=<access_key> once sets the cookie
// on that device. Changing access_key in config.php locks out every device at once.
const GATE_COOKIE = '__Host-aoze_gate';
const GATE_SECONDS = 365 * 86400;

function gate_token(string $key): string
{
    return hash_hmac('sha256', 'aoze-admin-gate', $key);
}

function gate_enabled(): bool
{
    return config()['access_key'] !== '';
}

/** True when the visitor may see the admin; handles the one-time ?key= visit. */
function gate_open(): bool
{
    $key = config()['access_key'];
    if ($key === '') {
        return true;
    }
    $sent = $_GET['key'] ?? null;
    if ($sent !== null) {
        if (!is_string($sent) || !hash_equals($key, $sent)) {
            return false;
        }
        setcookie(GATE_COOKIE, gate_token($key), [
            'expires' => time() + GATE_SECONDS,
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        // The key leaves the address bar (and the history) straight away.
        header('Location: /admin/', true, 302);
        exit;
    }
    return has_gate_cookie();
}

function has_gate_cookie(): bool
{
    $key = config()['access_key'];
    $cookie = $_COOKIE[GATE_COOKIE] ?? '';
    return $key !== '' && is_string($cookie) && hash_equals(gate_token($key), $cookie);
}

/** The site's own 404 page with the same status and headers Apache gives any unknown path. */
function not_found(): never
{
    http_response_code(404);
    // PHP would otherwise append "; charset=UTF-8", which Apache's own 404 does not send.
    ini_set('default_charset', '');
    header('Content-Type: text/html');
    header('Cache-Control: no-cache');
    $page = rtrim(config()['public_dir'], '/\\') . '/404.html';
    if (is_file($page)) {
        readfile($page);
    }
    exit;
}
