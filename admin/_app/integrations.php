<?php
declare(strict_types=1);

const REPO = 'lololyeye/aoze';
const DOWNLOAD_PREFIX = 'https://github.com/' . REPO . '/releases/download/';
const SITE_URL = 'https://aoze.fr';
const SITE_HOSTS = ['aoze.fr', 'www.aoze.fr'];
const SITE_PAGES = ['/', '/fr/', '/download/', '/fr/download/', '/legal/'];
const INSTALLER_PATTERN = '/_x64-setup\.exe$/i';

/** @return array{0: int, 1: string, 2: int} status, body, milliseconds */
function http_get(string $url, array $headers = [], bool $follow = true): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => $follow,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_USERAGENT => 'aoze-admin',
        CURLOPT_HTTPHEADER => $headers,
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        throw new RuntimeException("GET $url: " . curl_error($ch));
    }
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), (string) $body, (int) round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000)];
}

/**
 * The value from $load, kept $ttl seconds. When a refresh fails, the last good value is served
 * with its own date, so a GitHub hiccup shows as "updated 20 minutes ago", not as an error.
 *
 * @return array{data: mixed, fetchedAt: string}
 */
function cached(string $key, int $ttl, callable $load, string $failure): array
{
    $stmt = db()->prepare('SELECT value, fetched_at FROM cache WHERE key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if ($row && time() - (int) $row['fetched_at'] < $ttl) {
        return ['data' => json_decode($row['value'], true), 'fetchedAt' => iso((int) $row['fetched_at'])];
    }
    try {
        $data = $load();
    } catch (Throwable $e) {
        log_error($e);
        if ($row) {
            return ['data' => json_decode($row['value'], true), 'fetchedAt' => iso((int) $row['fetched_at'])];
        }
        throw new HttpError(502, $failure);
    }
    db()->prepare('INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at')
        ->execute([$key, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), time()]);
    return ['data' => $data, 'fetchedAt' => iso(time())];
}

/** Without a token GitHub allows 60 requests an hour per address, shared on a hosting server. */
function github(string $path, string $accept = 'application/vnd.github+json'): mixed
{
    $headers = ["Accept: $accept", 'X-GitHub-Api-Version: 2022-11-28'];
    if (config()['github_token'] !== '') {
        $headers[] = 'Authorization: Bearer ' . config()['github_token'];
    }
    [$status, $body] = http_get('https://api.github.com/repos/' . REPO . $path, $headers);
    if ($status !== 200) {
        throw new RuntimeException("GitHub $path: HTTP $status");
    }
    return json_decode($body, true, flags: JSON_THROW_ON_ERROR);
}

/** GitHub's release list, fetched once for the history, the downloads and the latest.json check. */
function github_releases(): array
{
    return cached('releases', 600, fn () => github('/releases?per_page=100', 'application/vnd.github.full+json'),
        'GitHub ne répond pas pour les releases. Réessayez dans quelques minutes.');
}

/** @return list<array<string, mixed>> */
function map_releases(array $list): array
{
    $out = [];
    foreach ($list as $r) {
        if ($r['draft']) {
            continue;
        }
        $installers = array_values(array_filter($r['assets'], fn ($a) => preg_match(INSTALLER_PATTERN, $a['name'])));
        $own = array_values(array_filter($installers, fn ($a) => str_contains($a['browser_download_url'], "/releases/download/{$r['tag_name']}/")));
        $asset = $own[0] ?? $installers[0] ?? null;
        $out[] = [
            'tag' => $r['tag_name'],
            'version' => ltrim($r['tag_name'], 'v'),
            'name' => $r['name'] ?: $r['tag_name'],
            'publishedAt' => $r['published_at'],
            'url' => $r['html_url'],
            'prerelease' => $r['prerelease'],
            'installer' => $asset === null ? null : [
                'name' => $asset['name'],
                'size' => $asset['size'],
                'downloads' => $asset['download_count'],
                'sha256' => str_starts_with((string) ($asset['digest'] ?? ''), 'sha256:') ? substr($asset['digest'], 7) : null,
                'url' => $asset['browser_download_url'],
            ],
            'downloads' => array_sum(array_column($installers, 'download_count')),
            'assets' => array_map(fn ($a) => ['name' => $a['name'], 'size' => $a['size'], 'downloads' => $a['download_count']], $r['assets']),
            'notesHtml' => $r['body_html'] ?? null,
        ];
    }
    return $out;
}

