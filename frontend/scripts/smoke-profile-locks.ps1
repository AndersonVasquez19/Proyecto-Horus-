param(
  [string]$Profile,
  [int]$MaxFiles = 3000
)
# Diagnóstico de solo lectura: pregunta al Restart Manager de Windows qué procesos mantienen abiertos archivos del perfil temporal
# de un smoke cuando su borrado falla (EPERM/EBUSY). No cierra procesos, no borra nada y no necesita permisos de administrador.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SmokeProfileLocks {
    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
        public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint handle, int flags, string key);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint nFiles, string[] files, uint nApps, RM_UNIQUE_PROCESS[] apps, uint nServices, string[] services);
    [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] RM_PROCESS_INFO[] info, ref uint reasons);
    public static List<string> Holders(string[] files) {
        var result = new List<string>();
        uint handle; string key = Guid.NewGuid().ToString();
        if (RmStartSession(out handle, 0, key) != 0) throw new Exception("RmStartSession falló");
        try {
            if (RmRegisterResources(handle, (uint)files.Length, files, 0, null, 0, null) != 0) throw new Exception("RmRegisterResources falló");
            uint needed = 0, count = 0, reasons = 0;
            int status = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (status == 234 && needed > 0) {
                var info = new RM_PROCESS_INFO[needed]; count = needed;
                status = RmGetList(handle, out needed, ref count, info, ref reasons);
                if (status != 0) throw new Exception("RmGetList falló: " + status);
                for (int i = 0; i < count; i++) result.Add(info[i].Process.dwProcessId + " " + info[i].strAppName + (String.IsNullOrEmpty(info[i].strServiceShortName) ? "" : " (servicio " + info[i].strServiceShortName + ")"));
            } else if (status != 0) throw new Exception("RmGetList falló: " + status);
        } finally { RmEndSession(handle); }
        return result;
    }
}
"@
if (-not (Test-Path -LiteralPath $Profile)) { 'perfil ya eliminado'; exit 0 }
$files = @(Get-ChildItem -LiteralPath $Profile -Recurse -File -Force -ErrorAction SilentlyContinue | Select-Object -First $MaxFiles -ExpandProperty FullName)
"archivos restantes revisados: " + $files.Count
if ($files.Count -eq 0) { 'sin archivos: solo quedan directorios pendientes de eliminar'; exit 0 }
$holders = [SmokeProfileLocks]::Holders($files)
if ($holders.Count -eq 0) { 'ningún proceso visible para Restart Manager mantiene archivos abiertos' } else { 'procesos con archivos abiertos: ' + ($holders -join '; ') }
