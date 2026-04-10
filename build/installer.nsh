; Custom NSIS actions for JMT Studio installer

!macro customInstall
  ; New exe is already on disk at this point.
  ; Tell Explorer to re-read the icon for this specific file — fixes stale
  ; Start Menu and desktop shortcut icons when the logo changes between versions.
  ; SHCNE_UPDATEITEM = 0x2000, SHCNF_PATH|SHCNF_FLUSH = 0x0005
  System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x0005, t "$INSTDIR\JMT Studio.exe", i 0)'
!macroend

!macro customUnInstall
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
