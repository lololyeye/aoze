<?php
declare(strict_types=1);

// Private data lives next to public_html, never inside it: ~/aoze-admin holds config.php,
// the SQLite database and the error log. AOZE_ADMIN_DIR overrides it for local development.
const IDLE_SECONDS = 30 * 60;
const SESSION_MAX_SECONDS = 12 * 3600;
const COOKIE_NAME = '__Host-aoze_admin';

function private_dir(): string
{
    static $dir = null;
    return $dir ??= rtrim(getenv('AOZE_ADMIN_DIR') ?: dirname(__DIR__, 3) . '/aoze-admin', '/\\');
}

/** @return array{setup_token: string, origin: string, github_token: string, public_dir: string} */
function config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $file = private_dir() . '/config.php';
    $values = is_file($file) ? require $file : [];
    if (!is_array($values)) {
        $values = [];
    }
    return $config = [
        'setup_token' => is_string($values['setup_token'] ?? null) ? $values['setup_token'] : '',
        'origin' => is_string($values['origin'] ?? null) ? rtrim($values['origin'], '/') : 'https://aoze.fr',
        // Optional, read-only: lifts GitHub's limit of 60 requests an hour per server address.
        'github_token' => is_string($values['github_token'] ?? null) ? $values['github_token'] : '',
        // Where the public site lives; the published banner is written there as announcement.json.
        'public_dir' => is_string($values['public_dir'] ?? null) ? $values['public_dir'] : dirname(private_dir()) . '/public_html',
    ];
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $dir = private_dir();
    if (!is_dir($dir)) {
        throw new RuntimeException("Private directory missing: $dir");
    }
    $pdo = new PDO('sqlite:' . $dir . '/admin.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version < 1) {
        $pdo->exec(<<<'SQL'
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            totp_secret TEXT,
            totp_pending TEXT,
            totp_last_step INTEGER NOT NULL DEFAULT 0,
            password_changed_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            csrf TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            ip TEXT NOT NULL,
            user_agent TEXT NOT NULL
        );
        CREATE TABLE login_attempts (
            id INTEGER PRIMARY KEY,
            at INTEGER NOT NULL,
            ip TEXT NOT NULL,
            email TEXT NOT NULL,
            success INTEGER NOT NULL,
            user_agent TEXT NOT NULL
        );
        CREATE INDEX login_attempts_ip ON login_attempts (ip, at);
        CREATE INDEX login_attempts_email ON login_attempts (email, at);
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            at INTEGER NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            ip TEXT NOT NULL
        );
        PRAGMA user_version = 1;
        SQL);
    }
    if ($version < 2) {
        $pdo->exec(<<<'SQL'
            CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            PRAGMA user_version = 2;
            SQL);
    }
}

/** Details go to the private log; the browser only ever gets a generic message. */
function log_error(Throwable $e): void
{
    $line = sprintf("[%s] %s: %s in %s:%d\n", date('c'), $e::class, $e->getMessage(), $e->getFile(), $e->getLine());
    @file_put_contents(private_dir() . '/error.log', $line, FILE_APPEND | LOCK_EX);
}
