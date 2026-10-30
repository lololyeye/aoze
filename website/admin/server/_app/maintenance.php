<?php
declare(strict_types=1);

// Hourly upkeep, run after a public request has been answered (no cron to set up): daily
// totals, purges, GitHub's download counters and the monthly country database.
const MAINTENANCE_SECONDS = 3600;
const HISTORY_DAYS = 760;
const ADMIN_LOGIN_DAYS = 90;
const AUDIT_DAYS = 365;
const GEO_URL = 'https://download.db-ip.com/free/dbip-country-lite-%s.csv.gz';
const GEO_MIN_RANGES = 100_000;
const FUNNEL_STEPS = ['saw_download', 'clicked', 'confirmed', 'requested'];
const SESSION_DIMENSIONS = ['country', 'device', 'browser', 'os', 'lang', 'source_type', 'source', 'campaign'];

function analytics_maintenance(): void
{
    $now = time();
    $db = analytics_db();
    $db->exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('maintenance_at', '0')");
    // Only one request claims each run.
    $claim = $db->prepare("UPDATE meta SET value = ? WHERE key = 'maintenance_at' AND CAST(value AS INTEGER) < ?");
    $claim->execute([(string) $now, $now - MAINTENANCE_SECONDS]);
    if ($claim->rowCount() !== 1) {
        return;
    }
    ignore_user_abort(true);
    set_time_limit(300);
    foreach (['aggregate_days', 'purge_expired', 'snapshot_github_counts', 'refresh_geo'] as $task) {
        try {
            $task($now);
        } catch (Throwable $e) {
            log_error($e);
        }
    }
}

function day_start(string $day): int
{
    return (new DateTimeImmutable($day, new DateTimeZone(TIMEZONE)))->getTimestamp();
}

/** Totals for every finished day, so charts never have to scan months of raw events. */
function aggregate_days(int $now): void
{
    $today = local_day($now);
    $done = meta_get('aggregated_through');
    if ($done === '') {
        $first = analytics_db()->query('SELECT MIN(at) FROM (SELECT MIN(started_at) AS at FROM sessions UNION ALL SELECT MIN(at) FROM downloads)')->fetchColumn();
        $done = local_day(($first === null ? $now : (int) $first) - 86400);
    }
    $day = (new DateTimeImmutable($done))->modify('+1 day')->format('Y-m-d');
    while ($day < $today) {
        aggregate_day($day);
        meta_set('aggregated_through', $day);
        $day = (new DateTimeImmutable($day))->modify('+1 day')->format('Y-m-d');
    }
}

/**
 * Every daily total of one day, computed from the raw events. The report also uses it for the
 * current day, which is only stored once it is over.
 *
 * @return list<array{0: string, 1: string, 2: int}>
 */
function day_rows(string $day): array
{
    $sessions = 'FROM sessions WHERE started_at >= :s AND started_at < :e';
    $pageviews = 'FROM pageviews WHERE at >= :s AND at < :e';
    $downloads = 'FROM downloads WHERE at >= :s AND at < :e';
    $queries = [
        "SELECT 'sessions', '', COUNT(*) $sessions",
        "SELECT 'visitors', '', COUNT(DISTINCT visitor) $sessions",
        "SELECT 'returning_sessions', '', COUNT(*) $sessions AND returning_visitor = 1",
        "SELECT 'bounces', '', COUNT(*) $sessions AND pageviews <= 1",
        "SELECT 'engaged_ms', '', COALESCE(SUM(engaged_ms), 0) $sessions",
        "SELECT 'pageviews', '', COUNT(*) $pageviews",
        "SELECT 'page', path, COUNT(*) $pageviews GROUP BY path",
        "SELECT 'page_engaged_ms', path, SUM(engaged_ms) $pageviews GROUP BY path",
        "SELECT 'page_lang', lang, COUNT(*) $pageviews GROUP BY lang",
        "SELECT 'entry', entry_path, COUNT(*) $sessions GROUP BY entry_path",
        "SELECT 'exit', exit_path, COUNT(*) $sessions GROUP BY exit_path",
        "SELECT 'downloads', '', COUNT(*) $downloads",
        "SELECT 'download_version', version, COUNT(*) $downloads GROUP BY version",
        "SELECT 'download_os', os, COUNT(*) $downloads GROUP BY os",
        "SELECT 'download_source', source_type, COUNT(*) $downloads GROUP BY source_type",
    ];
    foreach (SESSION_DIMENSIONS as $dimension) {
        $queries[] = "SELECT '$dimension', $dimension, COUNT(*) $sessions GROUP BY $dimension";
    }
    foreach (FUNNEL_STEPS as $step) {
        $queries[] = "SELECT '$step', '', COALESCE(SUM($step), 0) $sessions";
        $queries[] = "SELECT '{$step}_by_source', source_type, SUM($step) $sessions GROUP BY source_type";
        $queries[] = "SELECT '{$step}_by_lang', lang, SUM($step) $sessions GROUP BY lang";
    }

    $db = analytics_db();
    $bounds = [':s' => day_start($day), ':e' => (new DateTimeImmutable($day, new DateTimeZone(TIMEZONE)))->modify('+1 day')->getTimestamp()];
    $rows = [];
    foreach ($queries as $sql) {
        $stmt = $db->prepare($sql);
        $stmt->execute($bounds);
        foreach ($stmt->fetchAll(PDO::FETCH_NUM) as [$metric, $dimension, $value]) {
            $rows[] = [$metric, (string) $dimension, (int) $value];
        }
    }
    return $rows;
}

