; Aoze installer.
;
; Based on Tauri's NSIS template (tauri-bundler 2.12, crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).
; What it installs and how (per-user, registry, shortcuts, WebView2, uninstaller, hooks) is unchanged.
; Only the installer pages are replaced: a single welcome screen with optional settings,
; a progress screen and a final "ready" screen, in the app's night-blue theme.
; Everything specific to Aoze is prefixed `Az`; the rest follows the upstream template.

Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

; Keep above !include to stay ahead of any plugin command
; see https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

!if "${INSTALLMODE}" == "both"
  !error "The Aoze installer template only supports the currentUser and perMachine install modes."
!endif

; The installer art lives next to the hooks file (src-tauri/windows/installer).
!define AZ_HOOKS "{{installer_hooks}}"
!searchreplace AZ_ART "${AZ_HOOKS}" "hooks.nsh" "installer"

; Theme, from src/styles/tokens.css. SetCtlColors takes 0xRRGGBB.
!define AZ_BG       0x0A0E15
!define AZ_SURFACE  0x141A24
!define AZ_TEXT     0xE9EDF3
!define AZ_TEXT2    0xA2ABB8
!define AZ_TEXT3    0x6A7484
!define AZ_ACCENT   0x3DD6D0
!define AZ_ACCENTINK 0x032321
; Win32 COLORREF values (0x00BBGGRR) for the progress bar, log list and title bar.
!define AZ_BG_REF      0x00150E0A
!define AZ_SURFACE_REF 0x00241A14
!define AZ_TRACK_REF   0x002C211A
!define AZ_TEXT_REF    0x00F3EDE9
!define AZ_TEXT2_REF   0x00B8ABA2
!define AZ_ACCENT_REF  0x00D0D63D

; Window client area, in 96 dpi pixels.
!define AZ_W 540
!define AZ_H 440

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName

Name "${PRODUCTNAME}"
Caption "$(azCaption)"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; Uninstaller icon
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; ---------------------------------------------------------------------------
; Aoze installer UI
; ---------------------------------------------------------------------------

; Logo bitmaps, one per display scale; reserved so they extract instantly with solid compression.
ReserveFile "${AZ_ART}\logo-72.bmp"
ReserveFile "${AZ_ART}\logo-90.bmp"
ReserveFile "${AZ_ART}\logo-108.bmp"
ReserveFile "${AZ_ART}\logo-126.bmp"
ReserveFile "${AZ_ART}\logo-144.bmp"
ReserveFile "${AZ_ART}\logo-180.bmp"
ReserveFile "${AZ_ART}\logo-216.bmp"
ReserveFile /plugin nsDialogs.dll
ReserveFile /plugin System.dll

!define MUI_CUSTOMFUNCTION_GUIINIT AzGuiInit

!define /ifndef WS_BORDER          0x00800000
!define /ifndef WS_CLIPSIBLINGS    0x04000000
!define /ifndef WS_EX_STATICEDGE   0x00020000
!define /ifndef PBS_SMOOTH         0x01
!define /ifndef LVM_SETBKCOLOR     0x1001
!define /ifndef LVM_SETCOLUMNWIDTH 0x101E
!define /ifndef LVM_SETTEXTCOLOR   0x1024
!define /ifndef LVM_SETTEXTBKCOLOR 0x1026
!define AZ_SS_BUTTON 0x201 ; SS_CENTER | SS_CENTERIMAGE
!define AZ_EX_EDGES  0x20200 ; WS_EX_CLIENTEDGE | WS_EX_STATICEDGE

Var AzDpi
Var AzX
Var AzY
Var AzW
Var AzH
Var AzT1
Var AzT2
Var AzTop
Var AzFontDisplay
Var AzFontTitle
Var AzFontBody
Var AzFontButton
Var AzFontSmall
Var AzFontGlyph
Var AzFontGlyphSmall
Var AzLogoImage
Var AzLogoSize
Var AzGlyphCheckOn
Var AzGlyphCheckOff
Var AzGlyphDone
Var AzGlyphActive
Var AzGlyphPending

; Previous installation: "" none, 0 same version, 1 older, -1 newer
Var AzExisting
Var AzExistingVersion
Var AzWixKey

; Welcome page
Var AzDialog
Var AzLogo
Var AzHeadline
Var AzSub
Var AzInstallButton
Var AzOptionsLink
Var AzOptionsShown
Var AzDirLabel
Var AzDirBox
Var AzDirEdit
Var AzDirChange
Var AzDeskGlyph
Var AzDeskText
Var AzDesktopShortcut

; Progress page
Var AzInstPage
Var AzProgressTitle
Var AzProgressBar
Var AzStatus
Var AzStep
Var AzStepGlyph1
Var AzStepGlyph2
Var AzStepGlyph3
Var AzStepText1
Var AzStepText2
Var AzStepText3

; Finish page
Var AzLaunchButton
Var AzCloseLink
Var AzFinishAction

; Scales a 96 dpi length to the window's dpi.
!macro AzScale OUT VALUE
  IntOp ${OUT} ${VALUE} * $AzDpi
  IntOp ${OUT} ${OUT} / 96
