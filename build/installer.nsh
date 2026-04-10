; Custom NSIS actions for JMT Studio installer

!macro customInstall
  ; Notify Windows shell to refresh icon cache after install/update.
  ; This prevents stale shortcut icons when the logo changes between versions.
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
