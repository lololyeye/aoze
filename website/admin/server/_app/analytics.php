<?php
declare(strict_types=1);

// First-party audience measurement for aoze.fr, kept within the CNIL's consent exemption:
// statistics for the site only, a first-party visitor cookie of 13 months at most that is
// never extended, no IP address stored (it only gives a country, then is dropped), raw
// events purged after the retention period (25 months at most), and visitors can opt out.
const VISITOR_COOKIE = 'aoze_v';
const VISITOR_SECONDS = 395 * 86400;
const SESSION_GAP_SECONDS = 30 * 60;
const DEFAULT_RETENTION_DAYS = 180;
const RETENTION_CHOICES = [90, 180, 365, 760];
const EVENTS_PER_MINUTE = 60;
const TIMEZONE = 'Europe/Paris';

function analytics_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $pdo = new PDO('sqlite:' . private_dir() . '/analytics.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;');
    migrate_analytics($pdo);
    return $pdo;
}

function migrate_analytics(PDO $pdo): void
{
    if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() >= 1) {
        return;
    }
    $pdo->exec(<<<'SQL'
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            visitor TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            last_at INTEGER NOT NULL,
            returning_visitor INTEGER NOT NULL,
            country TEXT NOT NULL,
            device TEXT NOT NULL,
            browser TEXT NOT NULL,
            os TEXT NOT NULL,
            lang TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source TEXT NOT NULL,
            medium TEXT NOT NULL,
            campaign TEXT NOT NULL,
            entry_path TEXT NOT NULL,
            exit_path TEXT NOT NULL,
            pageviews INTEGER NOT NULL DEFAULT 0,
            engaged_ms INTEGER NOT NULL DEFAULT 0,
            saw_download INTEGER NOT NULL DEFAULT 0,
            clicked INTEGER NOT NULL DEFAULT 0,
            confirmed INTEGER NOT NULL DEFAULT 0,
            requested INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX sessions_started ON sessions (started_at);
        CREATE INDEX sessions_visitor ON sessions (visitor, last_at);
        CREATE TABLE pageviews (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            at INTEGER NOT NULL,
            path TEXT NOT NULL,
            lang TEXT NOT NULL,
            engaged_ms INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX pageviews_at ON pageviews (at);
        CREATE INDEX pageviews_session ON pageviews (session_id);
        CREATE TABLE events (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            at INTEGER NOT NULL,
            kind TEXT NOT NULL,
            path TEXT NOT NULL
        );
        CREATE INDEX events_at ON events (at, kind);
        CREATE INDEX events_session ON events (session_id);
        CREATE TABLE downloads (
            id INTEGER PRIMARY KEY,
            session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
            at INTEGER NOT NULL,
            version TEXT NOT NULL,
            file TEXT NOT NULL,
            country TEXT NOT NULL,
            device TEXT NOT NULL,
            browser TEXT NOT NULL,
            os TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source TEXT NOT NULL
        );
        CREATE INDEX downloads_at ON downloads (at);
        CREATE INDEX downloads_session ON downloads (session_id);
        CREATE TABLE github_counts (
            at INTEGER NOT NULL,
            tag TEXT NOT NULL,
            asset TEXT NOT NULL,
            downloads INTEGER NOT NULL,
            PRIMARY KEY (tag, asset, at)
        ) WITHOUT ROWID;
        CREATE TABLE daily (
            day TEXT NOT NULL,
            metric TEXT NOT NULL,
            dimension TEXT NOT NULL,
            value INTEGER NOT NULL,
            PRIMARY KEY (day, metric, dimension)
        ) WITHOUT ROWID;
        CREATE TABLE rate (
            minute INTEGER NOT NULL,
            client TEXT NOT NULL,
            hits INTEGER NOT NULL,
            PRIMARY KEY (minute, client)
        ) WITHOUT ROWID;
        PRAGMA user_version = 1;
        SQL);
}

function meta_get(string $key, string $default = ''): string
{
    $stmt = analytics_db()->prepare('SELECT value FROM meta WHERE key = ?');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : (string) $value;
}

function meta_set(string $key, string $value): void
{
    analytics_db()->prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')->execute([$key, $value]);
}

/** Off until the owner turns it on from the admin, once the privacy policy says what is measured. */
function analytics_enabled(): bool
{
    return meta_get('enabled') === '1';
}

function retention_days(): int
{
    $days = (int) meta_get('retention_days', (string) DEFAULT_RETENTION_DAYS);
    return in_array($days, RETENTION_CHOICES, true) ? $days : DEFAULT_RETENTION_DAYS;
}

/**
 * Secret for the keyed hashes, in its own file so a copy of the database alone cannot link a
 * stored visitor to a browser's cookie.
 */
function analytics_key(): string
{
    static $key = null;
    if ($key !== null) {
        return $key;
    }
    $file = private_dir() . '/analytics.key';
    if (!is_file($file)) {
        $fresh = random_bytes(32);
        if (@file_put_contents($file, $fresh, LOCK_EX) === 32) {
            @chmod($file, 0600);
        }
    }
    $stored = @file_get_contents($file);
    if (!is_string($stored) || strlen($stored) !== 32) {
        throw new RuntimeException('analytics.key cannot be read');
    }
    return $key = $stored;
}

function keyed_hash(string $value): string
{
    return substr(hash_hmac('sha256', $value, analytics_key()), 0, 32);
}

