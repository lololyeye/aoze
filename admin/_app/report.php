<?php
declare(strict_types=1);

// What the Analytics pages read: finished days come from the daily totals, the current day is
// computed from the raw events with the same queries, so both always count the same way.
const REPORT_MAX_DAYS = 760;
const ACTIVE_SECONDS = 5 * 60;
const RECENT_SECONDS = 30 * 60;
const RECENT_LIMIT = 15;
const SERIES_METRICS = ['sessions', 'visitors', 'pageviews', 'downloads', 'requested'];
// Daily totals without a dimension; the others are broken down (an empty dimension is a value too, such as no referrer).
const TOTAL_METRICS = ['sessions', 'visitors', 'returning_sessions', 'bounces', 'engaged_ms', 'pageviews', 'downloads', ...FUNNEL_STEPS];
// Pre-release holding the installer copies that latest.json points to (the updater's downloads).
const UPDATES_TAG = 'updates';

function shift_day(string $day, int $days): string
{
    return (new DateTimeImmutable($day))->modify("$days day")->format('Y-m-d');
}

function day_count(string $from, string $to): int
{
    return (int) (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1;
}

/** @return array{0: string, 1: string} */
function report_range(array $query, string $today): array
{
    $from = is_string($query['from'] ?? null) ? $query['from'] : '';
    $to = is_string($query['to'] ?? null) ? $query['to'] : '';
    foreach ([$from, $to] as $day) {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $day);
        if ($parsed === false || $parsed->format('Y-m-d') !== $day) {
            throw new HttpError(400, 'Période invalide.');
        }
    }
    if ($from > $to || $to > $today || day_count($from, $to) > REPORT_MAX_DAYS) {
        throw new HttpError(422, 'Période non prévue : 25 mois au plus, sans dépasser aujourd\'hui.');
    }
    return [$from, $to];
}