!macroend

; Moves and sizes a control, in 96 dpi pixels.
!macro AzPlace HWND X Y W H
  !insertmacro AzScale $AzX ${X}
  !insertmacro AzScale $AzY ${Y}
  !insertmacro AzScale $AzW ${W}
  !insertmacro AzScale $AzH ${H}
  System::Call 'user32::SetWindowPos(p ${HWND}, p 0, i $AzX, i $AzY, i $AzW, i $AzH, i 0x34)'
!macroend

; Rounds the corners of the control placed last.
!macro AzRound HWND RADIUS
  !insertmacro AzScale $AzT1 ${RADIUS}
  IntOp $AzT1 $AzT1 * 2
  IntOp $AzW $AzW + 1
  IntOp $AzH $AzH + 1
  System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i $AzW, i $AzH, i $AzT1, i $AzT1) p .s'
  Pop $AzT2
  System::Call 'user32::SetWindowRgn(p ${HWND}, p $AzT2, i 1)'
!macroend

!macro AzFont VAR SIZE WEIGHT FACE
  !insertmacro AzScale $AzT1 ${SIZE}
  IntOp $AzT1 0 - $AzT1
  System::Call 'gdi32::CreateFontW(i $AzT1, i 0, i 0, i 0, i ${WEIGHT}, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "${FACE}") p .s'
  Pop ${VAR}
!macroend

!macro AzShow HWND SHOW
  ${If} ${SHOW} = 1
    ShowWindow ${HWND} ${SW_SHOW}
  ${Else}
    ShowWindow ${HWND} ${SW_HIDE}
  ${EndIf}
!macroend

; A plain text label on an nsDialogs page.
!macro AzLabel VAR TEXT FONT COLOR BG
  ${NSD_CreateLabel} 0 0 1 1 "${TEXT}"
  Pop ${VAR}
  SendMessage ${VAR} ${WM_SETFONT} ${FONT} 1
  SetCtlColors ${VAR} ${COLOR} ${BG}
!macroend

; A static control created on a page that is not an nsDialogs page (the progress page).
!macro AzStatic VAR PARENT TEXT FONT COLOR STYLE
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i ${STYLE}, i 0, i 0, i 1, i 1, p ${PARENT}, p 0, p 0, p 0) p .s'
  Pop ${VAR}
  SendMessage ${VAR} ${WM_SETTEXT} 0 "STR:${TEXT}"
  SendMessage ${VAR} ${WM_SETFONT} ${FONT} 1
  SetCtlColors ${VAR} ${COLOR} ${AZ_BG}
!macroend

Function AzGuiInit
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .s'
  Pop $AzDpi
  ${If} $AzDpi < 96
    StrCpy $AzDpi 96
  ${EndIf}

  ; Dark title bar matching the window (Windows 10 20H1+, colours on Windows 11).
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${AZ_BG_REF}, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i ${AZ_TEXT_REF}, i 4)'

  SetCtlColors $HWNDPARENT ${AZ_TEXT} ${AZ_BG}
  ${NSD_RemoveStyle} $HWNDPARENT 0x00010000 ; WS_MAXIMIZEBOX

  ; Resize the window around a ${AZ_W}x${AZ_H} client area, keeping it centred where it was.
  System::Call '*(i, i, i, i) p .s'
  Pop $AzT1
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p $AzT1)'
  System::Call '*$AzT1(i .r0, i .r1, i .r2, i .r3)'
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p $AzT1)'
  System::Call '*$AzT1(i, i, i .r4, i .r5)'
  System::Free $AzT1
  IntOp $2 $2 - $0 ; window width
  IntOp $3 $3 - $1 ; window height
  IntOp $6 $2 - $4 ; frame width
  IntOp $7 $3 - $5 ; frame height
  !insertmacro AzScale $8 ${AZ_W}
  !insertmacro AzScale $9 ${AZ_H}
  IntOp $4 $8 + $6
  IntOp $5 $9 + $7
  IntOp $6 $2 - $4
  IntOp $6 $6 / 2
  IntOp $0 $0 + $6
  IntOp $7 $3 - $5
  IntOp $7 $7 / 2
  IntOp $1 $1 + $7
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i r4, i r5, i 0x34)'

  ; Pages fill the whole client area.
  GetDlgItem $0 $HWNDPARENT 1018
  System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i r8, i r9, i 0x14)'
  Call AzHideChrome

  !insertmacro AzFont $AzFontDisplay 26 600 "Segoe UI"
  !insertmacro AzFont $AzFontTitle 22 600 "Segoe UI"
  !insertmacro AzFont $AzFontBody 15 400 "Segoe UI"
  !insertmacro AzFont $AzFontButton 15 600 "Segoe UI"
  !insertmacro AzFont $AzFontSmall 13 400 "Segoe UI"
  !insertmacro AzFont $AzFontGlyph 18 400 "Segoe MDL2 Assets"
  !insertmacro AzFont $AzFontGlyphSmall 12 400 "Segoe MDL2 Assets"

  IntFmt $AzGlyphCheckOn "%c" 0xE73A
  IntFmt $AzGlyphCheckOff "%c" 0xE739
  IntFmt $AzGlyphDone "%c" 0xE73E
  IntFmt $AzGlyphActive "%c" 0xEA3B
  IntFmt $AzGlyphPending "%c" 0xEA3A

  ; Logo bitmap drawn for this display scale.
  InitPluginsDir
  !insertmacro AzScale $AzLogoSize 72
  ${If} $AzLogoSize <= 72
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-72.bmp"
  ${ElseIf} $AzLogoSize <= 90
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-90.bmp"
  ${ElseIf} $AzLogoSize <= 108
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-108.bmp"
  ${ElseIf} $AzLogoSize <= 126
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-126.bmp"
  ${ElseIf} $AzLogoSize <= 144
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-144.bmp"
  ${ElseIf} $AzLogoSize <= 180
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-180.bmp"
  ${Else}
    File "/oname=$PLUGINSDIR\az-logo.bmp" "${AZ_ART}\logo-216.bmp"
  ${EndIf}
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\az-logo.bmp", i 0, i $AzLogoSize, i $AzLogoSize, i 0x10) p .s'
  Pop $AzLogoImage
