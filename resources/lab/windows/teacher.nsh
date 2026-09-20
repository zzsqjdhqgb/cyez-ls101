!macro customInstall
  ; nsExec::ExecToStack runs the command and pushes its exit code, then the captured output. `$1` is
  ; kept because a silent failure has nowhere else to leave a reason: the dialog below is skipped in
  ; that mode, and an unattended install that fails silently is only diagnosable from the log.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\lab-server\install-windows.ps1"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ; Silent installs must never raise a dialog. `MessageBox` blocks until somebody clicks it, and an
    ; installer launched by a deployment script, a management tool or an acceptance run has nobody to
    ; click it: the process then sits there forever and the failure is reported as a timeout with empty
    ; output. Reported by the M4 acceptance run (docs/lab-vm-acceptance-design.md section 13), where a
    ; refused upgrade hung for the full 900 s timeout.
    ;
    ; Interactive installs keep the explanation, because there the operator is the one who can act on
    ; it. `Abort` still runs in both modes, so a failed service installation never leaves a half-installed
    ; client behind — and the exit status is set explicitly, because `Abort` alone does not guarantee one.
    ${If} ${Silent}
      DetailPrint "Local service installation failed (exit $0). Existing service data has been retained."
      DetailPrint "$1"
      SetErrorLevel 2
    ${Else}
      MessageBox MB_ICONSTOP "Local service installation failed. Existing service data has been retained."
    ${EndIf}
    Abort
  ${EndIf}
!macroend
