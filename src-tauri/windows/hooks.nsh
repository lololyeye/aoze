; Explorer context menu entry "Open with Aoze" for supported images, GIFs and clips.
; Written to HKCU (per-user install, no admin rights) and removed on uninstall.
; Also removes the entry left by the previous name of the app (Kirei).

!macro AOZE_REGISTER EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\Kirei"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\Aoze" "" "Open with Aoze"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\Aoze" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\Aoze\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro AOZE_UNREGISTER EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\Aoze"
!macroend

!macro AOZE_ALL MACRO
  !insertmacro ${MACRO} ".png"
  !insertmacro ${MACRO} ".jpg"
  !insertmacro ${MACRO} ".jpeg"
  !insertmacro ${MACRO} ".webp"
  !insertmacro ${MACRO} ".bmp"
  !insertmacro ${MACRO} ".tif"
  !insertmacro ${MACRO} ".tiff"
  !insertmacro ${MACRO} ".gif"
  !insertmacro ${MACRO} ".mp4"
  !insertmacro ${MACRO} ".mov"
  !insertmacro ${MACRO} ".mkv"
  !insertmacro ${MACRO} ".webm"
  !insertmacro ${MACRO} ".avi"
  !insertmacro ${MACRO} ".m4v"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro AOZE_ALL AOZE_REGISTER
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro AOZE_ALL AOZE_UNREGISTER
!macroend
