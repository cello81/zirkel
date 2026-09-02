<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

$user = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    send_json(get_network());
}

if ($method === 'POST') {
    $body = json_body();
    $data = $body['data'] ?? null;
    $version = $body['version'] ?? null;
    if (!is_int($version) || !is_array($data)) {
        send_json(['error' => 'invalid_input'], 400);
    }

    try {
        $result = with_file_lock(NETWORK_FILE, default_network(), function ($current) use ($data, $version, $user) {
            $current = is_array($current) ? $current : default_network();
            if ((int)($current['version'] ?? 0) !== $version) {
                throw new NetworkConflictException($current);
            }
            $updated = [
                'version' => $version + 1,
                'updatedBy' => $user['displayName'],
                'updatedAt' => gmdate('c'),
                'data' => $data,
            ];
            return ['data' => $updated, 'return' => $updated];
        });
    } catch (NetworkConflictException $e) {
        send_json($e->current, 409);
    }

    send_json(['version' => $result['version']]);
}

send_json(['error' => 'method_not_allowed'], 405);