FunctionEnd

; Hides the stock wizard chrome (header, buttons, separator, branding).
; Runs on every page because NSIS shows some buttons again when pages change.
Function AzHideChrome
  StrCpy $AzT1 0
  ${Do}
    FindWindow $AzT1 "" "" $HWNDPARENT $AzT1
    ${If} $AzT1 = 0
      ${Break}
    ${EndIf}
    System::Call 'user32::GetDlgCtrlID(p $AzT1) i .s'
    Pop $AzT2
    ${If} $AzT2 <> 1018
      System::Call 'user32::GetClassNameW(p $AzT1, w .s, i 64)'
      Pop $AzT2
      ${If} $AzT2 != "#32770"
        ShowWindow $AzT1 ${SW_HIDE}
      ${EndIf}
    ${EndIf}
  ${Loop}
FunctionEnd

Function AzNext
  SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
FunctionEnd

Function AzInstallClick
  Pop $AzT1
  Call AzNext
FunctionEnd

Function AzCreateLogo
  ${NSD_CreateBitmap} 0 0 1 1 ""
  Pop $AzLogo
  SendMessage $AzLogo 0x0172 0 $AzLogoImage ; STM_SETIMAGE, IMAGE_BITMAP
FunctionEnd

; Find an earlier installation and compare its version with this one.
Function AzDetectExisting
  StrCpy $AzExisting ""
  StrCpy $AzExistingVersion ""
  StrCpy $AzWixKey ""

  Call FindWixInstall
  ${If} $R6 != ""
    StrCpy $WixMode 1
    StrCpy $AzWixKey $R6
    ReadRegStr $AzExistingVersion HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
    ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
    ${IfThen} "$R0$R1" == "" ${|} Return ${|}
    ReadRegStr $AzExistingVersion SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}

  nsis_tauri_utils::SemverCompare "${VERSION}" $AzExistingVersion
  Pop $AzExisting
  ${IfThen} $AzExistingVersion == "" ${|} StrCpy $AzExistingVersion "$(unknown)" ${|}
FunctionEnd

; Find a previous WiX installation and set $R6 to its uninstall registry key, or to "" if none.
;
; A WiX installer stores the installation info in registry
; using a UUID and so we have to loop through all keys under
; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
;
; This has a potential issue that there maybe another installation that matches
; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
; however, this should be fine since the user will have to confirm the uninstallation
; and they can chose to abort it if doesn't make sense.
Function FindWixInstall
  StrCpy $R6 ""
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
  wix_loop_done:
FunctionEnd

; 1. Welcome: logo, tagline, Install button, optional location and desktop shortcut.
Page custom AzWelcomePage AzWelcomeLeave

