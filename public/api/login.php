<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$body = json_body();
$username = trim(strtolower((string)($body['username'] ?? '')));
$password = (string)($body['password'] ?? '');
$remember = !array_key_exists('remember', $body) || $body['remember'] !== false;

$limits = login_rate_limits($username);
if (any_rate_limited($limits)) {
    send_json(['error' => 'rate_limited', 'message' => 'Zu viele Versuche. Bitte spaeter erneut versuchen.'], 429);
}

$user = null;
foreach (get_users() as $u) {
    if (($u['username'] ?? null) === $username) { $user = $u; break; }
}

// Auch bei unbekanntem Benutzer eine bcrypt-Berechnung gleicher Kosten, damit
// die Antwortzeit nichts darueber verraet, ob der Benutzername existiert.
if ($user) {
    $ok = strlen($password) <= MAX_PASSWORD_BYTES && password_verify($password, $user['passwordHash']);
} else {
    password_hash(substr($password, 0, MAX_PASSWORD_BYTES), PASSWORD_BCRYPT, ['cost' => 12]);
    $ok = false;
}

if (!$user || !$ok) {
    register_failed_attempt(...array_keys($limits));
    send_json(['error' => 'invalid_credentials', 'message' => 'Benutzername oder Passwort ist falsch.'], 401);
}

clear_attempts(attempt_key($username));
issue_token($user['id'], $remember);
send_json(['user' => public_user($user)]);
