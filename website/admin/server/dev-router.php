<?php
declare(strict_types=1);

// Local development only (`php -S` has no .htaccess): the same rules as .htaccess. Never deployed.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (preg_match('#^/admin/_app(/|$)#', $path)) {
    http_response_code(403);
    exit;
}
$_SERVER['SCRIPT_NAME'] = '/admin/index.php';
require __DIR__ . '/index.php';