Function AzWelcomePage
  ${IfThen} $PassiveMode = 1 ${|} Abort ${|}

  nsDialogs::Create 1018
  Pop $AzDialog
  ${If} $AzDialog == error
    Abort
  ${EndIf}
  SetCtlColors $AzDialog ${AZ_TEXT} ${AZ_BG}
  Call AzHideChrome

  Call AzCreateLogo

  !insertmacro AzLabel $AzHeadline "$(azHeadline)" $AzFontDisplay ${AZ_TEXT} ${AZ_BG}
  ${NSD_AddStyle} $AzHeadline ${SS_CENTER}

  ${If} $AzExisting == ""
    StrCpy $AzT1 "$(azSubNew)"
  ${ElseIf} $AzExisting = 0
    StrCpy $AzT1 "$(azSubSame)"
  ${ElseIf} $AzExisting = 1
    StrCpy $AzT1 "$(azSubUpdate)"
  ${Else}
    StrCpy $AzT1 "$(azSubNewer)"
  ${EndIf}
  !insertmacro AzLabel $AzSub $AzT1 $AzFontSmall ${AZ_TEXT3} ${AZ_BG}
  ${NSD_AddStyle} $AzSub ${SS_CENTER}

  ${If} $AzExisting == 1
    StrCpy $AzT1 "$(azUpdate)"
  ${ElseIf} $AzExisting == 0
    StrCpy $AzT1 "$(azReinstall)"
  ${Else}
    StrCpy $AzT1 "$(azInstall)"
  ${EndIf}
  !insertmacro AzLabel $AzInstallButton $AzT1 $AzFontButton ${AZ_ACCENTINK} ${AZ_ACCENT}
  ${NSD_AddStyle} $AzInstallButton ${AZ_SS_BUTTON}
  ${NSD_OnClick} $AzInstallButton AzInstallClick

  !insertmacro AzLabel $AzOptionsLink "$(azOptions)" $AzFontSmall ${AZ_TEXT2} ${AZ_BG}
  ${NSD_AddStyle} $AzOptionsLink ${SS_CENTER}
  ${NSD_OnClick} $AzOptionsLink AzToggleOptions

  !insertmacro AzLabel $AzDirLabel "$(azLocation)" $AzFontSmall ${AZ_TEXT2} ${AZ_BG}

  ; The location field: an edit control on a rounded surface, with a Change link inside.
  ${NSD_CreateText} 0 0 1 1 $INSTDIR
  Pop $AzDirEdit
  ${NSD_RemoveExStyle} $AzDirEdit ${WS_EX_CLIENTEDGE}
  SendMessage $AzDirEdit ${WM_SETFONT} $AzFontSmall 1
  SetCtlColors $AzDirEdit ${AZ_TEXT} ${AZ_SURFACE}

  !insertmacro AzLabel $AzDirChange "$(azChange)" $AzFontSmall ${AZ_ACCENT} ${AZ_SURFACE}
  ${NSD_AddStyle} $AzDirChange ${SS_RIGHT}
  ${NSD_OnClick} $AzDirChange AzChangeDir

  !insertmacro AzLabel $AzDirBox "" $AzFontSmall ${AZ_TEXT} ${AZ_SURFACE}
  ${NSD_AddStyle} $AzDirBox ${WS_CLIPSIBLINGS}

  !insertmacro AzLabel $AzDeskGlyph "" $AzFontGlyph ${AZ_ACCENT} ${AZ_BG}
  ${NSD_OnClick} $AzDeskGlyph AzToggleDesktop
  !insertmacro AzLabel $AzDeskText "$(azDesktop)" $AzFontSmall ${AZ_TEXT} ${AZ_BG}
  ${NSD_AddStyle} $AzDeskText ${SS_CENTERIMAGE}
  ${NSD_OnClick} $AzDeskText AzToggleDesktop
  Call AzPaintDesktop

  Call AzWelcomeLayout
  nsDialogs::Show
FunctionEnd

Function AzWelcomeLayout
  ${If} $AzOptionsShown = 1
    StrCpy $AzTop 30
  ${Else}
    StrCpy $AzTop 90
  ${EndIf}

  !insertmacro AzPlace $AzLogo 234 $AzTop 72 72
  IntOp $AzTop $AzTop + 96
  !insertmacro AzPlace $AzHeadline 20 $AzTop 500 38
  IntOp $AzTop $AzTop + 42
  !insertmacro AzPlace $AzSub 20 $AzTop 500 20
  IntOp $AzTop $AzTop + 46
  !insertmacro AzPlace $AzInstallButton 170 $AzTop 200 42
  !insertmacro AzRound $AzInstallButton 10
  IntOp $AzTop $AzTop + 56
  !insertmacro AzPlace $AzOptionsLink 190 $AzTop 160 20
  IntOp $AzTop $AzTop + 42

  !insertmacro AzPlace $AzDirLabel 90 $AzTop 360 18
  IntOp $AzTop $AzTop + 24
  !insertmacro AzPlace $AzDirBox 90 $AzTop 360 36
  !insertmacro AzRound $AzDirBox 8
  System::Call 'user32::SetWindowPos(p $AzDirBox, p 1, i 0, i 0, i 0, i 0, i 0x13)' ; keep it behind the field
  IntOp $AzT1 $AzTop + 9
  !insertmacro AzPlace $AzDirEdit 102 $AzT1 270 20
  !insertmacro AzPlace $AzDirChange 378 $AzT1 60 20
  IntOp $AzTop $AzTop + 50
  !insertmacro AzPlace $AzDeskGlyph 90 $AzTop 22 22
  !insertmacro AzPlace $AzDeskText 118 $AzTop 300 22

  !insertmacro AzShow $AzDirLabel $AzOptionsShown
  !insertmacro AzShow $AzDirBox $AzOptionsShown
  !insertmacro AzShow $AzDirEdit $AzOptionsShown
  !insertmacro AzShow $AzDirChange $AzOptionsShown
  !insertmacro AzShow $AzDeskGlyph $AzOptionsShown
  !insertmacro AzShow $AzDeskText $AzOptionsShown
  System::Call 'user32::RedrawWindow(p $AzDialog, p 0, p 0, i 0x85)' ; RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN
FunctionEnd