function releases(): array
{
    $raw = github_releases();
    return ['data' => map_releases($raw['data']), 'fetchedAt' => $raw['fetchedAt']];
}

/**
 * What installed copies of Aoze download, checked against the published release the way the
 * updater does: same version, an official download URL, and the file's size and SHA-256.
 */
function load_manifest(): array
{
    [$status, $body] = http_get('https://github.com/' . REPO . '/releases/latest/download/latest.json');
    if ($status !== 200) {
        throw new RuntimeException("latest.json: HTTP $status");
    }
    $manifest = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
    $platform = $manifest['platforms']['windows-x86_64'] ?? [];
    $version = (string) ($manifest['version'] ?? '');
    $url = (string) ($platform['url'] ?? '');
    $sha256 = strtolower((string) ($platform['sha256'] ?? ''));
    $size = (int) ($platform['size'] ?? 0);

    $raw = github_releases()['data'];
    $latest = null;
    $asset = null;
    foreach ($raw as $r) {
        if (!$r['draft'] && !$r['prerelease'] && $latest === null) {
            $latest = ['version' => ltrim($r['tag_name'], 'v')];
        }
        foreach ($r['assets'] as $a) {
            if ($a['browser_download_url'] === $url) {
                $digest = (string) ($a['digest'] ?? '');
                $asset = ['size' => $a['size'], 'sha256' => str_starts_with($digest, 'sha256:') ? substr($digest, 7) : null];
            }
        }
    }

    $file = basename(parse_url($url, PHP_URL_PATH) ?: '');
    $signed = base64_decode((string) ($platform['signature'] ?? ''), true) ?: '';
    preg_match('/trusted comment: .*file:(\S+)\s+version:(\S+)/', $signed, $m);

    $checks = [
        ['label' => 'Version', 'ok' => $latest !== null && $latest['version'] === $version,
            'detail' => $latest === null ? 'Aucune release publiée.' : "latest.json annonce $version, la dernière release est {$latest['version']}."],
        ['label' => 'Adresse', 'ok' => str_starts_with($url, DOWNLOAD_PREFIX),
            'detail' => str_starts_with($url, DOWNLOAD_PREFIX) ? 'Dans les releases du dépôt, la seule source que l\'application accepte.' : 'Hors des releases du dépôt : l\'application refusera la mise à jour.'],
        ['label' => 'Fichier', 'ok' => $asset !== null,
            'detail' => $asset !== null ? 'Le fichier existe sur GitHub.' : 'Aucun fichier publié à cette adresse.'],
        ['label' => 'SHA-256', 'ok' => $asset !== null && $asset['sha256'] !== null && hash_equals($asset['sha256'], $sha256),
            'detail' => $asset === null ? 'Rien à comparer.' : ($asset['sha256'] === null ? 'GitHub n\'indique pas d\'empreinte pour ce fichier.' : ($asset['sha256'] === $sha256 ? 'Identique à l\'empreinte calculée par GitHub.' : 'Différente de l\'empreinte calculée par GitHub.'))],
        ['label' => 'Taille', 'ok' => $asset !== null && $asset['size'] === $size,
            'detail' => $asset === null ? 'Rien à comparer.' : ($asset['size'] === $size ? 'Identique au fichier publié.' : 'Différente du fichier publié.')],
        ['label' => 'Signature', 'ok' => isset($m[1]) && $m[1] === $file && $m[2] === $version,
            'detail' => isset($m[1]) ? "Signée pour {$m[1]}, version {$m[2]}. L'application vérifie la signature elle-même avant d'installer." : 'Absente ou illisible.'],
    ];
    return ['version' => $version, 'url' => $url, 'sha256' => $sha256, 'size' => $size, 'checks' => $checks];
}

function manifest(): array
{
    return cached('manifest', 600, 'load_manifest', 'latest.json est injoignable pour le moment.');
}

