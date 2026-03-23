Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$proc = Get-Process -Name ExpressDelivery -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    $handle = $proc.MainWindowHandle
    Write-Host "Found window handle: $handle"

    # Restore if minimized (SW_RESTORE = 9)
    [Win32]::ShowWindow($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 300
    [Win32]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 500

    # Get window rect
    $rect = New-Object Win32+RECT
    [Win32]::GetWindowRect($handle, [ref]$rect) | Out-Null
    Write-Host "Window rect: Left=$($rect.Left) Top=$($rect.Top) Right=$($rect.Right) Bottom=$($rect.Bottom)"

    # Click at center of thread list area (roughly 35% from left, 25% from top)
    $x = $rect.Left + [int](($rect.Right - $rect.Left) * 0.35)
    $y = $rect.Top + [int](($rect.Bottom - $rect.Top) * 0.25)
    Write-Host "Clicking at ($x, $y)"

    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    Start-Sleep -Milliseconds 100
    [Win32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [Win32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Write-Host "Click sent!"
} else {
    Write-Host "ExpressDelivery window not found"
}