Function AzToggleOptions
  Pop $AzT1 ; clicked control
  ${If} $AzOptionsShown = 1
    StrCpy $AzOptionsShown 0
    SendMessage $AzOptionsLink ${WM_SETTEXT} 0 "STR:$(azOptions)"
  ${Else}
    StrCpy $AzOptionsShown 1
    SendMessage $AzOptionsLink ${WM_SETTEXT} 0 "STR:$(azHideOptions)"
  ${EndIf}
  Call AzWelcomeLayout
FunctionEnd

Function AzToggleDesktop
  Pop $AzT1
  ${If} $AzDesktopShortcut = 1
    StrCpy $AzDesktopShortcut 0
  ${Else}
    StrCpy $AzDesktopShortcut 1
  ${EndIf}
  Call AzPaintDesktop
FunctionEnd

Function AzPaintDesktop
  ${If} $AzDesktopShortcut = 1
    SendMessage $AzDeskGlyph ${WM_SETTEXT} 0 "STR:$AzGlyphCheckOn"
    SetCtlColors $AzDeskGlyph ${AZ_ACCENT} ${AZ_BG}
  ${Else}
    SendMessage $AzDeskGlyph ${WM_SETTEXT} 0 "STR:$AzGlyphCheckOff"
    SetCtlColors $AzDeskGlyph ${AZ_TEXT3} ${AZ_BG}
  ${EndIf}
  System::Call 'user32::InvalidateRect(p $AzDeskGlyph, p 0, i 1)'
FunctionEnd

Function AzChangeDir
  Pop $AzT1
  ${NSD_GetText} $AzDirEdit $AzT1
  nsDialogs::SelectFolderDialog "$(azChooseFolder)" $AzT1
  Pop $AzT1
  ${If} $AzT1 == error
  ${OrIf} $AzT1 == ""
    Return
  ${EndIf}
  ; Like the stock directory page, install into an "Aoze" folder inside the chosen one.
  StrCpy $AzT2 $AzT1 1 -1
  ${IfThen} $AzT2 == "\" ${|} StrCpy $AzT1 $AzT1 -1 ${|}
  ${GetFileName} $AzT1 $AzT2
  ${If} $AzT2 != "${PRODUCTNAME}"
    StrCpy $AzT1 "$AzT1\${PRODUCTNAME}"
  ${EndIf}
  ${NSD_SetText} $AzDirEdit $AzT1
FunctionEnd

Function AzWelcomeLeave
  ${NSD_GetText} $AzDirEdit $AzT1
  StrCpy $AzT2 $AzT1 1 -1
  ${IfThen} $AzT2 == "\" ${|} StrCpy $AzT1 $AzT1 -1 ${|}
  ${If} $AzT1 == ""
    ${If} $AzOptionsShown <> 1
      Push 0
      Call AzToggleOptions
    ${EndIf}
    ${NSD_SetFocus} $AzDirEdit
    Abort
  ${EndIf}
  StrCpy $INSTDIR $AzT1
FunctionEnd

; Start menu folder: never asked, the default (or `startMenuFolder`) is used.
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!endif
!define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 2. Progress: title, real progress bar and the three install steps.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW AzProgressShow
!insertmacro MUI_PAGE_INSTFILES

Function AzProgressShow
  Call AzHideChrome
  FindWindow $AzInstPage "#32770" "" $HWNDPARENT
  SetCtlColors $AzInstPage ${AZ_TEXT} ${AZ_BG}
  ; The stock page keeps its own (smaller) size, stretch it over the window.
  !insertmacro AzPlace $AzInstPage 0 0 ${AZ_W} ${AZ_H}

  GetDlgItem $AzT1 $AzInstPage 1016 ; details list
  ShowWindow $AzT1 ${SW_HIDE}
  GetDlgItem $AzT1 $AzInstPage 1027 ; "Show details"
  ShowWindow $AzT1 ${SW_HIDE}

  ; Status line: WebView2 download messages, and why the install stopped if it fails.
  ; The install sections keep routine output (file names) out of it.
  GetDlgItem $AzStatus $AzInstPage 1006
  ${NSD_RemoveStyle} $AzStatus 0x0C ; SS_LEFTNOWORDWRAP -> SS_LEFT, so long messages wrap
  SendMessage $AzStatus ${WM_SETFONT} $AzFontSmall 1
  SetCtlColors $AzStatus ${AZ_TEXT2} ${AZ_BG}
  !insertmacro AzPlace $AzStatus 70 318 400 54

  ; Flat, thin accent bar on a dark track.
  GetDlgItem $AzProgressBar $AzInstPage 1004
  System::Call 'uxtheme::SetWindowTheme(p $AzProgressBar, w " ", w " ")'
  ${NSD_RemoveStyle} $AzProgressBar ${WS_BORDER}
  ${NSD_RemoveExStyle} $AzProgressBar ${AZ_EX_EDGES}
  ${NSD_AddStyle} $AzProgressBar ${PBS_SMOOTH}
  SendMessage $AzProgressBar ${PBM_SETBARCOLOR} 0 ${AZ_ACCENT_REF}
  SendMessage $AzProgressBar ${PBM_SETBKCOLOR} 0 ${AZ_TRACK_REF}
  !insertmacro AzPlace $AzProgressBar 70 174 400 6
  !insertmacro AzRound $AzProgressBar 3

  !insertmacro AzStatic $AzProgressTitle $AzInstPage "$(azInstalling)" $AzFontTitle ${AZ_TEXT} 0x50000080
  !insertmacro AzPlace $AzProgressTitle 70 122 400 34

  !insertmacro AzStatic $AzStepGlyph1 $AzInstPage "" $AzFontGlyphSmall ${AZ_TEXT3} 0x50000201
  !insertmacro AzStatic $AzStepGlyph2 $AzInstPage "" $AzFontGlyphSmall ${AZ_TEXT3} 0x50000201
  !insertmacro AzStatic $AzStepGlyph3 $AzInstPage "" $AzFontGlyphSmall ${AZ_TEXT3} 0x50000201
  !insertmacro AzStatic $AzStepText1 $AzInstPage "$(azStep1)" $AzFontBody ${AZ_TEXT3} 0x50000280
  !insertmacro AzStatic $AzStepText2 $AzInstPage "$(azStep2)" $AzFontBody ${AZ_TEXT3} 0x50000280
  !insertmacro AzStatic $AzStepText3 $AzInstPage "$(azStep3)" $AzFontBody ${AZ_TEXT3} 0x50000280
  !insertmacro AzPlace $AzStepGlyph1 70 206 18 28
  !insertmacro AzPlace $AzStepText1 100 206 370 28
  !insertmacro AzPlace $AzStepGlyph2 70 238 18 28
  !insertmacro AzPlace $AzStepText2 100 238 370 28
  !insertmacro AzPlace $AzStepGlyph3 70 270 18 28
  !insertmacro AzPlace $AzStepText3 100 270 370 28

  ${IfThen} $AzStep == "" ${|} StrCpy $AzStep 1 ${|}
  Call AzPaintSteps
