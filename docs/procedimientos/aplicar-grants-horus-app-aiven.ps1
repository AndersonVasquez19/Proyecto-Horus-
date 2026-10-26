# FASE C.4 - Concesion de los 27 GRANT por tabla a horus_app en Aiven (mysql-1b22a7e2, base horus_db).
#
# ESTADO: PREPARADO, NO EJECUTADO. No lanzar sin autorizacion explicita del responsable.
#
# Ejecutar en Windows PowerShell 5.1 privado:
#   & 'C:\Users\PCT40T\Documents\Proyecto-Horus-\docs\procedimientos\aplicar-grants-horus-app-aiven.ps1' -Modo Prechequeo
#   & '...\aplicar-grants-horus-app-aiven.ps1' -Modo Aplicar -HostApp '<host de CURRENT_USER() de horus_app>'
#   & '...\aplicar-grants-horus-app-aiven.ps1' -Modo Verificar
#
# Modos:
#   Prechequeo (por defecto) SOLO LECTURA. Comprueba destino, avnadmin, horus_app y autoridad; muestra los 27 GRANT.
#   Aplicar                  Ejecuta los 27 GRANT en orden, sin reintentos, y verifica SHOW GRANTS al final.
#                            Exige -HostApp y escribir la frase de confirmacion.
#   Verificar                SOLO LECTURA. Compara SHOW GRANTS de horus_app con la matriz aprobada.
#   Diagnostico              SOLO LECTURA. Examina SHOW GRANTS de avnadmin y horus_app; por cada fila no reconocida informa
#                            solo cuenta, tipo general, ambito general y motivo tecnico (nunca SQL ni nombres de cuenta).
#
# Garantias:
# - Cuenta administrativa: avnadmin (no horus_migrator). La contrasena se pide oculta (Read-Host -AsSecureString),
#   se convierte en memoria y viaja por stdin al cliente Node; no se guarda en disco, entorno, argumentos ni logs.
# - TLS 1.2+ con la CA de Aiven y comprobacion del nombre del servidor; destino fijo en el codigo.
# - Solo se ejecutan GRANT SELECT/INSERT/UPDATE/DELETE por tabla de la matriz de 27; nunca permisos globales,
#   CREATE/ALTER/DROP, GRANT OPTION ni acceso a horus_migrations, docentes o docente_asignaciones.
# - Se detiene ante cualquier diferencia (tablas, cuenta, host, estado previo, autoridad) y ante el primer fallo.
#   Un fallo no se reintenta: el estado parcial se revisa con -Modo Verificar.
# - No crea ni elimina usuarios, no cambia contrasenas, no ejecuta DDL ni DML sobre las tablas.
# - Los errores se muestran sanitizados: fase, codigo tecnico y texto propio; nunca SQL ni credenciales.
# - El secreto existe brevemente en memoria administrada; no se puede garantizar su borrado.

