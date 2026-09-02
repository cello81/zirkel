<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$user = require_auth();
$body = json_body();
$currentPassword = (string)($body['currentPassword'] ?? '');
$newPassword = (string)($body['newPassword'] ?? '');

if (strlen($newPassword) < 8) {
    send_json(['error' => 'weak_password', 'message' => 'Neues Passwort muss mindestens 8 Zeichen haben.'], 400);
}

try {
    with_file_lock(USERS_FILE, [], function ($users) use ($user, $currentPassword, $newPassword) {
        $users = is_array($users) ? $users : [];
        $found = false;
        foreach ($users as &$u) {
            if ($u['id'] === $user['id']) {
                if (!password_verify($currentPassword, $u['passwordHash'])) {
                    throw new RuntimeException('invalid_credentials');
                }
                $u['passwordHash'] = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
                $found = true;
                break;
            }
        }
        unset($u);
        if (!$found) throw new RuntimeException('not_found');
        return ['data' => $users];
    });
} catch (RuntimeException $e) {
    if ($e->getMessage() === 'invalid_credentials') {
        send_json(['error' => 'invalid_credentials', 'message' => 'Aktuelles Passwort ist falsch.'], 401);
    }
    send_json(['error' => 'server_error'], 500);
}

send_json(['ok' => true]);
