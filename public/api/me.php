<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$user = require_auth();
$others = [];
$userCount = 0;
foreach (get_users() as $u) {
    $userCount++;
    if ($u['id'] !== $user['id']) $others[] = $u['displayName'];
}
// Solange der zweite Platz frei ist, sieht das angemeldete Konto den Einladungscode.
$inviteCode = $userCount < MAX_USERS ? get_invite_code() : null;
send_json(['user' => public_user($user), 'otherMembers' => $others, 'inviteCode' => $inviteCode]);
