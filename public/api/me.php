<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$user = require_auth();
$others = [];
foreach (get_users() as $u) {
    if ($u['id'] !== $user['id']) $others[] = $u['displayName'];
}
send_json(['user' => public_user($user), 'otherMembers' => $others]);
