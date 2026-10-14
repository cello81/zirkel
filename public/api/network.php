<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';

const MAX_PEOPLE = 5000;
const MAX_CATEGORIES = 200;
const MAX_CONNECTIONS = 20000;

function valid_id($v): bool
{
    return is_string($v) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $v) === 1;
}
function clean_str($v, int $max): string
{
    return is_string($v) ? mb_substr($v, 0, $max) : '';
}
function clean_date($v): ?string
{
    return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) === 1 ? $v : null;
}

/**
 * Baut aus den Client-Daten ein bereinigtes Netzwerk: nur bekannte Felder,
 * feste Typen und Laengen, begrenzte Anzahl. Liefert null bei kaputter Struktur.
 */
function sanitize_network_data(array $data): ?array
{
    foreach (['people', 'categories', 'connections'] as $k) {
        if (!isset($data[$k]) || !is_array($data[$k])) return null;
    }
    if (count($data['people']) > MAX_PEOPLE || count($data['categories']) > MAX_CATEGORIES || count($data['connections']) > MAX_CONNECTIONS) {
        return null;
    }

    $categories = [];
    foreach ($data['categories'] as $c) {
        if (!is_array($c) || !valid_id($c['id'] ?? null)) continue;
        $color = $c['color'] ?? '';
        $categories[] = [
            'id' => $c['id'],
            'name' => clean_str($c['name'] ?? '', 80),
            'color' => is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1 ? $color : '#8a8f9e',
        ];
    }

    $people = [];
    $personIds = [];
    foreach ($data['people'] as $p) {
        if (!is_array($p) || !valid_id($p['id'] ?? null)) continue;
        $out = [
            'id' => $p['id'],
            'name' => clean_str($p['name'] ?? '', 120),
            'notes' => clean_str($p['notes'] ?? '', 5000),
            'categoryId' => valid_id($p['categoryId'] ?? null) ? $p['categoryId'] : null,
            'birthDate' => clean_date($p['birthDate'] ?? null),
            'deceased' => !empty($p['deceased']),
            'deathDate' => clean_date($p['deathDate'] ?? null),
        ];
        foreach (['x', 'y', 'fx', 'fy'] as $k) {
            if (isset($p[$k]) && (is_int($p[$k]) || is_float($p[$k])) && is_finite((float)$p[$k])) {
                $out[$k] = $p[$k];
            }
        }
        $people[] = $out;
        $personIds[$p['id']] = true;
    }

    $connections = [];
    foreach ($data['connections'] as $c) {
        if (!is_array($c) || !valid_id($c['id'] ?? null)) continue;
        if (!is_string($c['a'] ?? null) || !is_string($c['b'] ?? null)) continue;
        if (!isset($personIds[$c['a']], $personIds[$c['b']])) continue;
        $connections[] = [
            'id' => $c['id'],
            'a' => $c['a'],
            'b' => $c['b'],
            'label' => clean_str($c['label'] ?? '', 80),
        ];
    }

    return ['people' => $people, 'categories' => $categories, 'connections' => $connections];
}

$user = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    send_json(get_network());
}

if ($method === 'POST') {
    $body = json_body(MAX_NETWORK_BYTES);
    $data = $body['data'] ?? null;
    $version = $body['version'] ?? null;
    if (!is_int($version) || !is_array($data)) {
        send_json(['error' => 'invalid_input'], 400);
    }
    $data = sanitize_network_data($data);
    if ($data === null) {
        send_json(['error' => 'invalid_input', 'message' => 'Netzwerkdaten haben ein ungueltiges Format.'], 400);
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
