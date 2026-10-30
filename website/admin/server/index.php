<?php
declare(strict_types=1);

// Front controller for https://aoze.fr/admin/. /admin/api/* answers JSON; anything else gets
// the dashboard shell, which holds no data: everything it shows comes from the API, and every
// API route checks the session on the server.
require __DIR__ . '/_app/bootstrap.php';
require __DIR__ . '/_app/http.php';
require __DIR__ . '/_app/totp.php';
require __DIR__ . '/_app/auth.php';
require __DIR__ . '/_app/api.php';
require __DIR__ . '/_app/integrations.php';
require __DIR__ . '/_app/announcement.php';

send_security_headers();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$api = preg_match('#^/admin/api/([a-z0-9/-]+)$#', $path, $m) ? $m[1] : null;

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