FunctionEnd

!macro AzPaintStep N GLYPH TEXT
  ${If} $AzStep > ${N}
    SendMessage ${GLYPH} ${WM_SETTEXT} 0 "STR:$AzGlyphDone"
    SetCtlColors ${GLYPH} ${AZ_ACCENT} ${AZ_BG}
    SetCtlColors ${TEXT} ${AZ_TEXT2} ${AZ_BG}
  ${ElseIf} $AzStep = ${N}
    SendMessage ${GLYPH} ${WM_SETTEXT} 0 "STR:$AzGlyphActive"
    SetCtlColors ${GLYPH} ${AZ_ACCENT} ${AZ_BG}
    SetCtlColors ${TEXT} ${AZ_TEXT} ${AZ_BG}
  ${Else}
    SendMessage ${GLYPH} ${WM_SETTEXT} 0 "STR:$AzGlyphPending"
    SetCtlColors ${GLYPH} ${AZ_TEXT3} ${AZ_BG}
    SetCtlColors ${TEXT} ${AZ_TEXT3} ${AZ_BG}
  ${EndIf}
  System::Call 'user32::InvalidateRect(p ${GLYPH}, p 0, i 1)'
  System::Call 'user32::InvalidateRect(p ${TEXT}, p 0, i 1)'
!macroend

; Called from the install sections (worker thread): only touches Az variables.
Function AzPaintSteps
  ${IfThen} $AzStepText1 == "" ${|} Return ${|}
  !insertmacro AzPaintStep 1 $AzStepGlyph1 $AzStepText1
  !insertmacro AzPaintStep 2 $AzStepGlyph2 $AzStepText2
  !insertmacro AzPaintStep 3 $AzStepGlyph3 $AzStepText3
FunctionEnd

!macro AzSetStep N
  StrCpy $AzStep ${N}
  Call AzPaintSteps
!macroend

; 3. Ready: Launch Aoze, or close.
Page custom AzFinishPage AzFinishLeave

Function AzFinishPage
  ${IfThen} $PassiveMode = 1 ${|} Abort ${|}

  nsDialogs::Create 1018
  Pop $AzDialog
  ${If} $AzDialog == error
    Abort
  ${EndIf}
  SetCtlColors $AzDialog ${AZ_TEXT} ${AZ_BG}
  Call AzHideChrome
  ; Let the title bar's close button close the installer without launching the app.
  GetDlgItem $AzT1 $HWNDPARENT 2
  EnableWindow $AzT1 1
  System::Call 'user32::GetSystemMenu(p $HWNDPARENT, i 0) p .s'
  Pop $AzT1
  System::Call 'user32::EnableMenuItem(p $AzT1, i 0xF060, i 0)' ; SC_CLOSE, MF_ENABLED

  Call AzCreateLogo
  !insertmacro AzLabel $AzHeadline "$(azReady)" $AzFontDisplay ${AZ_TEXT} ${AZ_BG}
  ${NSD_AddStyle} $AzHeadline ${SS_CENTER}
  !insertmacro AzLabel $AzSub "$(azReadyHint)" $AzFontBody ${AZ_TEXT2} ${AZ_BG}
  ${NSD_AddStyle} $AzSub ${SS_CENTER}
  !insertmacro AzLabel $AzLaunchButton "$(azLaunch)" $AzFontButton ${AZ_ACCENTINK} ${AZ_ACCENT}
  ${NSD_AddStyle} $AzLaunchButton ${AZ_SS_BUTTON}
  ${NSD_OnClick} $AzLaunchButton AzLaunch
  !insertmacro AzLabel $AzCloseLink "$(azClose)" $AzFontSmall ${AZ_TEXT2} ${AZ_BG}
  ${NSD_AddStyle} $AzCloseLink ${SS_CENTER}
  ${NSD_OnClick} $AzCloseLink AzClose

  StrCpy $AzTop 76
  !insertmacro AzPlace $AzLogo 234 $AzTop 72 72
  IntOp $AzTop $AzTop + 96
  !insertmacro AzPlace $AzHeadline 20 $AzTop 500 38
  IntOp $AzTop $AzTop + 44
  !insertmacro AzPlace $AzSub 80 $AzTop 380 44
  IntOp $AzTop $AzTop + 72
  !insertmacro AzPlace $AzLaunchButton 170 $AzTop 200 42
  !insertmacro AzRound $AzLaunchButton 10
  IntOp $AzTop $AzTop + 56
  !insertmacro AzPlace $AzCloseLink 210 $AzTop 120 20

  nsDialogs::Show
