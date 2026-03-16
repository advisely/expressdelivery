; Custom NSIS include for ExpressDelivery installer
; Auto-kills running instances before installation so the user
; is never blocked by the "ExpressDelivery is running" dialog.

!macro customInit
  ; Force-kill any running ExpressDelivery.exe process (silent, no error if not running)
  nsExec::ExecToStack 'taskkill /F /IM "ExpressDelivery.exe"'
  Pop $0
  ; Wait for process to fully exit and release file locks
  Sleep 2000
!macroend
