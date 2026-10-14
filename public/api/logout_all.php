<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    send_json(['error' => 'method_not_allowed'], 405);
}
$user = require_auth();
revoke_tokens_for_user($user['id']);
setcookie(COOKIE_NAME, '', ['expires' => time() - 3600, 'path' => '/']);
send_json(['ok' => true]);