/** @return list<array{0: string, 1: string, 2: string, 3: int}> day, metric, dimension, value */
function period_rows(string $from, string $to, string $today): array
{
    $stmt = analytics_db()->prepare('SELECT day, metric, dimension, value FROM daily WHERE day BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    $rows = array_map(fn (array $r) => [$r[0], $r[1], $r[2], (int) $r[3]], $stmt->fetchAll(PDO::FETCH_NUM));
    if ($from <= $today && $today <= $to) {
        foreach (day_rows($today) as [$metric, $dimension, $value]) {
            $rows[] = [$today, $metric, $dimension, $value];
        }
    }
    return $rows;
}

/**
 * Distinct visitors over the whole period, while its raw visits are still kept. Past the
 * retention period only daily counts remain, and adding them up would count a visitor once a day.
 */
function period_visitors(string $from, string $to, int $now): ?int
{
    $start = day_start($from);
    if ($start < $now - retention_days() * 86400) {
        return null;
    }
    $stmt = analytics_db()->prepare('SELECT COUNT(DISTINCT visitor) FROM sessions WHERE started_at >= ? AND started_at < ?');
    $stmt->execute([$start, day_start(shift_day($to, 1))]);
    return (int) $stmt->fetchColumn();
}

/** @return array<string, mixed> */
function summarise(array $rows, string $from, string $to, int $now, bool $detailed): array
{
    $totals = [];
    $dimensions = [];
    $series = [];
    foreach ($rows as [$day, $metric, $dimension, $value]) {
        if (in_array($metric, TOTAL_METRICS, true)) {
            $totals[$metric] = ($totals[$metric] ?? 0) + $value;
            if (in_array($metric, SERIES_METRICS, true)) {
                $series[$day][$metric] = $value;
            }
        } elseif ($detailed) {
            $dimensions[$metric][$dimension] = ($dimensions[$metric][$dimension] ?? 0) + $value;
        }
    }
    $summary = ['from' => $from, 'to' => $to, 'totals' => (object) $totals, 'visitors' => period_visitors($from, $to, $now)];
    if ($detailed) {
        foreach ($dimensions as &$values) {
            arsort($values);
        }
        $summary['dimensions'] = (object) array_map(fn (array $v) => (object) $v, $dimensions);
    }
    $summary['series'] = [];
    for ($day = $from; $day <= $to; $day = shift_day($day, 1)) {
        $summary['series'][] = ['day' => $day] + ($series[$day] ?? []) + array_fill_keys(SERIES_METRICS, 0);
    }
    return $summary;
}

/**
 * Installer downloads counted by GitHub, dated by the snapshots: each rise of a counter is
 * credited to the day it was seen. The first snapshot of a file only sets its starting point.
 *
 * @return array{since: ?string, series: list<array{day: string, installer: int, updater: int}>}
 */
function github_series(string $from, string $to): array
{
    $db = analytics_db();
    $first = $db->query('SELECT MIN(at) FROM github_counts')->fetchColumn();
    $stmt = $db->prepare('SELECT at, tag, asset, downloads FROM github_counts WHERE at < ? ORDER BY tag, asset, at');
    $stmt->execute([day_start(shift_day($to, 1))]);
    $days = [];
    $previous = [];
    foreach ($stmt->fetchAll() as $row) {
        if (preg_match(INSTALLER_FILE, $row['asset']) !== 1) {
            continue;
        }
        $key = "{$row['tag']}/{$row['asset']}";
        $count = (int) $row['downloads'];
        $day = local_day((int) $row['at']);
        if (isset($previous[$key]) && $day >= $from && $count > $previous[$key]) {
            $kind = $row['tag'] === UPDATES_TAG ? 'updater' : 'installer';
            $days[$day][$kind] = ($days[$day][$kind] ?? 0) + $count - $previous[$key];
        }
        $previous[$key] = $count;
    }
    $series = [];
    for ($day = $from; $day <= $to; $day = shift_day($day, 1)) {
        $series[] = ['day' => $day, 'installer' => $days[$day]['installer'] ?? 0, 'updater' => $days[$day]['updater'] ?? 0];
    }
    return ['since' => $first === null ? null : iso((int) $first), 'series' => $series];
}

/** @return array<string, mixed> */
function analytics_report(array $query): array
{
    $now = time();
    $today = local_day($now);
    [$from, $to] = report_range($query, $today);
    // Finished days that the hourly upkeep has not stored yet are stored now.
    aggregate_days($now);
    $length = day_count($from, $to);
    $previousTo = shift_day($from, -1);
    $previousFrom = shift_day($previousTo, 1 - $length);
    $firstDay = analytics_db()->query('SELECT MIN(day) FROM daily')->fetchColumn();
    $firstVisit = analytics_db()->query('SELECT MIN(started_at) FROM sessions')->fetchColumn();
    $since = array_filter([$firstDay ?: null, $firstVisit === null ? null : local_day((int) $firstVisit)]);
    return [
        'enabled' => analytics_enabled(),
        'today' => $today,
        'measuredSince' => $since === [] ? null : min($since),
        'current' => summarise(period_rows($from, $to, $today), $from, $to, $now, true),
        'previous' => summarise(period_rows($previousFrom, $previousTo, $today), $previousFrom, $previousTo, $now, false),
        'github' => github_series($from, $to),
    ];
}

/** Visits active in the last five minutes and the latest pages read, without any identifier. */
function analytics_live(): array
{
    $now = time();
    $db = analytics_db();
    $active = $db->prepare('SELECT COUNT(*) FROM sessions WHERE last_at >= ?');
    $active->execute([$now - ACTIVE_SECONDS]);
    $recent = $db->prepare('SELECT p.at, p.path, s.country FROM pageviews p JOIN sessions s ON s.id = p.session_id WHERE p.at >= ? ORDER BY p.at DESC LIMIT ' . RECENT_LIMIT);
    $recent->execute([$now - RECENT_SECONDS]);
    return [
        'active' => (int) $active->fetchColumn(),
        'recent' => array_map(fn (array $r) => ['at' => iso((int) $r['at']), 'path' => $r['path'], 'country' => $r['country']], $recent->fetchAll()),
    ];
}
