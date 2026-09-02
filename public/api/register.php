<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$body = json_body();
$username = trim(strtolower((string)($body['username'] ?? '')));
$password = (string)($body['password'] ?? '');
$displayName = trim((string)($body['displayName'] ?? ''));

if ($username === '' || $password === '' || $displayName === '') {
    send_json(['error' => 'invalid_input', 'message' => 'Name, Anzeigename und Passwort werden benoetigt.'], 400);
}
if (strlen($username) < 2 || strlen($username) > 40) {
    send_json(['error' => 'invalid_input', 'message' => 'Benutzername muss 2-40 Zeichen lang sein.'], 400);
}
if (strlen($password) < 8) {
    send_json(['error' => 'weak_password', 'message' => 'Das Passwort muss mindestens 8 Zeichen haben.'], 400);
}

try {
    $newUser = with_file_lock(USERS_FILE, [], function ($users) use ($username, $password, $displayName) {
        $users = is_array($users) ? $users : [];
        if (count($users) >= MAX_USERS) {
            throw new RuntimeException('setup_complete');
        }
        foreach ($users as $u) {
            if (($u['username'] ?? null) === $username) {
                throw new RuntimeException('username_taken');
            }
        }
        $user = [
            'id' => uuid4(),
            'username' => $username,
            'displayName' => mb_substr($displayName, 0, 60),
            'passwordHash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
            'createdAt' => gmdate('c'),
        ];
        $users[] = $user;
        return ['data' => $users, 'return' => $user];
    });
} catch (RuntimeException $e) {
    if ($e->getMessage() === 'setup_complete') {
        send_json(['error' => 'setup_complete', 'message' => 'Es sind bereits zwei Konten eingerichtet.'], 403);
    }
    if ($e->getMessage() === 'username_taken') {
        send_json(['error' => 'username_taken', 'message' => 'Dieser Benutzername ist bereits vergeben.'], 409);
    }
    send_json(['error' => 'server_error', 'message' => 'Unerwarteter Fehler.'], 500);
}

issue_token($newUser['id'], true);
send_json(['user' => public_user($newUser)]);
