<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$count = count(get_users());
send_json(['userCount' => $count, 'maxUsers' => MAX_USERS, 'canRegister' => $count < MAX_USERS]);
