; Custom NSIS include for ExpressDelivery installer
; Replaces electron-builder's default app-running check with a verified
; force-kill loop so the installer never blocks with "app is running" dialogs.
; Called TWICE by electron-builder: once in .onInit, once before file extraction.

!include "nsProcess.nsh"

!macro customCheckAppRunning
  ; Attempt 1: graceful kill via nsProcess + taskkill
  ${nsProcess::KillProcess} "ExpressDelivery.exe" $R0
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  Sleep 2000

  ; Verify kill loop: check if process is gone, retry up to 5 times
  StrCpy $R1 0
  ${Do}
    ${nsProcess::FindProcess} "ExpressDelivery.exe" $R0
    ${If} $R0 != 0
      ; Process is gone — success
      ${ExitDo}
    ${EndIf}

    ; Still running — force kill again and wait
    IntOp $R1 $R1 + 1
    nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
    Pop $0
    Sleep 2000

    ${If} $R1 >= 5
      ; Give up after 5 retries (10 seconds total) — proceed anyway
      ; The installer will handle locked files via its own retry mechanism
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ; Final wait for file locks and OS handles to fully release
  Sleep 1000
!macroend

!macro customInit
  ; Final kill in case something respawned between check and init
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  Sleep 1000
!macroend

; Uninstall init: same kill logic for upgrade-via-reinstall scenarios
!macro customUnInit
  ${nsProcess::KillProcess} "ExpressDelivery.exe" $R0
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  ; Longer wait for uninstall — Windows needs time to release DLL handles,
  ; better-sqlite3 .node file, and the asar archive after process death
  Sleep 3000

  ; Verify process is actually gone
  StrCpy $R1 0
  ${Do}
    ${nsProcess::FindProcess} "ExpressDelivery.exe" $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
    nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
    Pop $0
    Sleep 2000
    ${If} $R1 >= 5
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ; Extra wait for file handle release (Windows file locking is async after process death)
  Sleep 2000
!macroend
