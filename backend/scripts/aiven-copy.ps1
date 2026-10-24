# Compatible con Windows PowerShell 5.1. El perfil JSON contiene solo datos públicos.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('backup','verify','preflight','apply','compare')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Profile,
    [Parameter(Mandatory=$true)][string]$File,
    [string]$Sha256,
    [string]$SecondFile,
    [switch]$NoWriters,
    [switch]$IncludeRateLimits,
    [switch]$ApproveImport
)
$ErrorActionPreference = 'Stop'
function Read-Plain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function New-PrivateDirectory([string]$Directory) {
    if (Test-Path -LiteralPath $Directory) { throw 'La carpeta de ejecución debe ser nueva.' }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    [IO.Directory]::CreateDirectory($Directory, $acl) | Out-Null
}
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
if (-not ([string](& $node --version)).StartsWith('v22.')) { throw 'Se requiere Node 22.x.' }
$config = Get-Content -LiteralPath $Profile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.PSObject.Properties.Name -contains 'password' -or $config.PSObject.Properties.Name -contains 'key') { throw 'No guardar secretos en el perfil.' }
$request = @{}
foreach ($property in $config.PSObject.Properties) { $request[$property.Name] = $property.Value }
$request.action = $Action
$request.file = [IO.Path]::GetFullPath($File)
$request.sha256 = $Sha256
$request.noWriters = $NoWriters.IsPresent
$request.includeRateLimits = $IncludeRateLimits.IsPresent
if ($ApproveImport) { $request.approval = 'IMPORT_EMPTY_DATABASE' }
if ($Action -eq 'backup') {
    if (-not $SecondFile) { throw 'Indicar una segunda copia cifrada independiente.' }
    $SecondFile = [IO.Path]::GetFullPath($SecondFile)
    if ([IO.Path]::GetPathRoot($File) -eq [IO.Path]::GetPathRoot($SecondFile)) { throw 'La segunda copia debe estar en otro dispositivo aprobado.' }
    New-PrivateDirectory ([IO.Path]::GetDirectoryName($request.file))
    New-PrivateDirectory ([IO.Path]::GetDirectoryName($SecondFile))
}
$request.key = Read-Plain (Read-Host 'Clave de respaldo: 64 caracteres hexadecimales aleatorios, custodiados en el gestor' -AsSecureString)
try {
    if ($Action -ne 'verify') {
        # ReadAllText: Get-Content añade propiedades ETS (PSPath, PSProvider…) que ConvertTo-Json serializaría como objeto.
        $request.ca = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $request.caFile).ProviderPath, [Text.Encoding]::UTF8)
        if ($request.profile -eq 'aiven') {
            $secure = Get-Content -LiteralPath 'C:\Horus-Secure\Aiven\Secrets\horus_migrator.dpapi' -Raw -Encoding UTF8 | ConvertTo-SecureString
        } else { $secure = Read-Host 'Contraseña de horus_migrator LOCAL (no Aiven)' -AsSecureString }
        $request.password = Read-Plain $secure
        $secure.Dispose()
    }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $node
    $psi.Arguments = '"' + (Join-Path $PSScriptRoot 'aiven-copy.cjs') + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($name in @($psi.EnvironmentVariables.Keys)) {
        if ($name -match '^(DB_|DATABASE_URL$|MAIL_|OPENAI_|RESEND_|SMTP_|NODE_OPTIONS$)') { $psi.EnvironmentVariables.Remove($name) }
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    # Framework de PowerShell 5.1 no tiene ProcessStartInfo.StandardInputEncoding.
    $writer = New-Object IO.StreamWriter($process.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
    $writer.Write(($request | ConvertTo-Json -Compress -Depth 6))
    $writer.Dispose()
    $process.WaitForExit()
    $output = $outTask.Result
    if ($process.ExitCode -ne 0) { throw 'Operación detenida. Conservar el destino parcial; no habilitar escritores.' }
    $result = $output | ConvertFrom-Json
    if ($Action -eq 'backup') {
        [IO.File]::Copy($request.file, $SecondFile, $false)
        if ((Get-FileHash -LiteralPath $SecondFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $result.sha256) { throw 'Segunda copia no válida.' }
    }
    $output.Trim()
} finally {
    $request.password = $null
    $request.key = $null
    if ($process) { $process.Dispose() }
}
