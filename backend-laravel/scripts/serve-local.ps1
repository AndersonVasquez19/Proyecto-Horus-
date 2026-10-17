param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8001
)

# Arranque local opcional para Windows/Laragon. No modifica php.ini ni .env.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$php = (Get-Command php -ErrorAction Stop).Source
$router = Join-Path $projectRoot 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php'
if (-not (Test-Path -LiteralPath $router)) {
    throw 'No se encuentra el router de Laravel. Compruebe las dependencias existentes.'
}

$modules = & $php -m
if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar PHP.' }
$phpArguments = @()
if ($modules -notcontains 'Zend OPcache') {
    $opcache = Join-Path (Split-Path $php -Parent) 'ext/php_opcache.dll'
    if (-not (Test-Path -LiteralPath $opcache)) {
        throw 'Esta instalación no incluye ext/php_opcache.dll. No se ha instalado ni cambiado nada.'
    }
    $phpArguments += @('-d', "zend_extension=$opcache")
}
$phpArguments += @(
    '-d', 'opcache.enable=1',
    '-d', 'opcache.enable_cli=1',
    # Comprobar cambios en cada solicitud para mantener la edición local.
    '-d', 'opcache.validate_timestamps=1',
    '-d', 'opcache.revalidate_freq=0',
    '-S', "127.0.0.1:$Port", $router
)

Write-Host "Panel local con OPcache: http://127.0.0.1:$Port/admin (Ctrl+C para detener)"
Push-Location (Join-Path $projectRoot 'public')
try {
    & $php @phpArguments
    if ($LASTEXITCODE -ne 0) { throw "PHP termino con codigo $LASTEXITCODE." }
} finally {
    Pop-Location
}
