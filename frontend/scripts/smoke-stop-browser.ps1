param(
  [int]$RootPid,
  [string]$Profile,
  [long]$CreatedMilliseconds
)
$ErrorActionPreference = 'Stop'
# Un handle conserva la identidad entre comprobar la fecha y terminar el proceso.
# Nunca se vuelve a abrir el PID para cerrarlo: podría haberse reutilizado.
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class SmokeBrowserProcess : IDisposable {
    private IntPtr handle;
    private SmokeBrowserProcess(IntPtr value) { handle = value; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr pointer);
    public static bool UsesProfile(string commandLine, string profile) {
        if (String.IsNullOrEmpty(commandLine)) return false;
        int count;
        IntPtr arguments = CommandLineToArgvW(commandLine, out count);
        if (arguments == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            for (int i = 1; i < count; i++) {
                string argument = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, i * IntPtr.Size));
                if (String.Equals(argument, "--user-data-dir=" + profile, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        } finally { LocalFree(arguments); }
    }
    public static SmokeBrowserProcess Open(int pid, long expectedTicks) {
        IntPtr handle = OpenProcess(0x1001, false, pid); // QUERY_LIMITED_INFORMATION | TERMINATE
        if (handle == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            if (error == 87) return null; // Ya no existe.
            throw new Win32Exception(error);
        }
        bool keep = false;
        try {
            long created, exited, kernel, user;
            if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
            long ticks = DateTime.FromFileTimeUtc(created).Ticks;
            // CIM trunca a microsegundos; Win32 conserva intervalos de 100 ns.
            if (ticks - ticks % 10 != expectedTicks) return null;
            keep = true;
            return new SmokeBrowserProcess(handle);
        } finally { if (!keep) CloseHandle(handle); }
    }
    public bool HasExited() {
        long created, exited, kernel, user;
        if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return exited != 0;
    }
    public void Stop() {
        if (!TerminateProcess(handle, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}
"@
# -File recibe Profile como argumento literal; nunca se interpola en código PowerShell.
$created = [DateTimeOffset]::FromUnixTimeMilliseconds($CreatedMilliseconds).UtcDateTime
$known = @{}
$handles = @{}
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$lastError = $null
try {
  do {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine)
    $owned = @{}
    # Conservar handles hasta terminar TODA la limpieza. Así un padre que salga entre
    # instantáneas sigue identificado y su PID no se libera para otro proceso.
    $parents = $known.Clone()
    foreach ($item in $all) {
      $id = [int]$item.ProcessId
      if ($parents.ContainsKey($id) -and $parents[$id] -ne $item.CreationDate.ToUniversalTime().Ticks) { $parents.Remove($id) }
    }
    $uncertain = $false
    $ambiguous = $false
    do {
      $added = $false
      foreach ($item in $all) {
        $id = [int]$item.ProcessId
        if ($owned.ContainsKey($id)) { continue }
        $parent = [int]$item.ParentProcessId
        $stamp = $item.CreationDate.ToUniversalTime().Ticks
        $exactProfile = [SmokeBrowserProcess]::UsesProfile($item.CommandLine, $Profile) -and $stamp -ge $created.Ticks
        $observed = $known.ContainsKey($id) -and $known[$id] -eq $stamp
        # Un padre ausente solo es válido si conservamos su handle verificado.
        $descendant = $parents.ContainsKey($parent) -and $stamp -ge $parents[$parent]
        if ($exactProfile -or $observed -or $descendant) {
          try {
            $handle = if ($observed) { $handles[$id] } else { [SmokeBrowserProcess]::Open($id, $stamp) }
            if ($null -ne $handle) {
              if (!$observed -and $handles.ContainsKey($id)) { $handles[$id].Dispose() }
              $handles[$id] = $handle
              $owned[$id] = $stamp
              $known[$id] = $stamp
              $parents[$id] = $stamp
              $added = $true
            } else { $uncertain = $true; $lastError = 'La identidad del proceso cambió durante la comprobación.' }
          } catch { $uncertain = $true; $lastError = $_.Exception.Message }
        }
      }
    } while ($added)
    # Sin marcador ni handle del padre no hay prueba suficiente: conservar y avisar.
    foreach ($item in $all) {
      $parent = [int]$item.ParentProcessId
      if (!$owned.ContainsKey([int]$item.ProcessId) -and !$parents.ContainsKey($parent) -and
          $item.CreationDate.ToUniversalTime() -ge $created -and
          (($RootPid -gt 0 -and $parent -eq $RootPid) -or $known.ContainsKey($parent))) {
        $uncertain = $true
        $ambiguous = $true
        $lastError = 'No se puede confirmar la propiedad de un posible proceso secundario.'
      }
    }
    # CIM puede conservar filas terminadas; confirmar su salida con el mismo handle.
    # Los handles se retienen para seguir identificando a sus descendientes.
    $running = @($owned.Keys | Where-Object { !$handles[$_].HasExited() })
    if ($running.Count -eq 0 -and !$uncertain) { exit 0 }
    foreach ($id in $running) {
      # Un proceso puede estar saliendo ya; otra instantánea confirma su cierre.
      try { $handles[$id].Stop() } catch { $lastError = $_.Exception.Message }
    }
    if ($owned.Count -eq 0 -and $ambiguous) { throw $lastError }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw ('No se pudo confirmar el cierre completo del navegador; se conserva su perfil. ' + $lastError)
} finally { foreach ($handle in $handles.Values) { $handle.Dispose() } }