function aggregate_day(string $day): void
{
    $db = analytics_db();
    $rows = day_rows($day);
    $insert = $db->prepare('INSERT OR REPLACE INTO daily (day, metric, dimension, value) VALUES (?, ?, ?, ?)');
    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM daily WHERE day = ?')->execute([$day]);
        foreach ($rows as [$metric, $dimension, $value]) {
            $insert->execute([$day, $metric, $dimension, $value]);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

/** Raw events go after the retention period; only anonymous daily totals stay, 25 months at most. */
function purge_expired(int $now): void
{
    $db = analytics_db();
    $cutoff = $now - retention_days() * 86400;
    $db->prepare('DELETE FROM sessions WHERE last_at < ?')->execute([$cutoff]);
    $db->prepare('DELETE FROM downloads WHERE at < ?')->execute([$cutoff]);
    $db->prepare('DELETE FROM daily WHERE day < ?')->execute([local_day($now - HISTORY_DAYS * 86400)]);
    $db->prepare('DELETE FROM github_counts WHERE at < ?')->execute([$now - HISTORY_DAYS * 86400]);
    $db->prepare('DELETE FROM rate WHERE minute < ?')->execute([intdiv($now, 60) - 1]);
    db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$now - ADMIN_LOGIN_DAYS * 86400]);
    db()->prepare('DELETE FROM audit_log WHERE at < ?')->execute([$now - AUDIT_DAYS * 86400]);
}

/** GitHub only gives running totals; a row is kept each time one changes, which dates the downloads. */
function snapshot_github_counts(int $now): void
{
    $db = analytics_db();
    $latest = [];
    foreach ($db->query('SELECT tag, asset, downloads FROM github_counts g WHERE at = (SELECT MAX(at) FROM github_counts WHERE tag = g.tag AND asset = g.asset)') as $row) {
        $latest["{$row['tag']}/{$row['asset']}"] = (int) $row['downloads'];
    }
    $insert = $db->prepare('INSERT OR REPLACE INTO github_counts (at, tag, asset, downloads) VALUES (?, ?, ?, ?)');
    foreach (github_releases()['data'] as $release) {
        foreach ($release['assets'] as $asset) {
            if (($latest["{$release['tag_name']}/{$asset['name']}"] ?? -1) !== (int) $asset['download_count']) {
                $insert->execute([$now, $release['tag_name'], $asset['name'], (int) $asset['download_count']]);
            }
        }
    }
}

/** DB-IP's free country database (CC BY 4.0) is published monthly; it is checked at most once a day. */
function refresh_geo(int $now): void
{
    $month = gmdate('Y-m', $now);
    if (meta_get('geo_month') === $month || (int) meta_get('geo_tried_at', '0') > $now - 86400) {
        return;
    }
    meta_set('geo_tried_at', (string) $now);
    foreach ([$month, gmdate('Y-m', strtotime('first day of last month', $now))] as $candidate) {
        [$status, $body] = http_get(sprintf(GEO_URL, $candidate));
        if ($status === 200) {
            import_geo($body);
            meta_set('geo_month', $candidate);
            return;
        }
    }
}

function import_geo(string $gzipped): void
{
    $dir = private_dir();
    $archive = "$dir/geo.csv.gz";
    $building = "$dir/geo.sqlite.new";
    file_put_contents($archive, $gzipped);
    @unlink($building);
    try {
        $geo = new PDO("sqlite:$building", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $geo->exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
            CREATE TABLE ranges (start BLOB PRIMARY KEY, stop BLOB NOT NULL, country TEXT NOT NULL) WITHOUT ROWID;');
        $insert = $geo->prepare('INSERT OR REPLACE INTO ranges (start, stop, country) VALUES (?, ?, ?)');
        $csv = fopen("compress.zlib://$archive", 'r');
        $count = 0;
        $geo->beginTransaction();
        while (($row = fgetcsv($csv, escape: '')) !== false) {
            $start = @inet_pton((string) ($row[0] ?? ''));
            $stop = @inet_pton((string) ($row[1] ?? ''));
            if ($start === false || $stop === false || preg_match('/^[A-Z]{2}$/', (string) ($row[2] ?? '')) !== 1) {
                continue;
            }
            $insert->bindValue(1, ip_key($start), PDO::PARAM_LOB);
            $insert->bindValue(2, ip_key($stop), PDO::PARAM_LOB);
            $insert->bindValue(3, $row[2]);
            $insert->execute();
            $count++;
        }
        $geo->commit();
        fclose($csv);
        $insert = $geo = null;
        if ($count < GEO_MIN_RANGES) {
            throw new RuntimeException("geo database too small: $count ranges");
        }
        if (!rename($building, "$dir/geo.sqlite")) {
            throw new RuntimeException('geo database could not be put in place');
        }
    } finally {
        @unlink($archive);
        @unlink($building);
    }
}
