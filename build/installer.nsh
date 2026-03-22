; Custom NSIS include for ExpressDelivery installer
; Replaces electron-builder's default app-running check with a force-kill
; so the installer never blocks with "app is running" dialogs.

!include "nsProcess.nsh"

!macro customCheckAppRunning
  ; Use nsProcess to kill (same API electron-builder uses for detection)
  ${nsProcess::KillProcess} "ExpressDelivery.exe" $R0
  ; Also taskkill as belt-and-suspenders (catches child processes)
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  ; Wait for process + file locks + OS mutex to fully release
  Sleep 5000
!macroend

!macro customInit
  ; Final kill in case something respawned between check and init
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  Sleep 1000
!macroend
