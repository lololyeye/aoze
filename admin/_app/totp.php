<?php
declare(strict_types=1);

// Time-based one-time codes (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits), the format every
// authenticator app reads. Written out here to avoid a dependency for forty lines.
const TOTP_STEP = 30;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp_new_secret(): string
{
    $bytes = random_bytes(20);
    $bits = '';
    foreach (str_split($bytes) as $byte) {
        $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= BASE32[bindec(str_pad($chunk, 5, '0'))];
    }
    return $out;
}

function base32_decode(string $secret): string
{
    $bits = '';
    foreach (str_split(strtoupper($secret)) as $char) {
        $index = strpos(BASE32, $char);
        if ($index === false) {
            throw new InvalidArgumentException('Invalid base32');
        }
        $bits .= str_pad(decbin($index), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) === 8) {
            $out .= chr(bindec($byte));
        }
    }
    return $out;
}

function totp_code(string $secret, int $step): string
{
    $hash = hash_hmac('sha1', pack('J', $step), base32_decode($secret), true);
    $offset = ord($hash[19]) & 0x0f;
    $value = (unpack('N', substr($hash, $offset, 4))[1] & 0x7fffffff) % 1_000_000;
    return str_pad((string) $value, 6, '0', STR_PAD_LEFT);
}

/**
 * The step the code belongs to, or null. One step of clock drift is accepted either way;
 * a step at or before $lastStep is refused so a code cannot be used twice.
 */
function totp_verify(string $secret, string $code, int $lastStep): ?int
{
    if (!preg_match('/^\d{6}$/', $code)) {
        return null;
    }
    $now = intdiv(time(), TOTP_STEP);
    foreach ([$now, $now - 1, $now + 1] as $step) {
        if ($step > $lastStep && hash_equals(totp_code($secret, $step), $code)) {
            return $step;
        }
    }
    return null;
}

function totp_uri(string $secret, string $email): string
{
    return 'otpauth://totp/' . rawurlencode("Aoze Admin:$email") . '?secret=' . $secret . '&issuer=' . rawurlencode('Aoze Admin');
}
