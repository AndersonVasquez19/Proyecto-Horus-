# FASE C.3 - Creacion controlada del usuario remoto horus_app en Aiven (UN solo POST).
#
# Ejecutar en Windows PowerShell 5.1 PRIVADO, con el usuario Windows que usara el DPAPI:
#   Simulacion (sin red ni token):  & '...\crear-horus-app-aiven.ps1' -DryRun
#   Ejecucion real (tras aprobar):  & '...\crear-horus-app-aiven.ps1'
#
# Garantias:
# - Un unico POST; sin reintentos. Un resultado incierto (timeout/red) NO se repite.
# - Si el archivo DPAPI de destino ya existe, se detiene ANTES de pedir el token.
# - El token se pide con Read-Host -AsSecureString (sin eco, fuera del historial).
# - La contrasena generada se cifra con DPAPI (CurrentUser) y se guarda con CreateNew
#   (nunca sobrescribe). No se imprime; tampoco la respuesta de la API.
# - Verificacion posterior solo de lectura (CURRENT_USER, SHOW GRANTS, SELECT ... LIMIT 0).
# - No ejecuta GRANT, DDL, DML, migraciones ni toca horus_db, MySQL local ni .env.
# - No usa variables de entorno, argumentos ni archivos para transportar secretos.
# - El secreto existe brevemente en memoria administrada; no se puede garantizar su borrado.

