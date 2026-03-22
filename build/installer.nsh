; Custom NSIS include for ExpressDelivery installer
; Auto-kills running instances before installation so the user
; is never blocked by the "ExpressDelivery is running" dialog.

; customCheckAppRunning runs BEFORE electron-builder's process check.
; This ensures the process is killed before the check, avoiding the
; "application is running" blocking dialog.
!macro customCheckAppRunning
  ; Force-kill any running ExpressDelivery.exe process (silent, no error if not running)
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  ; Wait for process to fully exit and release file locks
  Sleep 3000
!macroend

!macro customInit
  ; Second kill in case process restarted between check and init
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  Sleep 1000
!macroend
