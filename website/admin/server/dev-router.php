<?php
declare(strict_types=1);

// Local development only (`php -S` has no .htaccess): like .htaccess, every request goes to
// index.php. Never deployed.
$_SERVER['SCRIPT_NAME'] = '/admin/index.php';
require __DIR__ . '/index.php';