[CmdletBinding()]
param(
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$horusApiHost    = 'https://api.aiven.io'
$horusProject    = 'horus-group-dev'
$horusService    = 'mysql-1b22a7e2'
$horusUser       = 'horus_app'
$horusEndpoint   = "$horusApiHost/v1/project/$horusProject/service/$horusService/user"
$horusBody       = '{"username":"horus_app","mysql_grants":[]}'
$horusSecretsDir = 'C:\Horus-Secure\Aiven\Secrets'
$horusSecretFile = Join-Path $horusSecretsDir 'horus_app_aiven.dpapi'
$horusCaFile     = 'C:\Horus-Secure\Aiven\ca.pem'
$horusNodePath   = 'C:\Horus-Secure\Tools\node22\node.exe'

$horusTokenSecure = $null
$horusTokenBstr   = [IntPtr]::Zero
$horusPlain       = $null
$horusClient      = $null
$horusRequest     = $null
$horusResponse    = $null
$horusRespText    = $null
$horusPayload     = $null
$horusBytes       = $null
$horusAppSecure   = $null
$horusAppBstr     = [IntPtr]::Zero
$horusProcess     = $null
$horusStarted     = $false
$horusPostSent    = $false
$horusSecretSaved = $false
$horusFase        = 'comprobaciones-locales'
$horusStatus      = 0

function Write-Etapa([string]$mensaje) { Write-Host ('[C.3] ' + $mensaje) }

try {
    # ---------- Comprobaciones previas (locales, sin red) ----------
    $horusBackend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend'))
    # Node 22 por ruta explicita (el PATH puede resolver otra version, p. ej. Node 24).
    $horusNode = $horusNodePath
    if (-not (Test-Path -LiteralPath $horusNode -PathType Leaf)) { throw 'Falta Node.js 22 en la ruta explicita.' }
    if (-not (Test-Path -LiteralPath (Join-Path $horusBackend 'node_modules\mariadb\package.json'))) {
        throw 'Dependencia mariadb no disponible.'
    }
    if (-not (Test-Path -LiteralPath $horusCaFile)) { throw 'Falta el certificado CA de Aiven.' }
    if (-not (Test-Path -LiteralPath $horusSecretsDir -PathType Container)) { throw 'Falta el directorio de secretos.' }
    if (Test-Path -LiteralPath $horusSecretFile) {
        throw 'El archivo DPAPI de horus_app ya existe. Detenido para no sobrescribirlo.'
    }

    # Prueba de escritura y de ida y vuelta DPAPI con un valor ficticio, ANTES del POST,
    # para no perder la contrasena si el guardado fallara despues.
    $horusFase = 'sonda-dpapi'
    $horusProbe = Join-Path $horusSecretsDir ('.probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $horusDummy = ConvertTo-SecureString -String 'valor-ficticio-no-secreto' -AsPlainText -Force
        $horusDummyText = ConvertFrom-SecureString -SecureString $horusDummy
        [IO.File]::WriteAllText($horusProbe, $horusDummyText)
        $horusBack = ConvertTo-SecureString -String ([IO.File]::ReadAllText($horusProbe).Trim())
        if ($null -eq $horusBack) { throw 'DPAPI no funciona.' }
    }
    finally {
        if (Test-Path -LiteralPath $horusProbe) { Remove-Item -LiteralPath $horusProbe -Force }
    }
    Write-Etapa 'Comprobaciones locales correctas (DPAPI y escritura en Secrets; destino libre).'

    if ($DryRun) {
        Write-Host ''
        Write-Host '=== SIMULACION (no se envia nada, no se pide token) ==='
        Write-Host ('Metodo   : POST')
        Write-Host ('URL      : ' + $horusEndpoint)
        Write-Host ('Cabecera : Authorization: aivenv1 <TOKEN-NO-MOSTRADO>')
        Write-Host ('Cuerpo   : ' + $horusBody)
        Write-Host ('Reintentos: ninguno | Timeout: 30 s | TLS 1.2')
        Write-Host ('Secreto  : ' + $horusSecretFile + ' (DPAPI CurrentUser, CreateNew)')
        Write-Host 'Despues  : verificacion de solo lectura como horus_app (identidad, TLS, SHOW GRANTS, acceso a tablas).'
        return
    }

    # ---------- Confirmacion y entrada del token ----------
    $horusFase = 'confirmacion'
    Write-Host ''
    Write-Host ('Se enviara UN POST a: ' + $horusEndpoint)
    Write-Host ('Cuerpo: ' + $horusBody)
    $horusConfirm = Read-Host 'Escriba CREAR (en mayusculas) para continuar'
    if ($horusConfirm -cne 'CREAR') { throw 'Cancelado por el usuario. No se envio nada.' }

    $horusFase = 'token'
    $horusTokenSecure = Read-Host 'Token de API de Aiven (no se mostrara)' -AsSecureString
    if ($null -eq $horusTokenSecure -or $horusTokenSecure.Length -eq 0) { throw 'Token vacio. No se envio nada.' }

    # ---------- UN unico POST ----------
    $horusFase = 'preparacion-post'
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $horusClient = New-Object System.Net.Http.HttpClient
    $horusClient.Timeout = [TimeSpan]::FromSeconds(30)
    $horusRequest = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $horusEndpoint)
    $horusTokenBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusTokenSecure)
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusTokenBstr)
    [void]$horusRequest.Headers.TryAddWithoutValidation('Authorization', 'aivenv1 ' + $horusPlain)
    $horusPlain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusTokenBstr)
    $horusTokenBstr = [IntPtr]::Zero
    $horusTokenSecure.Dispose()
    $horusTokenSecure = $null
    $horusRequest.Content = New-Object System.Net.Http.StringContent($horusBody, [Text.Encoding]::UTF8, 'application/json')

    Write-Etapa 'Enviando el POST (sin reintentos)...'
    $horusFase = 'post'
    $horusPostSent = $true
    try {
        $horusResponse = $horusClient.SendAsync($horusRequest).GetAwaiter().GetResult()
        $horusStatus = [int]$horusResponse.StatusCode
        $horusRespText = $horusResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    catch {
        throw 'Resultado INCIERTO del POST (red/timeout). NO se reintenta. Compruebe con una lectura GET si horus_app existe.'
    }

    if ($horusStatus -lt 200 -or $horusStatus -ge 300) {
        $horusHint = ''
        if ($horusStatus -eq 400) { $horusHint = ' (posible falta de soporte de granular grants; no repetir omitiendo mysql_grants)' }
        if ($horusStatus -eq 409) { $horusHint = ' (el usuario podria existir ya)' }
        if ($horusStatus -eq 401 -or $horusStatus -eq 403) { $horusHint = ' (token invalido o sin permisos)' }
        throw ('La API respondio HTTP ' + $horusStatus + $horusHint + '. No se reintenta.')
    }

    # ---------- Extraer la contrasena y guardarla de inmediato con DPAPI ----------
    $horusFase = 'respuesta-json'
    $horusJson = $horusRespText | ConvertFrom-Json
    $horusRespText = $null
    $horusFase = 'respuesta-usuario'
    if ($null -eq $horusJson.user -or $horusJson.user.username -cne $horusUser) {
        throw 'HTTP 2xx pero la respuesta no confirma el usuario esperado. No se guardo ningun secreto.'
    }
    $horusPass = [string]$horusJson.user.password
    $horusJson = $null
    if ([string]::IsNullOrEmpty($horusPass)) {
        throw 'El usuario fue creado pero la respuesta no incluia contrasena. Restablezca la contrasena por la API (operacion aparte).'
    }
    $horusFase = 'guardar-dpapi'
    $horusAppSecure = ConvertTo-SecureString -String $horusPass -AsPlainText -Force
    $horusPass = $null
    $horusEncrypted = ConvertFrom-SecureString -SecureString $horusAppSecure
    $horusStream = [IO.File]::Open($horusSecretFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $horusBytes = [Text.Encoding]::ASCII.GetBytes($horusEncrypted)
        $horusStream.Write($horusBytes, 0, $horusBytes.Length)
    }
    finally { $horusStream.Dispose() }
    $horusEncrypted = $null
    $horusSecretSaved = $true
    Write-Etapa 'Usuario creado y contrasena protegida con DPAPI.'

    # ---------- Verificacion de solo lectura como horus_app ----------
    $horusFase = 'verificacion'
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
    $horusStart.EnvironmentVariables.Clear()
    $horusStart.EnvironmentVariables['SystemRoot'] = $env:SystemRoot

    # Se relee el DPAPI recien escrito: confirma tambien que el secreto guardado funciona.
    $horusAppSecure.Dispose()
    $horusAppSecure = ConvertTo-SecureString -String ([IO.File]::ReadAllText($horusSecretFile).Trim()) -ErrorAction Stop
    $horusAppBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusAppSecure)
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusAppBstr)
    $horusPayload = ConvertTo-Json -Compress -InputObject @{ password = $horusPlain }

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
    # Bytes UTF-8 sin BOM directamente en el flujo base de stdin.
    $horusBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($horusPayload)
    $horusProcess.StandardInput.BaseStream.Write($horusBytes, 0, $horusBytes.Length)
    $horusProcess.StandardInput.BaseStream.Flush()
    $horusProcess.StandardInput.Close()
    [Array]::Clear($horusBytes, 0, $horusBytes.Length)
    $horusBytes = $null
    $horusPlain = $null
    $horusPayload = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusAppBstr)
    $horusAppBstr = [IntPtr]::Zero
    $horusAppSecure.Dispose()
    $horusAppSecure = $null

    if (-not $horusProcess.WaitForExit(45000)) { throw 'Tiempo agotado en la verificacion.' }
    if ($horusProcess.ExitCode -ne 0) {
        # Solo se acepta el formato exacto emitido por el cliente; cualquier otra cosa se descarta.
        $horusErrText = ($horusErrTask.GetAwaiter().GetResult()).Trim()
        $horusFaseTxt = 'sin fase reconocible'
        if ($horusErrText -cmatch '^Verificacion fallida \([a-z-]+\)( \[[A-Z][A-Z0-9_]{1,60}\])?\.$') {
            $horusFaseTxt = $horusErrText.TrimEnd('.')
        }
        throw ('Verificacion fallida: ' + $horusFaseTxt + ', codigo de salida ' + $horusProcess.ExitCode + '. El usuario existe y el secreto esta guardado.')
    }
    $horusResult = $horusOutTask.GetAwaiter().GetResult() | ConvertFrom-Json

    Write-Host ''
    Write-Host '=== RESULTADO ==='
    Write-Host ('Cuenta           : ' + $horusUser)
    Write-Host ('Identidad        : ' + $horusResult.identidad)
    Write-Host ('Estado           : creada y conectable por TLS (' + $horusResult.tls.version + ', CA y host verificados)')
    Write-Host ('Secreto protegido: ' + $horusSecretFile)
    Write-Host ('Solo USAGE *.*   : ' + $horusResult.sin_permisos_administrativos)
    Write-Host ('Acceso a tablas  : ' + $horusResult.acceso_tablas_horus_db + ' (tablas visibles: ' + $horusResult.tablas_visibles_en_horus_db + ')')
    $horusResult | ConvertTo-Json -Depth 6 | Out-Null
}
catch {
    # ConvertFrom-Json puede incluir el cuerpo (y la contraseña) en Exception.Message.
    # No leer ni imprimir la excepción: únicamente fase propia y estado HTTP numérico.
    Write-Host ''
    $horusHttp = ''
    if ($horusStatus -ge 100 -and $horusStatus -le 599) { $horusHttp = ' HTTP ' + $horusStatus + '.' }
    Write-Host ('ERROR [fase: ' + $horusFase + ']: Operacion detenida.' + $horusHttp) -ForegroundColor Red
    if ($horusStatus -eq 400) { Write-Host 'Compruebe soporte de granular grants; no omita mysql_grants ni reintente automaticamente.' }
    if ($horusStatus -eq 401 -or $horusStatus -eq 403) { Write-Host 'Revise autenticacion y permisos en privado.' }
    if ($horusStatus -eq 409) { Write-Host 'El usuario podria existir; compruebelo con una consulta de solo lectura.' }
    if ($horusPostSent -and -not $horusSecretSaved) {
        Write-Host 'ATENCION: el POST pudo haberse enviado. No se reintenta automaticamente.' -ForegroundColor Yellow
    }
    if ($horusSecretSaved) { Write-Host 'El secreto ya fue guardado. No repita la creacion; revise la verificacion por separado.' }
    exit 1
}
finally {
    $horusPlain = $null
    $horusPayload = $null
    $horusRespText = $null
    if ($null -ne $horusBytes) { [Array]::Clear($horusBytes, 0, $horusBytes.Length) }
    if ($horusTokenBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusTokenBstr) }
    if ($horusAppBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusAppBstr) }
    if ($null -ne $horusTokenSecure) { $horusTokenSecure.Dispose() }
    if ($null -ne $horusAppSecure) { $horusAppSecure.Dispose() }
    if ($null -ne $horusResponse) { $horusResponse.Dispose() }
    if ($null -ne $horusRequest) { $horusRequest.Dispose() }
    if ($null -ne $horusClient) { $horusClient.Dispose() }
    if ($null -ne $horusProcess) {
        if ($horusStarted -and -not $horusProcess.HasExited) { $horusProcess.Kill() }
        $horusProcess.Dispose()
    }
}
