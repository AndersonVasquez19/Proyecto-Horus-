param(
    # Filtro opcional de PHPUnit, p. ej. -Filtro 'TrasladoSqliteMysqlTest'.
    [string]$Filtro = ''
)

# Pruebas MySQL opcionales (phpunit.mysql.xml) contra un MySQL 8.4 DESECHABLE en Docker.
# Crea un contenedor propio (solo 127.0.0.1, datos en memoria, clave aleatoria que nunca
# se muestra) y SIEMPRE lo elimina al terminar. No toca otros contenedores, horus_db, la
# SQLite habitual ni ningun .env. Requiere Docker y la imagen mysql:8.4 ya descargada.
# (Solo ASCII: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$php = (Get-Command php -ErrorAction Stop).Source
$docker = (Get-Command docker -ErrorAction Stop).Source

& $docker image inspect mysql:8.4 *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Falta la imagen mysql:8.4 (docker pull mysql:8.4). Este script no descarga ni instala nada.'
}

$sufijo = [guid]::NewGuid().ToString('N').Substring(0, 12)
$nombre = "horus-laravel-it-$sufijo"
$temporal = Join-Path ([IO.Path]::GetTempPath()) "horus-mysql-it-$sufijo"
New-Item -ItemType Directory -Path $temporal | Out-Null
$archivoClave = Join-Path $temporal 'clave.txt'
$sonda = Join-Path $temporal 'sonda.php'
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$clave = -join ($bytes | ForEach-Object { $_.ToString('x2') })
[IO.File]::WriteAllText($archivoClave, $clave)
# Archivo en lugar de php -r: PowerShell 5.1 altera las comillas de los argumentos nativos.
[IO.File]::WriteAllText($sonda, '<?php try { $p = new PDO("mysql:host=127.0.0.1;port=" . $argv[1], "root", file_get_contents($argv[2])); echo $p->query("SELECT @@server_uuid")->fetchColumn(); } catch (Throwable $e) { exit(1); }')
$creado = $false

try {
    $env:MYSQL_ROOT_PASSWORD = $clave
    & $docker run -d --name $nombre --label horus.laravel.it=true -e MYSQL_ROOT_PASSWORD -p 127.0.0.1::3306 --tmpfs /var/lib/mysql:rw mysql:8.4 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el contenedor de pruebas.' }
    $creado = $true
    Remove-Item Env:MYSQL_ROOT_PASSWORD

    $puerto = ((& $docker port $nombre 3306) | Select-Object -First 1).Split(':')[-1]
    $uuid = ''
    for ($i = 0; $i -lt 90 -and -not $uuid; $i++) {
        Start-Sleep -Seconds 2
        $salida = & $php $sonda $puerto $archivoClave 2>$null
        if ($LASTEXITCODE -eq 0) { $uuid = "$salida".Trim() }
    }
    if (-not $uuid) { throw 'MySQL no respondio a tiempo.' }

    $env:HORUS_MYSQL_IT = 'true'
    $env:HORUS_MYSQL_IT_HOST = '127.0.0.1'
    $env:HORUS_MYSQL_IT_PORT = $puerto
    $env:HORUS_MYSQL_IT_USER = 'root'
    $env:HORUS_MYSQL_IT_PASSWORD_FILE = $archivoClave
    $env:HORUS_MYSQL_IT_SERVER_UUID = $uuid

    $argumentos = @('vendor/phpunit/phpunit/phpunit', '-c', 'phpunit.mysql.xml', '--colors=never')
    if ($Filtro) { $argumentos += @('--filter', $Filtro) }
    Push-Location $projectRoot
    try {
        & $php @argumentos
        $resultado = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($resultado -ne 0) { throw "PHPUnit termino con codigo $resultado." }
} finally {
    foreach ($variable in 'HORUS_MYSQL_IT', 'HORUS_MYSQL_IT_HOST', 'HORUS_MYSQL_IT_PORT', 'HORUS_MYSQL_IT_USER', 'HORUS_MYSQL_IT_PASSWORD_FILE', 'HORUS_MYSQL_IT_SERVER_UUID', 'MYSQL_ROOT_PASSWORD') {
        Remove-Item "Env:$variable" -ErrorAction SilentlyContinue
    }
    # Solo el contenedor creado por esta ejecucion, por su nombre exacto.
    if ($creado) { & $docker rm -f $nombre | Out-Null }
    Remove-Item -LiteralPath $temporal -Recurse -Force -ErrorAction SilentlyContinue
}