FunctionEnd

Function AzLaunch
  Pop $AzT1
  StrCpy $AzFinishAction "launch"
  Call AzNext
FunctionEnd

Function AzClose
  Pop $AzT1
  StrCpy $AzFinishAction "close"
  Call AzNext
FunctionEnd

; Enter on this page launches too, like the primary button.
Function AzFinishLeave
  ${If} $AzFinishAction != "close"
    Call RunMainBinary
  ${EndIf}
FunctionEnd

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
; PageReinstall reads the misspelled `choowHowToInstall` as a fallback, and makensis warns
; about a language string that is read but never set, so default it to an empty string for
; every language. This runs before the language files are included, so a custom language
; file that only defines the old spelling overrides the default and the fallback shows its
; text. `0` as the language id means the language inserted right above.
; TODO: remove the `choowHowToInstall` fallback in a future major version
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
LangString choowHowToInstall 0 ""
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

; Strings of the Aoze pages.
!ifdef LANG_ENGLISH
  LangString azCaption ${LANG_ENGLISH} "Aoze Setup"
  LangString azHeadline ${LANG_ENGLISH} "Make your media look better."
  LangString azSubNew ${LANG_ENGLISH} "Aoze ${VERSION} for Windows"
  LangString azSubSame ${LANG_ENGLISH} "Aoze ${VERSION} is already installed"
  LangString azSubUpdate ${LANG_ENGLISH} "Updates Aoze $AzExistingVersion to ${VERSION}"
  LangString azSubNewer ${LANG_ENGLISH} "Replaces the newer Aoze $AzExistingVersion with ${VERSION}"
  LangString azInstall ${LANG_ENGLISH} "Install"
  LangString azUpdate ${LANG_ENGLISH} "Update"
  LangString azReinstall ${LANG_ENGLISH} "Reinstall"
  LangString azOptions ${LANG_ENGLISH} "Options"
  LangString azHideOptions ${LANG_ENGLISH} "Hide options"
  LangString azLocation ${LANG_ENGLISH} "Install location"
  LangString azChange ${LANG_ENGLISH} "Change"
  LangString azChooseFolder ${LANG_ENGLISH} "Choose where to install Aoze."
  LangString azDesktop ${LANG_ENGLISH} "Desktop shortcut"
  LangString azInstalling ${LANG_ENGLISH} "Installing Aoze"
  LangString azStep1 ${LANG_ENGLISH} "Getting ready"
  LangString azStep2 ${LANG_ENGLISH} "Copying files"
  LangString azStep3 ${LANG_ENGLISH} "Adding shortcuts and the Explorer menu"
  LangString azFailed ${LANG_ENGLISH} "Aoze could not be installed"
  LangString azReady ${LANG_ENGLISH} "Aoze is ready."
  LangString azReadyHint ${LANG_ENGLISH} "Find it in the Start menu, or right-click a picture or clip and choose Open with Aoze."
  LangString azLaunch ${LANG_ENGLISH} "Launch Aoze"
  LangString azClose ${LANG_ENGLISH} "Close"
