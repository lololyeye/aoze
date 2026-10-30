# Aoze admin

The private dashboard at `https://aoze.fr/admin/`: a small TypeScript app (`src/`) and a PHP API
(`server/`) that stores its data in SQLite. No framework, no Composer package.

## Layout once deployed

```
~/public_html/admin/        from server/, plus the built app
  index.php                 front controller: /admin/api/* is JSON, anything else the app shell;
                            also answers /e and /get/<installer> for the public site
  .htaccess                 _app/ is never served; assets/ are static files
  _app/*.php, shell.html    API code and the built index.html
  assets/                   built JS, CSS and fonts
~/aoze-admin/               private, outside the web folder (chmod 700)
  config.php                setup token and allowed origin (chmod 600)
  admin.sqlite              account, sessions, login attempts, activity log, cache, banner
  analytics.sqlite          audience measurement: visits, page views, download requests, daily totals
  analytics.key             secret for the keyed hashes, kept apart from the database (chmod 600)
  geo.sqlite                DB-IP's free country database (CC BY 4.0), refreshed monthly
  error.log                 server errors; the browser only sees a generic message
~/public_html/announcement.json   the published banner (`null` when there is none), written by the
                                  admin; the deployment's git reset leaves it alone
```

`config.php`:

```php
<?php
return [
    // One-time code to create the administrator account. Remove it once the account exists.
    'setup_token' => 'at least 24 random characters',
    'origin' => 'https://aoze.fr',
    // Hides /admin: without it every admin path answers like a missing page. Open
    // https://aoze.fr/admin/?key=<access_key> once per device. Changing it locks out every device.
    'access_key' => 'at least 32 random characters',
    // Optional. GitHub allows 60 requests an hour per address without a token, and the address
    // is shared on a hosting server. A fine-grained token with no permission raises it to 5000.
    // 'github_token' => '',
];
```

## Data

The server reads GitHub (releases, `latest.json`, the website workflow, the `site` branch), the
host (the deployment's `~/.aoze-site.git` and `~/aoze-deploy.log`, the HTTPS certificates, the
main pages) and its own database. GitHub and network answers are cached (2 to 60 minutes); when
a refresh fails the last good answer is shown with its date. `latest.json` is checked the way the
updater checks it: version, official download URL, size and SHA-256 of the published file, and the
file and version named in the signature's trusted comment (the signature itself is verified by
the app before installing).

## Audience measurement

Off until it is turned on in Réglages, which should only happen once the privacy policy
describes it. The site's script (`website/src/scripts/stats.ts`) sends page views, visible time
and the download steps to `/e`; installer links go to `/get/<file>`, which records the request
and redirects to the same file on GitHub Releases (always, even with measurement off).

- A first-party `aoze_v` cookie (HttpOnly, 13 months, never extended) recognises a returning
  visitor; the database keeps only a keyed hash of it. A visit ends after 30 minutes without
  events.
- The IP address only gives a country, then is dropped; it is never stored.
- Not counted: robots, other sites, `DNT` or `Sec-GPC`, visitors who opted out (`aoze_optout`
  cookie), and anyone holding the /admin key.
- Hourly upkeep, run after a public request: daily totals, purge of raw data after the chosen
  retention (3 to 25 months), login attempts after 90 days and the activity log after 12 months,
  GitHub download counters, the monthly country database.
- A download request is not a finished download: GitHub serves the file and says nothing more.

## Security model

- Sessions: random 256-bit token in a `__Host-` cookie (Secure, HttpOnly, SameSite=Strict); the
  database keeps only its SHA-256. 30 minutes idle, 12 hours at most; any session can be closed.
- Every API route checks the session on the server. Writes also need the same `Origin` and the
  session's CSRF token in `X-CSRF-Token`.
- Passwords: Argon2id, 12 characters minimum. Optional TOTP second factor (RFC 6238), codes
  cannot be reused.
- Sign-in: one generic error, constant work for unknown accounts, 5 failures per IP or 10 per
  account in 15 minutes block further attempts. Everything is logged.
- With `access_key` set, everything under /admin (shell, API, assets) is the site's 404 page
  until the device has the key's cookie (`__Host-`, one year), so the sign-in is not reachable.
- The first account needs the setup token; the endpoint refuses once an account exists.

## Local development

PHP 8.2+ with `pdo_sqlite`, `sqlite3` and `sodium`. A private folder with a `config.php` whose
`origin` is `http://localhost:4322`:

```bash
AOZE_ADMIN_DIR=/path/to/test-folder php -S 127.0.0.1:8090 website/admin/server/dev-router.php
```

```bash
npm --prefix website run admin:dev
```

Vite serves the app on `http://localhost:4322/admin/` and forwards `/admin/api` to PHP.