function local_day(int $timestamp): string
{
    return (new DateTimeImmutable("@$timestamp"))->setTimezone(new DateTimeZone(TIMEZONE))->format('Y-m-d');
}

/** Link previews, crawlers and scripts: their visits are not people's. */
function is_bot(string $agent): bool
{
    return $agent === '' || preg_match('/bot|crawl|spider|slurp|preview|externalhit|embedly|headless|lighthouse|monitor|curl|wget|python|java\/|go-http|okhttp|discord|whatsapp|telegram|skype/i', $agent) === 1;
}

/** @return array{device: string, browser: string, os: string} */
function agent_traits(string $agent): array
{
    return [
        'device' => match (true) {
            preg_match('/iPad|Tablet|Android(?!.*Mobile)/', $agent) === 1 => 'tablet',
            preg_match('/Mobi|iPhone|Android/', $agent) === 1 => 'mobile',
            default => 'desktop',
        },
        'browser' => match (true) {
            str_contains($agent, 'Edg/') => 'Edge',
            str_contains($agent, 'OPR/') || str_contains($agent, 'Opera') => 'Opera',
            str_contains($agent, 'SamsungBrowser/') => 'Samsung Internet',
            str_contains($agent, 'Firefox/') || str_contains($agent, 'FxiOS/') => 'Firefox',
            str_contains($agent, 'Chrome/') || str_contains($agent, 'CriOS/') => 'Chrome',
            str_contains($agent, 'Safari/') => 'Safari',
            default => 'Autre',
        },
        'os' => match (true) {
            str_contains($agent, 'Windows') => 'Windows',
            preg_match('/iPhone|iPad|iPod/', $agent) === 1 => 'iOS',
            str_contains($agent, 'Android') => 'Android',
            str_contains($agent, 'CrOS') => 'ChromeOS',
            str_contains($agent, 'Mac OS') => 'macOS',
            str_contains($agent, 'Linux') => 'Linux',
            default => 'Autre',
        },
    ];
}

const SEARCH_ENGINES = ['google.', 'bing.com', 'duckduckgo.com', 'yahoo.', 'ecosia.org', 'qwant.com', 'yandex.', 'baidu.com', 'search.brave.com', 'startpage.com', 'perplexity.ai'];

/**
 * Where a visit comes from: UTM parameters first, then the referring site. No referrer means
 * direct; links opened from apps (Discord's, for one) often arrive that way too.
 *
 * @return array{source_type: string, source: string, medium: string, campaign: string}
 */
function traffic_source(string $referrer, string $query): array
{
    parse_str(ltrim($query, '?'), $params);
    $utm = fn (string $name) => is_string($params[$name] ?? null) ? mb_substr(strtolower(trim($params[$name])), 0, 80) : '';
    if ($utm('utm_source') !== '') {
        return ['source_type' => 'campaign', 'source' => $utm('utm_source'), 'medium' => $utm('utm_medium'), 'campaign' => $utm('utm_campaign')];
    }
    $host = strtolower((string) parse_url($referrer, PHP_URL_HOST));
    $host = preg_replace('/^(www|m|l|lm)\./', '', $host) ?? $host;
    $type = match (true) {
        $host === '' || in_array($host, SITE_HOSTS, true) => 'direct',
        $host === 'discord.com' || $host === 'discordapp.com' || $host === 'discord.gg' => 'discord',
        $host === 'tiktok.com' || str_ends_with($host, '.tiktok.com') => 'tiktok',
        array_filter(SEARCH_ENGINES, fn ($engine) => str_contains($host, $engine)) !== [] => 'search',
        default => 'website',
    };
    return ['source_type' => $type, 'source' => $type === 'direct' ? '' : $host, 'medium' => '', 'campaign' => ''];
}

/** Country from the local DB-IP database (_app/maintenance.php keeps it current); the address goes no further. */
function country_of(string $ip): string
{
    $packed = @inet_pton($ip);
    $file = private_dir() . '/geo.sqlite';
    if ($packed === false || !is_file($file)) {
        return '';
    }
    try {
        $geo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $stmt = $geo->prepare('SELECT stop, country FROM ranges WHERE start <= ? ORDER BY start DESC LIMIT 1');
        $stmt->bindValue(1, ip_key($packed), PDO::PARAM_LOB);
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return '';
    }
    return $row !== false && strcmp((string) $row['stop'], ip_key($packed)) >= 0 && $row['country'] !== 'ZZ' ? (string) $row['country'] : '';
}

/** IPv4 addresses as IPv4-mapped IPv6, so both families compare as 16-byte keys. */
function ip_key(string $packed): string
{
    return strlen($packed) === 4 ? str_repeat("\0", 10) . "\xff\xff" . $packed : $packed;
}

/** Caps how much one address can write, counted by a keyed hash that is purged within minutes. */
function within_rate(): bool
{
    $minute = intdiv(time(), 60);
    $client = keyed_hash('rate|' . client_ip());
    $db = analytics_db();
    $db->prepare('INSERT INTO rate (minute, client, hits) VALUES (?, ?, 1) ON CONFLICT (minute, client) DO UPDATE SET hits = hits + 1')->execute([$minute, $client]);
    $stmt = $db->prepare('SELECT hits FROM rate WHERE minute = ? AND client = ?');
    $stmt->execute([$minute, $client]);
    return (int) $stmt->fetchColumn() <= EVENTS_PER_MINUTE;
}
