<?php
declare(strict_types=1);

// Zirkel — gemeinsame Hilfsfunktionen fuer alle API-Endpunkte.
//
// Bewusst ohne Datenbank und ohne PHP-eigene Sessions gebaut:
// - Datenbank: die Datenmenge (zwei Konten, ein gemeinsames Netzwerk) ist
//   winzig, daher reichen JSON-Dateien mit Dateisperren (flock) voellig aus
//   und laufen auf jedem PHP-Hosting ohne Zusatzmodule.
// - Eigene Login-Tokens statt session_start(): PHPs eingebaute Sessions
//   haengen an serverseitigen Aufraeum-Einstellungen (session.gc_maxlifetime),
//   die man auf Shared-Hosting oft nicht selbst kontrolliert. Fuer "180 Tage
//   angemeldet bleiben" speichern wir daher ein eigenes Selector/Validator-
//   Token (wie ein Remember-Me-Cookie), das unabhaengig von PHP-Session-GC ist.

$dataDir = __DIR__ . '/../../data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0700, true);
}
define('DATA_DIR', rtrim($dataDir, '/'));
define('USERS_FILE', DATA_DIR . '/users.json');
define('NETWORK_FILE', DATA_DIR . '/network.json');
define('TOKENS_FILE', DATA_DIR . '/tokens.json');
define('ATTEMPTS_FILE', DATA_DIR . '/login_attempts.json');

define('MAX_USERS', 2);
define('COOKIE_NAME', 'zirkel_auth');
define('REMEMBER_SECONDS', 180 * 24 * 60 * 60);
define('SHORT_SECONDS', 24 * 60 * 60);
define('LOGIN_WINDOW_SECONDS', 15 * 60);
define('LOGIN_MAX_ATTEMPTS', 10);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate');

class NetworkConflictException extends RuntimeException
{
    public array $current;
    public function __construct(array $current)
    {
        parent::__construct('conflict');
        $this->current = $current;
    }
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
    return false;
}

function json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : [];
}

