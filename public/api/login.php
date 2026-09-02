<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$body = json_body();
$username = trim(strtolower((string)($body['username'] ?? '')));
$password = (string)($body['password'] ?? '');
$remember = !array_key_exists('remember', $body) || $body['remember'] !== false;

$key = attempt_key($username);
if (is_rate_limited($key)) {
    send_json(['error' => 'rate_limited', 'message' => 'Zu viele Versuche. Bitte spaeter erneut versuchen.'], 429);
}

$user = null;
foreach (get_users() as $u) {
    if (($u['username'] ?? null) === $username) { $user = $u; break; }
}

if (!$user || !password_verify($password, $user['passwordHash'])) {
    register_failed_attempt($key);
    send_json(['error' => 'invalid_credentials', 'message' => 'Benutzername oder Passwort ist falsch.'], 401);
}

clear_attempts($key);
issue_token($user['id'], $remember);
send_json(['user' => public_user($user)]);
