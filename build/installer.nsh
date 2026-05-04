; Custom NSIS actions for JMT Studio installer

!macro customInstall
  ; New exe is already on disk at this point.
  ; Tell Explorer to re-read the icon for this specific file — fixes stale
  ; Start Menu and desktop shortcut icons when the logo changes between versions.
  ; SHCNE_UPDATEITEM = 0x2000, SHCNF_PATH|SHCNF_FLUSH = 0x0005
  System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x0005, t "$INSTDIR\JMT Studio.exe", i 0)'

  ; Register as "Open With" handler for .h files
  WriteRegStr HKCU "Software\Classes\JMTStudio.h" "" "ProffieOS Config File"
  WriteRegStr HKCU "Software\Classes\JMTStudio.h\DefaultIcon" "" "$INSTDIR\JMT Studio.exe,0"
  WriteRegStr HKCU "Software\Classes\JMTStudio.h\shell\open\command" "" '"$INSTDIR\JMT Studio.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.h\OpenWithProgids" "JMTStudio.h" ""

  ; Add to OpenWithList so JMT Studio appears in the fly-out submenu immediately
  StrCpy $R0 "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.h\OpenWithList"
  StrCpy $R1 "abcdefghijklmnopqrstuvwxyz"
  StrCpy $R2 0
  owl_find:
    StrCpy $R3 $R1 1 $R2
    StrCmp $R3 "" owl_done
    ReadRegStr $R4 HKCU "$R0" "$R3"
    StrCmp $R4 "JMT Studio.exe" owl_done
    StrCmp $R4 "" owl_add
    IntOp $R2 $R2 + 1
    Goto owl_find
  owl_add:
    ReadRegStr $R5 HKCU "$R0" "MRUList"
    WriteRegStr HKCU "$R0" "$R3" "JMT Studio.exe"
    WriteRegStr HKCU "$R0" "MRUList" "$R5$R3"
  owl_done:

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; Remove Open With registration
  DeleteRegValue HKCU "Software\Classes\.h\OpenWithProgids" "JMTStudio.h"
  DeleteRegKey HKCU "Software\Classes\JMTStudio.h"

  ; Remove from OpenWithList
  StrCpy $R0 "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.h\OpenWithList"
  StrCpy $R1 "abcdefghijklmnopqrstuvwxyz"
  StrCpy $R2 0
  uowl_find:
    StrCpy $R3 $R1 1 $R2
    StrCmp $R3 "" uowl_done
    ReadRegStr $R4 HKCU "$R0" "$R3"
    StrCmp $R4 "JMT Studio.exe" uowl_remove
    IntOp $R2 $R2 + 1
    Goto uowl_find
  uowl_remove:
    DeleteRegValue HKCU "$R0" "$R3"
  uowl_done:

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