[CmdletBinding()]
param(
    [ValidateSet('Prechequeo', 'Aplicar', 'Verificar', 'Diagnostico')]
    [string]$Modo = 'Prechequeo',

    # Host de horus_app comprobado con CURRENT_USER() (parte tras la @ de "Identidad" en verificar-horus-app-aiven.ps1).
    [string]$HostApp
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$horusNode   = 'C:\Horus-Secure\Tools\node22\node.exe'
$horusCaFile = 'C:\Horus-Secure\Aiven\ca.pem'
$horusFrase  = 'APLICAR 27 GRANT'

$horusSecure  = $null
$horusPlain   = $null
$horusPayload = $null
$horusBytes   = $null
$horusBstr    = [IntPtr]::Zero
$horusProcess = $null
$horusStarted = $false
$horusFase    = 'local'

function Write-Etapa([string]$mensaje) { Write-Host ('[C.4] ' + $mensaje) }

try {
    # ---------- Comprobaciones locales (sin red) ----------
    $horusBackend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend'))
    $horusCli     = Join-Path $PSScriptRoot 'aiven-grants-horus-app-cli.cjs'
    if (-not (Test-Path -LiteralPath $horusNode -PathType Leaf)) { throw 'Falta Node.js 22 en la ruta explicita.' }
    if (-not (Test-Path -LiteralPath (Join-Path $horusBackend 'node_modules\mariadb\package.json'))) {
        throw 'Dependencia mariadb no disponible en backend/node_modules.'
    }
    if (-not (Test-Path -LiteralPath $horusCaFile -PathType Leaf)) { throw 'Falta el certificado CA de Aiven.' }
    if (-not (Test-Path -LiteralPath $horusCli -PathType Leaf)) { throw 'Falta aiven-grants-horus-app-cli.cjs.' }
    if (-not [string]::IsNullOrEmpty($HostApp) -and $HostApp -cnotmatch '^[A-Za-z0-9._%-]{1,255}$') {
        throw 'HostApp contiene caracteres no permitidos.'
    }
    if ($Modo -eq 'Aplicar' -and [string]::IsNullOrEmpty($HostApp)) {
        throw 'El modo Aplicar exige -HostApp (host comprobado de horus_app; no se supone localhost).'
    }

    # ---------- Confirmacion explicita, solo para Aplicar ----------
    if ($Modo -eq 'Aplicar') {
        Write-Host ''
        Write-Host 'Se van a EJECUTAR 27 GRANT por tabla sobre horus_db para horus_app@' -NoNewline
        Write-Host $HostApp
        Write-Host 'Destino: Aiven mysql-1b22a7e2. Cuenta administrativa: avnadmin.'
        $horusRespuesta = Read-Host ('Escriba exactamente "' + $horusFrase + '" para continuar')
        if ($horusRespuesta -cne $horusFrase) { throw 'Confirmacion incorrecta; no se ejecuto nada.' }
    }

    # ---------- Contrasena de avnadmin: entrada oculta ----------
    $horusFase = 'contrasena'
    $horusSecure = Read-Host -AsSecureString 'Contrasena de avnadmin (entrada oculta)'
    $horusBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusSecure)
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusBstr)
    if ([string]::IsNullOrEmpty($horusPlain)) { throw 'La contrasena no puede estar vacia.' }
    $horusPayload = ConvertTo-Json -Compress -InputObject @{ password = $horusPlain }

    # ---------- Cliente Node: argumentos NO secretos; la contrasena viaja por stdin ----------
    $horusModoCli = $Modo.ToLowerInvariant()
    $horusArgs = '"' + $horusCli + '" --modo=' + $horusModoCli
    if (-not [string]::IsNullOrEmpty($HostApp)) { $horusArgs += ' --host-app=' + $HostApp }
    if ($Modo -eq 'Aplicar') { $horusArgs += ' --confirmado' }

    $horusStart = New-Object System.Diagnostics.ProcessStartInfo
    $horusStart.FileName = $horusNode
    $horusStart.WorkingDirectory = $horusBackend
    $horusStart.Arguments = $horusArgs
    $horusStart.UseShellExecute = $false
    $horusStart.CreateNoWindow = $true
    $horusStart.RedirectStandardInput = $true
    $horusStart.RedirectStandardOutput = $true
    $horusStart.RedirectStandardError = $true
    # El hijo no hereda NODE_OPTIONS, NODE_DEBUG, SSLKEYLOGFILE, DB_* ni otros secretos.
    $horusStart.EnvironmentVariables.Clear()
    $horusStart.EnvironmentVariables['SystemRoot'] = $env:SystemRoot

    $horusFase = 'cliente-node'
    Write-Etapa ('Modo ' + $Modo + '. Destino fijo: Aiven mysql-1b22a7e2, base horus_db.')
    $horusProcess = New-Object System.Diagnostics.Process
    $horusProcess.StartInfo = $horusStart
    # Entrada UTF-8 SIN BOM (PowerShell 5.1 antepone un BOM y JSON.parse fallaria).
    $horusPrevEncoding = [Console]::InputEncoding
    try {
        [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
        $horusStarted = $horusProcess.Start()
    }
    finally { [Console]::InputEncoding = $horusPrevEncoding }
    if (-not $horusStarted) { throw 'No se pudo iniciar el cliente.' }
    $horusOutTask = $horusProcess.StandardOutput.ReadToEndAsync()
    $horusErrTask = $horusProcess.StandardError.ReadToEndAsync()

    $horusUtf8 = New-Object System.Text.UTF8Encoding($false)
    $horusBytes = $horusUtf8.GetBytes($horusPayload)
    $horusProcess.StandardInput.BaseStream.Write($horusBytes, 0, $horusBytes.Length)
    $horusProcess.StandardInput.BaseStream.Flush()
    $horusProcess.StandardInput.Close()
    [Array]::Clear($horusBytes, 0, $horusBytes.Length)
    $horusBytes = $null
    $horusPlain = $null
    $horusPayload = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusBstr)
    $horusBstr = [IntPtr]::Zero
    $horusSecure.Dispose()
    $horusSecure = $null

    $horusFase = 'ejecucion'
    if (-not $horusProcess.WaitForExit(150000)) { throw 'Tiempo agotado; revise el estado con -Modo Verificar. No se reintenta.' }
    $horusOutText = $horusOutTask.GetAwaiter().GetResult()
    # La salida solo contiene lineas propias (sin secretos); se muestra tal cual.
    if ($horusOutText) { Write-Host ''; Write-Host $horusOutText.TrimEnd() }
    if ($horusProcess.ExitCode -ne 0) {
        $horusErrText = ($horusErrTask.GetAwaiter().GetResult()).Trim()
        if ($horusErrText -cmatch '^Fallo \([a-z0-9-]+\)( \[[A-Z][A-Z0-9_]{1,60}\])?(: [^\r\n]{1,400})?$') {
            throw ($horusErrText + ' (codigo de salida ' + $horusProcess.ExitCode + ')')
        }
        throw ('Fallo sin fase reconocible (codigo de salida ' + $horusProcess.ExitCode + ').')
    }
    Write-Host ''
    Write-Etapa ('Modo ' + $Modo + ' terminado correctamente.')
}
catch {
    # Solo mensajes propios y controlados; nunca $_ completo, excepciones internas ni stderr crudo.
    Write-Host ''
    Write-Host ('ERROR [fase: ' + $horusFase + ']: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    $horusPlain = $null
    $horusPayload = $null
    if ($null -ne $horusBytes) { [Array]::Clear($horusBytes, 0, $horusBytes.Length) }
    if ($horusBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusBstr) }
    if ($null -ne $horusSecure) { $horusSecure.Dispose() }
    if ($null -ne $horusProcess) {
        if ($horusStarted -and -not $horusProcess.HasExited) { $horusProcess.Kill() }
        $horusProcess.Dispose()
    }
}
