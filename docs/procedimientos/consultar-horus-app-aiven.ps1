# FASE C.3 - Consulta de SOLO LECTURA: comprueba si horus_app existe en el servicio de Aiven.
#
# Ejecutar en Windows PowerShell 5.1 PRIVADO (el token se pide oculto; no se pasa a Claude):
#   & 'C:\Users\PCT40T\Documents\Proyecto-Horus-\docs\procedimientos\consultar-horus-app-aiven.ps1'
#
# Garantias:
# - Un unico GET; no crea ni modifica usuarios. Sin POST/PUT/PATCH/DELETE.
# - No imprime el token, contrasenas ni la respuesta cruda: solo nombres de usuario y estado.
# - El token vive en memoria administrada; no se puede garantizar su borrado.

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$horusUri = 'https://api.aiven.io/v1/project/horus-group-dev/service/mysql-1b22a7e2'
$horusSecure = $null
$horusBstr = [IntPtr]::Zero
$horusPlain = $null
$horusFase = 'token'
$horusStatus = 0

try {
    $horusSecure = Read-Host 'Token de API de Aiven (no se mostrara)' -AsSecureString
    if ($null -eq $horusSecure -or $horusSecure.Length -eq 0) { throw 'Token vacio. No se envio nada.' }
    $horusBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($horusSecure)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $horusPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($horusBstr)
    $horusFase = 'get'
    $horusResp = Invoke-RestMethod -Method Get -Uri $horusUri -Headers @{ Authorization = 'aivenv1 ' + $horusPlain } -TimeoutSec 30
    $horusPlain = $null
    $horusFase = 'respuesta'
    $horusNames = @($horusResp.service.users | ForEach-Object { $_.username })
    Write-Host ('Usuarios del servicio: ' + ($horusNames -join ', '))
    Write-Host ('horus_app existe     : ' + ($horusNames -contains 'horus_app'))
    Write-Host ('Estado del servicio  : ' + $horusResp.service.state)
}
catch {
    # Nunca imprimir Message, ErrorDetails ni el cuerpo remoto (pueden contener secretos).
    # Response puede no existir en errores de JSON/red: en tal caso no se informa estado HTTP.
    $horusStatus = 0
    if ($_.Exception.PSObject.Properties['Response'] -and $null -ne $_.Exception.Response) {
        try { $horusStatus = [int]$_.Exception.Response.StatusCode } catch { $horusStatus = 0 }
    }
    $horusHttp = ''
    if ($horusStatus -ge 100 -and $horusStatus -le 599) { $horusHttp = ' HTTP ' + $horusStatus + '.' }
    Write-Host ('ERROR GET [fase: ' + $horusFase + ']: Consulta detenida.' + $horusHttp) -ForegroundColor Red
    exit 1
}
finally {
    $horusPlain = $null
    if ($horusBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($horusBstr) }
    if ($null -ne $horusSecure) { $horusSecure.Dispose() }
}