function website_run(): array
{
    return cached('website-run', 120, function () {
        $run = github('/actions/workflows/website.yml/runs?per_page=1')['workflow_runs'][0] ?? null;
        return $run === null ? null : [
            'status' => $run['status'],
            'conclusion' => $run['conclusion'],
            'commit' => $run['head_sha'],
            'event' => $run['event'],
            'updatedAt' => $run['updated_at'],
            'url' => $run['html_url'],
        ];
    }, 'GitHub ne répond pas pour la construction du site.');
}

/** Commit a bare repository's HEAD points to, refs possibly packed by `git gc`. */
function git_head(string $gitDir): ?string
{
    $head = @file_get_contents("$gitDir/HEAD");
    if ($head === false) {
        return null;
    }
    $head = trim($head);
    if (preg_match('/^[0-9a-f]{40}$/', $head)) {
        return $head;
    }
    if (!preg_match('#^ref: (refs/[\w./-]+)$#', $head, $m)) {
        return null;
    }
    $loose = @file_get_contents("$gitDir/{$m[1]}");
    if ($loose !== false) {
        return trim($loose);
    }
    $packed = @file_get_contents("$gitDir/packed-refs") ?: '';
    return preg_match('/^([0-9a-f]{40}) ' . preg_quote($m[1], '/') . '$/m', $packed, $p) ? $p[1] : null;
}

/**
 * The o2switch cron job (website/README.md) fetches the `site` branch into ~/.aoze-site.git and
 * resets ~/public_html to it. FETCH_HEAD is rewritten on every run, so its date is the last pull.
 */
function deploy_status(): array
{
    $home = dirname(private_dir());
    $gitDir = "$home/.aoze-site.git";
    if (!is_file("$gitDir/FETCH_HEAD")) {
        throw new HttpError(503, 'Le déploiement automatique n\'a encore jamais tourné sur ce serveur.');
    }
    $live = git_head($gitDir);
    $built = cached('site-branch', 120, fn () => github('/branches/site')['commit']['sha'], 'GitHub ne répond pas.');
    $log = @file("$home/aoze-deploy.log", FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    return [
        'data' => [
            'builtCommit' => substr((string) $built['data'], 0, 7),
            'liveCommit' => $live === null ? '' : substr($live, 0, 7),
            'lastPullAt' => iso((int) filemtime("$gitDir/FETCH_HEAD")),
            'logTail' => array_slice(array_map(fn ($l) => mb_substr($l, 0, 300), $log), -15),
        ],
        'fetchedAt' => iso(time()),
    ];
}

function certificates(): array
{
    return cached('certificates', 3600, function () {
        $out = [];
        foreach (SITE_HOSTS as $host) {
            $context = stream_context_create(['ssl' => ['capture_peer_cert' => true, 'SNI_enabled' => true, 'peer_name' => $host]]);
            $socket = @stream_socket_client("ssl://$host:443", $errno, $error, 8, STREAM_CLIENT_CONNECT, $context);
            if ($socket === false) {
                $out[] = ['host' => $host, 'issuer' => "Connexion HTTPS refusée ($error)", 'validTo' => iso(0)];
                continue;
            }
            $cert = openssl_x509_parse(stream_context_get_params($socket)['options']['ssl']['peer_certificate']);
            fclose($socket);
            $out[] = [
                'host' => $host,
                'issuer' => $cert['issuer']['O'] ?? $cert['issuer']['CN'] ?? 'inconnu',
                'validTo' => iso((int) $cert['validTo_time_t']),
            ];
        }
        return $out;
    }, 'Impossible de lire les certificats.');
}

function page_status(): array
{
    return cached('pages', 300, function () {
        $out = [];
        foreach (SITE_PAGES as $path) {
            try {
                [$status, , $ms] = http_get(SITE_URL . $path, follow: false);
            } catch (RuntimeException) {
                [$status, $ms] = [0, 0];
            }
            $out[] = ['path' => $path, 'status' => $status, 'ms' => $ms];
        }
        return $out;
    }, 'Impossible de joindre le site.');
}

function server_status(): array
{
    $file = private_dir() . '/admin.sqlite';
    $size = (int) @filesize($file) + (int) @filesize("$file-wal");
    return [
        'data' => [
            'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION . '.' . PHP_RELEASE_VERSION,
            'database' => 'SQLite ' . db()->query('SELECT sqlite_version()')->fetchColumn(),
            'databaseSize' => $size,
        ],
        'fetchedAt' => iso(time()),
    ];
}
