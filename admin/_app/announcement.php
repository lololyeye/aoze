<?php
declare(strict_types=1);

const ANNOUNCEMENT_MAX_TEXT = 180;
const ANNOUNCEMENT_FILE = 'announcement.json';
const ANNOUNCEMENT_FIELDS = ['level', 'textFr', 'textEn', 'link', 'startsAt', 'endsAt'];
const ADMIN_TIMEZONE = 'Europe/Paris';

/** @return array{draft: array<string, mixed>, published: array<string, mixed>|null} */
function stored_announcement(): array
{
    $value = db()->query("SELECT value FROM settings WHERE key = 'announcement'")->fetchColumn();
    return $value === false
        ? ['draft' => ['level' => 'info', 'textFr' => '', 'textEn' => '', 'link' => '', 'startsAt' => null, 'endsAt' => null, 'updatedAt' => iso(time())], 'published' => null]
        : json_decode($value, true);
}

/** The draft being edited, whether a banner is live, and whether the draft differs from it. */
function announcement(): array
{
    ['draft' => $draft, 'published' => $published] = stored_announcement();
    $fields = array_flip(ANNOUNCEMENT_FIELDS);
    $differs = $published !== null && array_intersect_key($draft, $fields) != array_intersect_key($published, $fields);
    return $draft + ['status' => $published === null ? 'draft' : 'published', 'pendingChanges' => $differs];
}

/** A datetime-local value, entered in French time, as UTC; empty means no limit. */
function parse_local_time(string $value): ?string
{
    if ($value === '') {
        return null;
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', substr($value, 0, 16), new DateTimeZone(ADMIN_TIMEZONE));
    if ($date === false) {
        throw new HttpError(422, 'Date invalide.');
    }
    return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function clean_text(string $text): string
{
    $text = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $text) ?? '');
    if (mb_strlen($text) > ANNOUNCEMENT_MAX_TEXT) {
        throw new HttpError(422, 'Le texte dépasse ' . ANNOUNCEMENT_MAX_TEXT . ' caractères.');
    }
    return $text;
}

/** Only https:// links or paths on the site itself: no javascript:, no protocol-relative //host. */
function clean_link(string $link): string
{
    $link = trim($link);
    if ($link === '' || (str_starts_with($link, '/') && !str_starts_with($link, '//'))) {
        return $link;
    }
    if (filter_var($link, FILTER_VALIDATE_URL) && str_starts_with($link, 'https://')) {
        return $link;
    }
    throw new HttpError(422, 'Le lien doit commencer par https:// ou par / (une page du site).');
}

/**
 * The public site reads announcement.json from its root; `null` means no banner, and the file
 * always exists so pages never log a 404. Writing a temporary file then renaming keeps visitors
 * from reading half a file. The deployment's git reset leaves it alone: it is not in the repository.
 */
function write_public_announcement(?array $published): void
{
    $path = rtrim(config()['public_dir'], '/\\') . '/' . ANNOUNCEMENT_FILE;
    $json = $published === null ? 'null' : json_encode([
        'id' => $published['updatedAt'],
        'level' => $published['level'],
        'text' => ['fr' => $published['textFr'], 'en' => $published['textEn']],
        'link' => $published['link'],
        'startsAt' => $published['startsAt'],
        'endsAt' => $published['endsAt'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $tmp = "$path.tmp";
    if (file_put_contents($tmp, $json, LOCK_EX) === false || !rename($tmp, $path)) {
        throw new RuntimeException("Cannot write $path");
    }
}

/** Saving a draft never touches the live banner: it changes only on publish or unpublish. */
function save_announcement(array $admin, array $in): array
{
    $intent = input_string($in, 'intent', 12);
    if (!in_array($intent, ['draft', 'publish', 'unpublish'], true)) {
        throw new HttpError(400, 'Requête invalide.');
    }
    $next = [
        'level' => input_string($in, 'level', 12) === 'warning' ? 'warning' : 'info',
        'textFr' => clean_text(input_string($in, 'textFr', 2048)),
        'textEn' => clean_text(input_string($in, 'textEn', 2048)),
        'link' => clean_link(input_string($in, 'link', 300)),
        'startsAt' => parse_local_time(input_string($in, 'startsAt', 32)),
        'endsAt' => parse_local_time(input_string($in, 'endsAt', 32)),
        'updatedAt' => iso(time()),
    ];
    if ($next['startsAt'] !== null && $next['endsAt'] !== null && $next['endsAt'] <= $next['startsAt']) {
        throw new HttpError(422, 'La fin doit être après le début.');
    }
    if ($intent === 'publish' && ($next['textFr'] === '' || $next['textEn'] === '')) {
        throw new HttpError(422, 'Le bandeau publié a besoin d\'un texte en français et en anglais.');
    }
    $published = match ($intent) {
        'publish' => $next,
        'unpublish' => null,
        default => stored_announcement()['published'],
    };
    if ($intent !== 'draft') {
        write_public_announcement($published);
    }
    db()->prepare("INSERT INTO settings (key, value) VALUES ('announcement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        ->execute([json_encode(['draft' => $next, 'published' => $published], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)]);
    audit($admin['id'], 'Bandeau', match ($intent) {
        'publish' => 'Publié sur le site',
        'unpublish' => 'Retiré du site',
        default => 'Brouillon enregistré',
    });
    return announcement();
}
