<?php

// No arranca Laravel ni carga .env. La carpeta privada debe existir fuera del repositorio.
require __DIR__.'/../vendor/autoload.php';

use App\Support\Traslado\RespaldoSqlite;

$args = getopt('', ['origen:', 'directorio:']);
$origen = realpath($args['origen'] ?? '');
$dir = realpath($args['directorio'] ?? '');
$repo = realpath(__DIR__.'/../..');
$dentro = static fn (string $p): bool => str_starts_with(strtolower(str_replace('\\', '/', $p)).'/', strtolower(str_replace('\\', '/', $repo)).'/');

if ($origen === false || ! is_file($origen) || $dir === false || ! is_dir($dir) || $dentro($dir)) {
    fwrite(STDERR, "Indique --origen=<SQLite> y --directorio=<carpeta privada existente fuera del repositorio>.\n");
    exit(1);
}

$destino = $dir.'/sqlite-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(6)).'.sqlite';
try {
    $respaldo = new RespaldoSqlite;
    $informe = $respaldo->crear($origen, $destino);
    $restauracion = $destino.'.restauracion';
    try {
        $verificacion = $respaldo->crear($destino, $restauracion);
        if ($informe['tablas'] !== $verificacion['tablas'] || $informe['esquema_sha256'] !== $verificacion['esquema_sha256']) {
            throw new RuntimeException('La restauración no coincide con el respaldo.');
        }
    } finally {
        if (is_file($restauracion)) {
            unlink($restauracion);
        }
    }
    $informe['restauracion_verificada'] = true;
    if (file_put_contents($destino.'.json', json_encode($informe, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT), LOCK_EX) === false) {
        throw new RuntimeException('No se pudo guardar el manifiesto.');
    }
    echo 'Respaldo y restauración verificados: '.$destino.PHP_EOL;
} catch (Throwable) {
    fwrite(STDERR, "Respaldo incompleto: revisar la carpeta privada; no se modificó el origen.\n");
    exit(1);
}
