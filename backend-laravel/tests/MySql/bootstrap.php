<?php

/*
 * Arranque de las pruebas MySQL opcionales (phpunit.mysql.xml).
 *
 * Solo se ejecutan contra un servidor MySQL desechable identificado explícitamente:
 * - HORUS_MYSQL_IT=true
 * - HORUS_MYSQL_IT_HOST (127.0.0.1, localhost o ::1) y HORUS_MYSQL_IT_PORT
 * - HORUS_MYSQL_IT_USER y HORUS_MYSQL_IT_PASSWORD_FILE (archivo con la contraseña; nunca se imprime)
 * - HORUS_MYSQL_IT_SERVER_UUID: @@server_uuid del contenedor creado para la prueba
 *
 * Se aborta si el servidor contiene horus_db. La ejecución crea su propia base
 * horus_laravel_it_<hex> y la elimina al terminar; no toca ninguna otra.
 */

$fallar = static function (string $mensaje): never {
    fwrite(STDERR, "Pruebas MySQL abortadas: {$mensaje}\n");
    exit(1);
};

$leer = static fn (string $nombre): string => trim((string) getenv($nombre));

if ($leer('HORUS_MYSQL_IT') !== 'true') {
    $fallar('defina HORUS_MYSQL_IT=true y las variables del servidor desechable (ver docs/mysql-traslado.md).');
}

$host = $leer('HORUS_MYSQL_IT_HOST');
$puerto = $leer('HORUS_MYSQL_IT_PORT');
$usuario = $leer('HORUS_MYSQL_IT_USER');
$archivoClave = $leer('HORUS_MYSQL_IT_PASSWORD_FILE');
$uuidEsperado = strtolower($leer('HORUS_MYSQL_IT_SERVER_UUID'));

if (! in_array($host, ['127.0.0.1', 'localhost', '::1'], true)) {
    $fallar('el servidor debe ser local (loopback).');
}

if (preg_match('/^\d{2,5}$/', $puerto) !== 1 || $usuario === '' || ! is_file($archivoClave)
    || preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/', $uuidEsperado) !== 1) {
    $fallar('faltan el puerto, el usuario, el archivo de contraseña o un server_uuid válido.');
}

if (is_file(__DIR__.'/../.env.phpunit')) {
    $fallar('retire tests/.env.phpunit: las pruebas no aceptan archivos de entorno locales.');
}

$clave = trim((string) file_get_contents($archivoClave));
$base = 'horus_laravel_it_'.bin2hex(random_bytes(8));

try {
    $pdo = new PDO("mysql:host={$host};port={$puerto}", $usuario, $clave, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

    if (strtolower((string) $pdo->query('SELECT @@server_uuid')->fetchColumn()) !== $uuidEsperado) {
        $fallar('el server_uuid no coincide: no es el servidor desechable indicado.');
    }

    if ($pdo->query("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'horus_db'")->fetchColumn() > 0) {
        $fallar('el servidor contiene horus_db (NestJS); use un servidor exclusivo para pruebas.');
    }

    $pdo->exec("CREATE DATABASE `{$base}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
} catch (PDOException $e) {
    $fallar('no se pudo preparar la base temporal (SQLSTATE '.$e->getCode().').');
}

register_shutdown_function(static function () use ($host, $puerto, $usuario, $clave, $base): void {
    // Solo las bases de esta ejecución: el nombre aleatorio y sus derivadas.
    $pdo = new PDO("mysql:host={$host};port={$puerto}", $usuario, $clave, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $propias = $pdo->query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '{$base}' OR SCHEMA_NAME LIKE '{$base}\\_%'")
        ->fetchAll(PDO::FETCH_COLUMN);

    foreach ($propias as $propia) {
        $pdo->exec("DROP DATABASE `{$propia}`");
    }
});

$environment = [
    'APP_ENV' => 'testing',
    'HORUS_PUBLIC_AUTH_ENABLED' => 'true',
    'APP_DEBUG' => 'false',
    'APP_KEY' => 'base64:'.base64_encode(random_bytes(32)),
    'APP_CONFIG_CACHE' => __DIR__.'/../../storage/framework/testing/config-mysql-'.bin2hex(random_bytes(16)).'.php',
    'DB_CONNECTION' => 'mysql',
    'DB_URL' => '',
    'DB_HOST' => $host,
    'DB_PORT' => $puerto,
    'DB_USERNAME' => $usuario,
    'DB_PASSWORD' => $clave,
    'DB_DATABASE' => $base,
    'DB_TIMEZONE' => '+00:00',
    'HORUS_MYSQL_IT_DATABASE' => $base,
    'CACHE_STORE' => 'array',
    'SESSION_DRIVER' => 'array',
    'MAIL_MAILER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
    'BROADCAST_CONNECTION' => 'null',
    'LOG_CHANNEL' => '"null"',
    'APP_MAINTENANCE_DRIVER' => 'file',
    'BCRYPT_ROUNDS' => '4',
    'RESEND_API_KEY' => '',
    'POSTMARK_API_KEY' => '',
    'AWS_ACCESS_KEY_ID' => '',
    'AWS_SECRET_ACCESS_KEY' => '',
    'SLACK_BOT_USER_OAUTH_TOKEN' => '',
];

foreach ($environment as $name => $value) {
    putenv($name.'='.$value);
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
}

require __DIR__.'/../../vendor/autoload.php';