!endif
!ifdef LANG_FRENCH
  LangString azCaption ${LANG_FRENCH} "Installation d'Aoze"
  LangString azHeadline ${LANG_FRENCH} "Rendez vos médias plus beaux."
  LangString azSubNew ${LANG_FRENCH} "Aoze ${VERSION} pour Windows"
  LangString azSubSame ${LANG_FRENCH} "Aoze ${VERSION} est déjà installé"
  LangString azSubUpdate ${LANG_FRENCH} "Met à jour Aoze $AzExistingVersion vers la ${VERSION}"
  LangString azSubNewer ${LANG_FRENCH} "Remplace Aoze $AzExistingVersion, plus récent, par la ${VERSION}"
  LangString azInstall ${LANG_FRENCH} "Installer"
  LangString azUpdate ${LANG_FRENCH} "Mettre à jour"
  LangString azReinstall ${LANG_FRENCH} "Réinstaller"
  LangString azOptions ${LANG_FRENCH} "Options"
  LangString azHideOptions ${LANG_FRENCH} "Masquer les options"
  LangString azLocation ${LANG_FRENCH} "Emplacement d'installation"
  LangString azChange ${LANG_FRENCH} "Modifier"
  LangString azChooseFolder ${LANG_FRENCH} "Choisissez où installer Aoze."
  LangString azDesktop ${LANG_FRENCH} "Raccourci sur le bureau"
  LangString azInstalling ${LANG_FRENCH} "Installation d'Aoze"
  LangString azStep1 ${LANG_FRENCH} "Préparation"
  LangString azStep2 ${LANG_FRENCH} "Copie des fichiers"
  LangString azStep3 ${LANG_FRENCH} "Ajout des raccourcis et du menu de l'Explorateur"
  LangString azFailed ${LANG_FRENCH} "Aoze n'a pas pu être installé"
  LangString azReady ${LANG_FRENCH} "Aoze est prêt."
  LangString azReadyHint ${LANG_FRENCH} "Retrouvez-le dans le menu Démarrer, ou faites un clic droit sur une image ou un clip, puis Open with Aoze."
  LangString azLaunch ${LANG_FRENCH} "Lancer Aoze"
  LangString azClose ${LANG_FRENCH} "Fermer"
!endif

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}

  StrCpy $AzDesktopShortcut 1
  StrCpy $AzOptionsShown 0
  Call AzDetectExisting

  ; Abort downgrades if they are disabled, in the modes that skip the reinstall page choice:
  ; silent, passive and update
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ; Compare with the same installation the reinstall page would: a WiX one first
    Call FindWixInstall
    ${If} $R6 != ""
      ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
    ${Else}
      ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
    ${EndIf}
    nsis_tauri_utils::SemverCompare "${VERSION}" $R0
    Pop $R0
    ; If downgrading
    ${If} $R0 = -1
      ${If} ${Silent}
        System::Call 'kernel32::AttachConsole(i -1)i.r0'
        ${If} $0 <> 0
          System::Call 'kernel32::GetStdHandle(i -11)i.r0'
          System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
          FileWrite $0 "$(silentDowngrades)"
        ${EndIf}
      ${Else}
        MessageBox MB_ICONSTOP "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif
FunctionEnd

; Step 1: remove an earlier version when the stock wizard would have offered to
; ("uninstall before installing" for other versions, always for a WiX install).
; The old NSIS uninstaller runs silently with /UPDATE so shortcuts, pins and app data stay.
; Passive, silent and update runs install over the top, as before.
Section AzPrepare
  !insertmacro AzSetStep 1

  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ${If} $WixMode = 1
    ${AndIfNot} ${Silent}
      Goto az_uninstall_wix
    ${EndIf}
    Goto az_prepare_done
  ${EndIf}

  ${If} $WixMode = 1
    az_uninstall_wix:
    ReadRegStr $R1 HKLM "$AzWixKey" "UninstallString"
    ClearErrors
    ExecWait '$R1' $0
    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|}
    ${If} $0 <> 0
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort "$(unableToUninstall)"
    ${EndIf}
    Goto az_prepare_done
  ${EndIf}

  ${If} $AzExisting == ""
  ${OrIf} $AzExisting == 0
    Goto az_prepare_done
  ${EndIf}

  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $4 == ""
    ReadRegStr $4 SHCTX "${UNINSTKEY}" "InstallLocation"
    nsis_tauri_utils::StrReplace "$4" '"' ""
    Pop $4
  ${EndIf}
  ${If} $4 == ""
    Goto az_prepare_done
  ${EndIf}

  ; Ask before the silent uninstaller would close a running Aoze on its own.
  !insertmacro CheckIfAppIsRunning "$4\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Read after the check, which uses $R0-$R3.
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${If} $R1 == ""
    Goto az_prepare_done
  ${EndIf}
  ClearErrors
  ExecWait '$R1 /S /UPDATE _?=$4' $0
  ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|}
  ${If} $0 <> 0
  ${OrIf} ${FileExists} "$4\${MAINBINARYNAME}.exe"
    MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
    Abort "$(unableToUninstall)"
  ${EndIf}
  ; The uninstaller ran in place (`_?=`), so it could not delete itself and its folder.
  Delete "$4\uninstall.exe"
  RMDir "$4"

  az_prepare_done:
SectionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  !insertmacro AzSetStep 2
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  ; Only the reason of a failure reaches the status line; file names go nowhere.
  SetDetailsPrint textonly
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  SetDetailsPrint none

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0" "Open with ${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  !insertmacro AzSetStep 3

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  SetDetailsPrint none ; GetSize turns it back on
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Desktop shortcut: always for silent and passive installers,
  ; otherwise when the welcome page's checkbox is ticked (the default)
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
  ${OrIf} $AzDesktopShortcut = 1
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  !insertmacro AzSetStep 4

  ; Move on to the ready page (or close, in passive mode) as soon as it is done
  SetAutoClose true
SectionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext


  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
