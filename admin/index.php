<?php
declare(strict_types=1);

// Front controller for everything under https://aoze.fr/admin, and for the two public endpoints
// the site's .htaccess sends here (/e and /get/, _app/collect.php). Without the access key's cookie
// (_app/gate.php) every path answers as a missing page. Past it: /admin/api/* answers JSON,
// /admin/assets/* serves the built files, /admin/ the dashboard shell, which holds no data:
// everything it shows comes from the API, and every API route checks the session on the server.
require __DIR__ . '/_app/bootstrap.php';
require __DIR__ . '/_app/http.php';
require __DIR__ . '/_app/gate.php';
require __DIR__ . '/_app/totp.php';
require __DIR__ . '/_app/auth.php';
require __DIR__ . '/_app/api.php';
require __DIR__ . '/_app/integrations.php';
require __DIR__ . '/_app/announcement.php';
require __DIR__ . '/_app/analytics.php';
require __DIR__ . '/_app/collect.php';
require __DIR__ . '/_app/maintenance.php';
require __DIR__ . '/_app/report.php';

const ASSET_TYPES = ['js' => 'text/javascript', 'css' => 'text/css', 'woff2' => 'font/woff2', 'svg' => 'image/svg+xml'];

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$route = str_starts_with($path, '/admin') ? substr($path, strlen('/admin')) : $path;

if (is_public_route($path)) {
    handle_public($path);
}

if (!gate_open()) {
    not_found();
}

if (preg_match('#^/assets/([A-Za-z0-9_-]+\.(js|css|woff2|svg))$#', $route, $m) && is_file(__DIR__ . "/assets/{$m[1]}")) {
    header('Content-Type: ' . ASSET_TYPES[$m[2]]);
    header('Cache-Control: public, max-age=31536000, immutable');
    readfile(__DIR__ . "/assets/{$m[1]}");
    exit;
}

$api = preg_match('#^/api/([a-z0-9/-]+)$#', $route, $m) ? $m[1] : null;
if ($api === null && $route !== '' && $route !== '/') {
    not_found();
}

send_security_headers();

if ($api === null) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/_app/shell.html');
    exit;
}

try {
    handle_api($_SERVER['REQUEST_METHOD'] ?? 'GET', $api);
} catch (HttpError $e) {
    foreach ($e->headers as $name => $value) {
        header("$name: $value");
    }
    json_response($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    log_error($e);
    json_response(500, ['error' => 'Erreur du serveur.']);
}