function send_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function read_json_file(string $file, $fallback)
{
    if (!file_exists($file)) return $fallback;
    $fh = fopen($file, 'r');
    if (!$fh) return $fallback;
    flock($fh, LOCK_SH);
    $raw = stream_get_contents($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    $data = json_decode((string)$raw, true);
    return ($data === null && trim((string)$raw) !== 'null') ? $fallback : $data;
}

/**
 * Liest die Datei unter einer exklusiven Sperre, uebergibt die aktuellen
 * Daten an $mutator und schreibt dessen Rueckgabe ('data') zurueck - Lesen
 * und Schreiben passieren also atomar, auch wenn mehrere PHP-Prozesse
 * gleichzeitig zugreifen. $mutator kann eine Exception werfen, um den
 * Schreibvorgang abzubrechen (nichts wird dann veraendert).
 */
function with_file_lock(string $file, $fallback, callable $mutator)
{
    if (!file_exists($file)) {
        file_put_contents($file, json_encode($fallback, JSON_UNESCAPED_UNICODE));
    }
    $fh = fopen($file, 'r+');
    if (!$fh) throw new RuntimeException('cannot_open_' . basename($file));
    try {
        flock($fh, LOCK_EX);
        $raw = stream_get_contents($fh);
        $current = json_decode((string)$raw, true);
        if ($current === null && trim((string)$raw) !== 'null') $current = $fallback;
        $result = $mutator($current);
        if (is_array($result) && array_key_exists('data', $result)) {
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, json_encode($result['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            fflush($fh);
        }
        return is_array($result) ? ($result['return'] ?? null) : null;
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function get_users(): array
{
    $users = read_json_file(USERS_FILE, []);
    return is_array($users) ? $users : [];
}

function default_network(): array
{
    return [
        'version' => 1,
        'updatedBy' => null,
        'updatedAt' => gmdate('c'),
        'data' => [
            'people' => [],
            'categories' => [
                ['id' => 'c-familie', 'name' => 'Familie', 'color' => '#d1495b'],
                ['id' => 'c-freunde', 'name' => 'Freunde', 'color' => '#3d8b7a'],
                ['id' => 'c-arbeit', 'name' => 'Arbeit', 'color' => '#5470c9'],
                ['id' => 'c-verein', 'name' => 'Verein & Hobby', 'color' => '#8a9a3b'],
            ],
            'connections' => [],
        ],
    ];
}

function get_network(): array
{
    $net = read_json_file(NETWORK_FILE, default_network());
    return is_array($net) ? $net : default_network();
}

function uuid4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}

function public_user(array $u): array
{
    return ['id' => $u['id'], 'username' => $u['username'], 'displayName' => $u['displayName']];
}

// --- Auth-Token (Selector/Validator) --------------------------------------
function issue_token(string $userId, bool $remember): void
{
    $selector = bin2hex(random_bytes(9));
    $validator = bin2hex(random_bytes(32));
    $expiresAt = time() + ($remember ? REMEMBER_SECONDS : SHORT_SECONDS);

    with_file_lock(TOKENS_FILE, [], function ($tokens) use ($selector, $validator, $userId, $expiresAt) {
        $tokens = is_array($tokens) ? $tokens : [];
        $now = time();
        $tokens = array_values(array_filter($tokens, fn($t) => ($t['expiresAt'] ?? 0) > $now));
        $tokens[] = [
            'selector' => $selector,
            'validatorHash' => hash('sha256', $validator),
            'userId' => $userId,
            'expiresAt' => $expiresAt,
        ];
        return ['data' => $tokens];
    });

    setcookie(COOKIE_NAME, $selector . ':' . $validator, [
        'expires' => $remember ? $expiresAt : 0, // 0 = reines Session-Cookie (endet beim Schliessen des Browsers)
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => is_https(),
    ]);
}

function current_user(): ?array
{
    $cookie = $_COOKIE[COOKIE_NAME] ?? '';
    if (!$cookie || !str_contains($cookie, ':')) return null;
    [$selector, $validator] = explode(':', $cookie, 2);
    $tokens = read_json_file(TOKENS_FILE, []);
    if (!is_array($tokens)) return null;
    foreach ($tokens as $t) {
        if (($t['selector'] ?? '') === $selector) {
            if (($t['expiresAt'] ?? 0) < time()) return null;
            if (!hash_equals((string)($t['validatorHash'] ?? ''), hash('sha256', $validator))) return null;
            foreach (get_users() as $u) {
                if ($u['id'] === $t['userId']) return $u;
            }
            return null;
        }
    }
    return null;
}

function require_auth(): array
{
    $user = current_user();
    if (!$user) send_json(['error' => 'not_authenticated'], 401);
    return $user;
}

function clear_token(): void
{
    $cookie = $_COOKIE[COOKIE_NAME] ?? '';
    if ($cookie && str_contains($cookie, ':')) {
        [$selector] = explode(':', $cookie, 2);
        with_file_lock(TOKENS_FILE, [], function ($tokens) use ($selector) {
            $tokens = is_array($tokens) ? $tokens : [];
            $tokens = array_values(array_filter($tokens, fn($t) => ($t['selector'] ?? '') !== $selector));
            return ['data' => $tokens];
        });
    }
    setcookie(COOKIE_NAME, '', ['expires' => time() - 3600, 'path' => '/']);
}

// --- einfache Login-Rate-Begrenzung (pro IP+Benutzername) -------------------
function attempt_key(string $username): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return $ip . ':' . strtolower($username);
}

function is_rate_limited(string $key): bool
{
    $attempts = read_json_file(ATTEMPTS_FILE, []);
    $entry = is_array($attempts) ? ($attempts[$key] ?? null) : null;
    if (!$entry) return false;
    if (time() - $entry['firstAt'] > LOGIN_WINDOW_SECONDS) return false;
    return $entry['count'] >= LOGIN_MAX_ATTEMPTS;
}

function register_failed_attempt(string $key): void
{
    with_file_lock(ATTEMPTS_FILE, [], function ($attempts) use ($key) {
        $attempts = is_array($attempts) ? $attempts : [];
        $now = time();
        $entry = $attempts[$key] ?? null;
        if (!$entry || $now - $entry['firstAt'] > LOGIN_WINDOW_SECONDS) {
            $attempts[$key] = ['count' => 1, 'firstAt' => $now];
        } else {
            $attempts[$key]['count'] = ($attempts[$key]['count'] ?? 0) + 1;
        }
        return ['data' => $attempts];
    });
}

function clear_attempts(string $key): void
{
    with_file_lock(ATTEMPTS_FILE, [], function ($attempts) use ($key) {
        $attempts = is_array($attempts) ? $attempts : [];
        unset($attempts[$key]);
        return ['data' => $attempts];
    });
}
