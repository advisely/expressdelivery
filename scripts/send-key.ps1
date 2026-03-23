Add-Type -AssemblyName System.Windows.Forms
$proc = Get-Process -Name ExpressDelivery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) {
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    }
"@
    [Win32]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("j")
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("j")
    Write-Host "Sent J keys to navigate"
} else {
    Write-Host "ExpressDelivery not found"
}
