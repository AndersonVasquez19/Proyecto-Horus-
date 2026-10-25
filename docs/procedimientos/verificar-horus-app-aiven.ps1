# FASE C.3 - Verificacion de SOLO LECTURA de la cuenta remota horus_app en Aiven.
#
# Ejecutar en Windows PowerShell 5.1 privado, con el usuario Windows que creo el DPAPI:
#   & 'C:\Users\PCT40T\Documents\Proyecto-Horus-\docs\procedimientos\verificar-horus-app-aiven.ps1'
#
# Garantias:
# - No crea, modifica ni elimina nada: no hay POST/PUT/PATCH/DELETE, GRANT, DDL ni DML.
# - Sentencias SQL ejecutadas (todas de solo lectura):
#     SELECT CURRENT_USER(); SHOW SESSION STATUS (Ssl_*); SHOW GRANTS;
#     SELECT 1 FROM horus_db.admin_users LIMIT 0 (nunca devuelve filas);
#     SELECT COUNT(*) FROM information_schema.tables (esquema horus_db).
# - Node.js 22 por ruta explicita; no toca el PATH ni reemplaza otras versiones de Node.
# - La contrasena se recupera con DPAPI solo en memoria y viaja por stdin (JSON UTF-8 sin BOM).
#   No se usan variables de entorno, argumentos ni archivos para transportarla.
# - TLS 1.2+ con la CA verificada y el nombre de host comprobado.
# - Los errores se muestran sanitizados: fase exacta y, si existe, un codigo tecnico
#   tipo ER_ACCESS_DENIED_ERROR / ECONNREFUSED. Nunca mensajes, SQL ni credenciales.
# - El secreto existe brevemente en memoria administrada; no se puede garantizar su borrado.

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$horusNode       = 'C:\Horus-Secure\Tools\node22\node.exe'
$horusSecretFile = 'C:\Horus-Secure\Aiven\Secrets\horus_app_aiven.dpapi'
$horusCaFile     = 'C:\Horus-Secure\Aiven\ca.pem'

$horusSecure  = $null
$horusPlain   = $null
$horusPayload = $null
$horusBytes   = $null
$horusBstr    = [IntPtr]::Zero
$horusProcess = $null
$horusStarted = $false
$horusFase    = 'local'

function Write-Etapa([string]$mensaje) { Write-Host ('[C.3] ' + $mensaje) }

