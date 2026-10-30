<?php
declare(strict_types=1);

final class HttpError extends RuntimeException
{
    /** @param array<string, string> $headers */
    public function __construct(public readonly int $status, string $message, public readonly array $headers = [])
    {
        parent::__construct($message);
    }
}

/**
 * The site's .htaccess already sends nosniff, X-Frame-Options, Referrer-Policy and HSTS on every
 * response; sending them again here would give browsers two conflicting values.
 */
function send_security_headers(): void
{
    header('X-Robots-Tag: noindex, nofollow');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

/** @param array<mixed>|object $body */
function json_response(int $status, array|object $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

/** @return array<string, mixed> */
function json_input(): array
{
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
        throw new HttpError(415, 'Requête invalide.');
    }
    $raw = file_get_contents('php://input', length: 16_384);
    $data = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($data)) {
        throw new HttpError(400, 'Requête invalide.');
    }
    return $data;
}

/** @param array<string, mixed> $input */
function input_string(array $input, string $key, int $max = 512): string
{
    $value = $input[$key] ?? '';
    if (!is_string($value) || strlen($value) > $max) {
        throw new HttpError(400, 'Requête invalide.');
    }
    return $value;
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function user_agent(): string
{
    return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300);
}

/**
 * Cross-site requests are refused before anything else: the browser always sends Origin on
 * POST, and it must be the admin's own. SameSite=Strict on the cookie is the second layer.
 */
function require_same_origin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '' || !hash_equals(config()['origin'], $origin)) {
        throw new HttpError(403, 'Origine refusée.');
    }
}
