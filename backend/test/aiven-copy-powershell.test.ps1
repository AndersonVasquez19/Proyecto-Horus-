# Ensayo de primitivas en PowerShell 5.1; sin MySQL, DPAPI real ni secretos reales.
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$script = Join-Path $PSScriptRoot '..\scripts\aiven-copy.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Sintaxis inválida.' }
foreach ($name in @('New-PrivateDirectory','Read-Plain')) {
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    . ([scriptblock]::Create($function.Extent.Text))
}
$dir = Join-Path ([IO.Path]::GetTempPath()) ('horus-copy-ps-' + [guid]::NewGuid().ToString('N'))
try {
    New-PrivateDirectory $dir
    $acl = Get-Acl -LiteralPath $dir
    if (-not $acl.AreAccessRulesProtected -or @($acl.Access).Count -ne 2) { throw 'ACL incorrecta.' }
    $fictional = 'Ficticio á漢字'
    $secure = ConvertTo-SecureString $fictional -AsPlainText -Force
    if ((Read-Plain $secure) -cne $fictional) { throw 'SecureString incorrecto.' }
    $secure.Dispose()
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command node.exe).Source
    $psi.Arguments = '-e "let s='''';process.stdin.setEncoding(''utf8'');process.stdin.on(''data'',x=>s+=x);process.stdin.on(''end'',()=>{process.stdout.write(String(JSON.parse(s.replace(/^﻿/,'''')).value.length));});"'
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
    $process = [Diagnostics.Process]::Start($psi)
    $writer = New-Object IO.StreamWriter($process.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
    $writer.Write((@{ value=$fictional } | ConvertTo-Json -Compress)); $writer.Dispose()
    $output = $process.StandardOutput.ReadToEnd(); $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or $output -ne [string]$fictional.Length) { throw 'Transporte UTF-8 incorrecto.' }
    $process.Dispose()
    # Regresión: la CA debe viajar como cadena JSON, no como objeto con propiedades ETS de Get-Content.
    $caFile = Join-Path $dir 'ca ficticia ñ.pem'
    [IO.File]::WriteAllText($caFile, "-----BEGIN CERTIFICATE-----`nFICTICIO`n-----END CERTIFICATE-----`n")
    $caRead = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$request.ca' }, $true)
    $request = @{ caFile = $caFile }
    . ([scriptblock]::Create($caRead.Extent.Text))
    if (($request | ConvertTo-Json -Compress) -notmatch '"ca":"-----BEGIN CERTIFICATE') { throw 'CA serializada como objeto.' }
    Remove-Item -LiteralPath $caFile
    # Regresión: con varios node.exe en PATH el lanzador debe tomar uno solo.
    $nodeLine = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$node' }, $true)
    if ($nodeLine.Extent.Text -notmatch 'Select-Object -First 1') { throw 'Selección de node.exe ambigua.' }
    Write-Output 'PowerShell: parser, ACL, SecureString y stdin UTF-8 correctos.'
} finally {
    # Ruta creada arriba, bajo TEMP, sin recursión ni archivos del usuario.
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir }
}