try {
    # ---------- Comprobaciones locales (sin red) ----------
    $horusBackend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend'))
    if (-not (Test-Path -LiteralPath $horusNode -PathType Leaf)) { throw 'Falta Node.js 22 en la ruta explicita.' }
    if (-not (Test-Path -LiteralPath (Join-Path $horusBackend 'node_modules\mariadb\package.json'))) {
        throw 'Dependencia mariadb no disponible en backend/node_modules.'
    }
    if (-not (Test-Path -LiteralPath $horusCaFile -PathType Leaf)) { throw 'Falta el certificado CA de Aiven.' }
    if (-not (Test-Path -LiteralPath $horusSecretFile -PathType Leaf)) {
        throw 'Falta el archivo DPAPI de horus_app.'
    }
    Write-Etapa 'Archivo DPAPI de horus_app presente.'

    # Codigo publico: nunca se interpola la contrasena en este texto ni en Arguments.
    $horusJs = @'
'use strict';
const fs = require('node:fs');
const tls = require('node:tls');
const { createRequire } = require('node:module');
let connection;
let input;
let config;
let phase = 'preparacion';
let code = '';
// Solo un identificador tecnico en mayusculas (ER_*, ECONNREFUSED...); nunca texto libre.
function safeCode(error) {
  const value = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{1,60}$/.test(value) ? value : '';
}
function fail() {
  process.stderr.write('Verificacion fallida (' + phase + ')' + (code ? ' [' + code + ']' : '') + '.\n');
  process.exitCode = 1;
}
const timer = setTimeout(() => { fail(); process.exit(1); }, 40000);
process.on('uncaughtException', () => { fail(); process.exit(1); });
process.on('unhandledRejection', () => { fail(); process.exit(1); });
(async () => {
  try {
    if (process.versions.node.split('.')[0] !== '22') { phase = 'version-node'; throw new Error(); }
    phase = 'lectura-stdin';
    input = fs.readFileSync(0);
    // JSON UTF-8 sin BOM; un BOM provocaria un fallo de analisis aqui.
    config = JSON.parse(input.toString('utf8'));
    input.fill(0);
    input = null;
    phase = 'dependencias';
    const mariadb = createRequire(process.cwd() + '/package.json')('mariadb');
    const host = 'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com';
    let hostnameVerified = false;
    phase = 'conexion-tls';
    // Sin base de datos seleccionada: no se presupone acceso a horus_db.
    connection = await mariadb.createConnection({
      host, port: 28816, user: 'horus_app',
      password: config.password,
      ssl: {
        ca: fs.readFileSync('C:/Horus-Secure/Aiven/ca.pem', 'utf8'),
        rejectUnauthorized: true,
        servername: host,
        minVersion: 'TLSv1.2',
        checkServerIdentity: (_name, cert) => {
          const error = tls.checkServerIdentity(host, cert);
          if (!error) hostnameVerified = true;
          return error;
        }
      },
      connectTimeout: 15000, socketTimeout: 15000,
      multipleStatements: false, permitLocalInfile: false,
      debug: false, debugCompress: false, trace: false, logger: { warning: () => {} }
    });
    config.password = null;
    config = null;
    phase = 'identidad';
    const identity = await connection.query('SELECT CURRENT_USER() AS identidad');
    phase = 'estado-tls';
    const status = await connection.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher')");
    phase = 'grants';
    const grants = await connection.query('SHOW GRANTS');
    const values = Object.fromEntries(status.map(row => [row.Variable_name, row.Value]));
    phase = 'validacion-tls';
    if (!hostnameVerified || !/^TLSv1\.[23]$/.test(values.Ssl_version || '') || !values.Ssl_cipher) throw new Error();
    phase = 'validacion-identidad';
    if (!identity[0].identidad.startsWith('horus_app@')) throw new Error();
    phase = 'analisis-grants';
    // Solo privilegios y ambito; nunca filas crudas ni clausulas de autenticacion.
    const permissions = grants.map(row => {
      const grant = String(Object.values(row)[0]);
      const match = /^GRANT ([A-Z_, ()]+) ON (\*|`[^`]+`)\.(\*|`[^`]+`) TO /.exec(grant);
      if (!match) throw new Error();
      return {
        privilegios: match[1], ambito: match[2] + '.' + match[3],
        grant_option: /\bWITH GRANT OPTION\s*$/.test(grant)
      };
    });
    const soloUsage = permissions.length > 0 && permissions.every(p =>
      p.privilegios === 'USAGE' && p.ambito === '*.*' && !p.grant_option);
    // LIMIT 0 nunca devuelve filas: solo prueba si existe el privilegio SELECT.
    phase = 'acceso-tablas';
    let accesoTablas = 'indeterminado';
    try {
      await connection.query('SELECT 1 FROM `horus_db`.`admin_users` LIMIT 0');
      accesoTablas = 'PERMITIDO';
    } catch (error) {
      if ([1142, 1143, 1044, 1045].includes(error && error.errno)) accesoTablas = 'denegado';
      else code = safeCode(error);
    }
    phase = 'tablas-visibles';
    const visibles = await connection.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'horus_db'");
    await connection.end();
    connection = null;
    process.stdout.write(JSON.stringify({
      identidad: identity[0].identidad,
      tls: { version: values.Ssl_version, cifrado: values.Ssl_cipher, ca_verificada: true, hostname_verificado: true },
      permisos: permissions,
      sin_permisos_administrativos: soloUsage,
      acceso_tablas_horus_db: accesoTablas,
      tablas_visibles_en_horus_db: Number(visibles[0].n)
    }, null, 2) + '\n');
  } catch (error) {
    // Sin objetos Error, SQL, configuracion, credenciales ni respuestas crudas.
    code = safeCode(error) || code;
    fail();
  } finally {
    if (input) input.fill(0);
    if (config) config.password = null;
    if (connection) connection.destroy();
    clearTimeout(timer);
  }
})();
'@

    $horusEncodedJs = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($horusJs))
    $horusStart = New-Object System.Diagnostics.ProcessStartInfo
    $horusStart.FileName = $horusNode
    $horusStart.WorkingDirectory = $horusBackend
    $horusStart.Arguments = '-e "eval(Buffer.from(''' + $horusEncodedJs + ''',''base64'').toString(''utf8''))"'
    $horusStart.UseShellExecute = $false
    $horusStart.CreateNoWindow = $true
    $horusStart.RedirectStandardInput = $true
    $horusStart.RedirectStandardOutput = $true
    $horusStart.RedirectStandardError = $true
    # El hijo no hereda NODE_OPTIONS, NODE_DEBUG, SSLKEYLOGFILE, DB_* ni otros secretos.
    $horusStart.EnvironmentVariables.Clear()
    $horusStart.EnvironmentVariables['SystemRoot'] = $env:SystemRoot

    $horusFase = 'dpapi'
    $horusSecure = ConvertTo-SecureString -String ([IO.File]::ReadAllText($horusSecretFile).Trim()) -ErrorAction Stop
    $horusBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusSecure)
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusBstr)
    if ([string]::IsNullOrEmpty($horusPlain)) { throw 'Secreto DPAPI vacio.' }
    Write-Etapa 'Contrasena DPAPI recuperada en memoria.'
    $horusPayload = ConvertTo-Json -Compress -InputObject @{ password = $horusPlain }

    $horusFase = 'cliente-node'
    $horusProcess = New-Object System.Diagnostics.Process
    $horusProcess.StartInfo = $horusStart
    # .NET Framework (PowerShell 5.1) no tiene StandardInputEncoding y el StreamWriter de stdin
    # antepone un BOM si la consola usa UTF-8 (JSON.parse fallaba en 'lectura-stdin').
    # Se arranca el hijo con una codificacion de entrada UTF-8 SIN BOM y se restaura despues.
    $horusPrevEncoding = [Console]::InputEncoding
    try {
        [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
        $horusStarted = $horusProcess.Start()
    }
    finally { [Console]::InputEncoding = $horusPrevEncoding }
    if (-not $horusStarted) { throw 'No se pudo iniciar el cliente de verificacion.' }
    $horusOutTask = $horusProcess.StandardOutput.ReadToEndAsync()
    $horusErrTask = $horusProcess.StandardError.ReadToEndAsync()

    # Los bytes UTF-8 sin BOM se escriben directamente en el flujo base de stdin.
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

    $horusFase = 'verificacion'
    if (-not $horusProcess.WaitForExit(45000)) { throw 'Tiempo agotado en la verificacion.' }
    if ($horusProcess.ExitCode -ne 0) {
        # Solo se acepta el formato exacto emitido por el cliente; cualquier otra cosa se descarta.
        $horusErrText = ($horusErrTask.GetAwaiter().GetResult()).Trim()
        if ($horusErrText -cmatch '^Verificacion fallida \([a-z-]+\)( \[[A-Z][A-Z0-9_]{1,60}\])?\.$') {
            throw ($horusErrText + ' (codigo de salida ' + $horusProcess.ExitCode + ')')
        }
        throw ('Verificacion fallida sin fase reconocible (codigo de salida ' + $horusProcess.ExitCode + ').')
    }
    $horusResult = $horusOutTask.GetAwaiter().GetResult() | ConvertFrom-Json

    Write-Host ''
    Write-Host '=== RESULTADO (solo lectura) ==='
    Write-Host ('Cuenta            : horus_app (archivo DPAPI disponible)')
    Write-Host ('Identidad         : ' + $horusResult.identidad)
    Write-Host ('TLS               : ' + $horusResult.tls.version + ', CA y host verificados')
    Write-Host ('Solo USAGE *.*    : ' + $horusResult.sin_permisos_administrativos)
    Write-Host ('Acceso a tablas   : ' + $horusResult.acceso_tablas_horus_db + ' (tablas visibles en horus_db: ' + $horusResult.tablas_visibles_en_horus_db + ')')
    Write-Host 'Permisos:'
    foreach ($horusPermiso in @($horusResult.permisos)) {
        Write-Host ('  ' + $horusPermiso.privilegios + ' ON ' + $horusPermiso.ambito + ' (grant_option=' + $horusPermiso.grant_option + ')')
    }
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
