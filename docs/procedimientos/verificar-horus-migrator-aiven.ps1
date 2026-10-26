# Ejecutar en Windows PowerShell 5.1 privado, con el usuario Windows que creo el DPAPI:
# & 'C:\Users\PCT40T\Documents\Proyecto-Horus-\docs\procedimientos\verificar-horus-migrator-aiven.ps1'
# Requiere Node.js 22 y backend/node_modules/mariadb ya instalado. No instala nada.
# No ejecutar con depuradores, captura de memoria o instrumentacion de secretos.
# El secreto existe brevemente en memoria administrada; no es posible garantizar su borrado.
# DPAPI se recupera en PowerShell y se entrega por stdin redirigido al hijo Node.
# No se utilizan variables de entorno, argumentos ni archivos para transportar el secreto.
# Solo SELECT y SHOW; no importa Prisma, dotenv ni scripts de mantenimiento.
# TLS: https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscheckserveridentityhostname-cert
# Opciones: https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$horusSecure = $null
$horusPlain = $null
$horusPayload = $null
$horusBstr = [IntPtr]::Zero
$horusProcess = $null
$horusStarted = $false

try {
    $horusBackend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\backend'))
    $horusNode = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath (Join-Path $horusBackend 'node_modules\mariadb\package.json'))) {
        throw 'Dependencia no disponible.'
    }

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
const timer = setTimeout(() => process.exit(1), 40000);
process.on('uncaughtException', () => process.exit(1));
process.on('unhandledRejection', () => process.exit(1));
(async () => {
  try {
    if (process.versions.node.split('.')[0] !== '22') throw new Error();
    input = fs.readFileSync(0);
    config = JSON.parse(input.toString('utf8'));
    input.fill(0);
    input = null;
    const mariadb = createRequire(process.cwd() + '/package.json')('mariadb');
    const host = 'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com';
    let hostnameVerified = false;
    phase = 'conexion';
    connection = await mariadb.createConnection({
      host, port: 28816, user: 'horus_migrator', database: 'horus_db',
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
    phase = 'consulta';
    const identity = await connection.query('SELECT CURRENT_USER() AS identidad');
    const status = await connection.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher')");
    const grants = await connection.query('SHOW GRANTS');
    const values = Object.fromEntries(status.map(row => [row.Variable_name, row.Value]));
    if (!hostnameVerified || !/^TLSv1\.[23]$/.test(values.Ssl_version || '') || !values.Ssl_cipher) {
      throw new Error();
    }
    if (!identity[0].identidad.startsWith('horus_migrator@')) throw new Error();
    // Nunca imprimir filas crudas: solo privilegios y ambito, sin clausulas de autenticacion.
    const permissions = grants.map(row => {
      const grant = String(Object.values(row)[0]);
      const match = /^GRANT ([A-Z_, ()]+) ON (\*|`[^`]+`)\.(\*|`[^`]+`) TO /.exec(grant);
      if (!match) throw new Error();
      return {
        privilegios: match[1], ambito: match[2] + '.' + match[3],
        grant_option: /\bWITH GRANT OPTION\s*$/.test(grant)
      };
    });
    await connection.end();
    connection = null;
    process.stdout.write(JSON.stringify({
      identidad: identity[0].identidad,
      tls: { version: values.Ssl_version, cifrado: values.Ssl_cipher, ca_verificada: true, hostname_verificado: true },
      permisos: permissions
    }, null, 2) + '\n');
  } catch {
    // Sin objetos Error, SQL, configuracion, credenciales ni respuestas crudas.
    process.stderr.write('Verificacion fallida (' + phase + ').\n');
    process.exitCode = 1;
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

    $horusSecure = ConvertTo-SecureString -String ([IO.File]::ReadAllText(
        'C:\Horus-Secure\Aiven\Secrets\horus_migrator.dpapi').Trim()) -ErrorAction Stop
    $horusBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusSecure)
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusBstr)
    if ([string]::IsNullOrEmpty($horusPlain)) { throw 'Secreto vacio.' }
    $horusPayload = ConvertTo-Json -Compress -InputObject @{ password = $horusPlain }
    # .NET Framework de PowerShell 5.1 no tiene StandardInputEncoding.
    # JSON ASCII conserva incluso contrasenas Unicode sin depender de la pagina de codigos.
    $horusPayload = [regex]::Replace($horusPayload, '[^\x20-\x7E]', {
        param($horusMatch)
        '\u{0:x4}' -f [int][char]$horusMatch.Value
    })

    $horusProcess = New-Object System.Diagnostics.Process
    $horusProcess.StartInfo = $horusStart
    $horusStarted = $horusProcess.Start()
    if (-not $horusStarted) { throw 'No se pudo iniciar el cliente.' }
    $horusOutTask = $horusProcess.StandardOutput.ReadToEndAsync()
    $horusErrTask = $horusProcess.StandardError.ReadToEndAsync()
    $horusProcess.StandardInput.Write($horusPayload)
    $horusProcess.StandardInput.Close()
    $horusPlain = $null
    $horusPayload = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusBstr)
    $horusBstr = [IntPtr]::Zero
    $horusSecure.Dispose()
    $horusSecure = $null

    if (-not $horusProcess.WaitForExit(45000)) { throw 'Tiempo agotado.' }
    if ($horusProcess.ExitCode -ne 0) { throw 'Verificacion fallida.' }
    $horusResult = $horusOutTask.GetAwaiter().GetResult() | ConvertFrom-Json
    $horusResult | ConvertTo-Json -Depth 6
}
catch {
    # No imprimir $_, excepciones internas ni stderr del cliente.
    throw 'No se pudo verificar: identidad, TLS y permisos no confirmados.'
}
finally {
    $horusPlain = $null
    $horusPayload = $null
    if ($horusBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusBstr) }
    if ($null -ne $horusSecure) { $horusSecure.Dispose() }
    if ($null -ne $horusProcess) {
        if ($horusStarted -and -not $horusProcess.HasExited) { $horusProcess.Kill() }
        $horusProcess.Dispose()
    }
}
