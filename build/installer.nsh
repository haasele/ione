; electron-builder's NSIS include for Ione: (1) removes the installation of the app's former
; name, (2) registers Ione as a web browser with Windows (further down).
;
; Ione was called Zenium after v0.2.0, and "Zen" before that (appIds
; io.github.benitbuhner.zenium and app.zen-browser.chromium). electron-builder derives the NSIS
; GUID – the uninstall registry key, the install-info key and the "Apps" entry – from the appId,
; so Windows treats Ione as a program unrelated to either former name and a plain install would
; leave the old copy, its shortcuts and its uninstaller entry behind. Both are removed by running
; their own uninstallers silently, the way electron-builder replaces a previous version of the
; same GUID (installUtil.nsh, uninstallOldVersion). The same applies to the appId Ione used
; before `dev.haasele.ione`; its uninstaller is run here too, and its profile is kept.
;
; User data is kept: the electron-builder uninstaller only deletes %APPDATA% with --delete-app-data,
; which is never passed here, and Ione moves %APPDATA%\Zenium / %APPDATA%\Zen to %APPDATA%\Ione
; on its first launch (src/main/platform/legacyPaths.ts). Both were per-user (HKCU) installations.
;
; UUIDs are v5 of the appIds in electron-builder's namespace 50e065bc-3134-11e6-9bab-38c9862bdaf3
; (app-builder-lib/out/targets/nsis/NsisTarget.js).
!define ZENIUM_LEGACY_GUID "b61a1b56-04bb-5d75-984d-4689c7ec909b"
!define ZENIUM_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ZENIUM_LEGACY_GUID}"
!define ZENIUM_LEGACY_INSTALL_KEY "Software\${ZENIUM_LEGACY_GUID}"
!define ZENIUM_LEGACY_EXECUTABLE "zenium.exe"
!define ZEN_LEGACY_GUID "1a1fcb04-afbe-586c-8201-726e3825a77b"
!define ZEN_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ZEN_LEGACY_GUID}"
!define ZEN_LEGACY_INSTALL_KEY "Software\${ZEN_LEGACY_GUID}"
!define ZEN_LEGACY_EXECUTABLE "zen.exe"
!define IONE_LEGACY_GUID "d29f1ef3-646b-569b-9d96-581ed59a9feb"
!define IONE_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${IONE_LEGACY_GUID}"
!define IONE_LEGACY_INSTALL_KEY "Software\${IONE_LEGACY_GUID}"

; The app icon colour picked in Settings → Look and Feel. The running app can change its window
; and taskbar icon, but the Start menu and desktop shortcuts carry the icon the installer gave
; them, so the app records the choice here (src/main/platform/appIcon.ts) and every update
; re-points the shortcuts it just created at the matching multi-size ICO shipped with the app.
!define ZEN_APP_ICON_KEY "Software\Ione"
!define ZEN_LEGACY_APP_ICON_KEY "Software\Zenium"
!define ZEN_APP_ICON_VALUE "AppIcon"

; ---------------------------------------------------------------------------------------------
; Default-browser registration, the way Chrome registers a per-user install (no admin rights):
;
;   Software\RegisteredApplications            Ione = <path of the Capabilities key>
;   Software\Clients\StartMenuInternet\Ione  the browser client: icon, open command,
;     \Capabilities                            ApplicationName / Description / Icon,
;       \URLAssociations                       http, https  -> IoneHTML
;       \FileAssociations                      .htm, .html, … -> IoneHTML
;       \StartMenu                             StartMenuInternet = Ione
;   Software\Classes\IoneHTML                the ProgID Windows launches: "ione.exe" "%1"
;   Software\Classes\.html\OpenWithProgids     IoneHTML (lists Ione under "Open with")
;
; Settings > Apps > Default apps lists every application found through RegisteredApplications,
; and only the user can pick one there (Windows 10 and later ignore programmatic changes to the
; user's choice). Nothing here changes a default: no `.html` or `http` class default is written.
; SHELL_CONTEXT is HKCU for the per-user installer electron-builder builds here and HKLM for an
; /allusers install; both are places Windows reads registrations from.
; ---------------------------------------------------------------------------------------------
!define IONE_PROGID "IoneHTML"
!define IONE_PROGID_KEY "Software\Classes\${IONE_PROGID}"
!define IONE_CLIENT_KEY "Software\Clients\StartMenuInternet\${PRODUCT_NAME}"
!define IONE_CAPABILITIES_KEY "${IONE_CLIENT_KEY}\Capabilities"
!ifdef APP_DESCRIPTION
  !define IONE_DESCRIPTION "${APP_DESCRIPTION}"
!else
  !define IONE_DESCRIPTION "${PRODUCT_NAME} web browser"
!endif

; Every document type Ione opens; keep in step with mac.fileAssociations and linux.mimeTypes
; in electron-builder.yml and DOCUMENT_EXTENSIONS in src/shared/launchArgs.ts.
!macro forEachExtension MACRO
  !insertmacro ${MACRO} ".htm"
  !insertmacro ${MACRO} ".html"
  !insertmacro ${MACRO} ".shtml"
  !insertmacro ${MACRO} ".xht"
  !insertmacro ${MACRO} ".xhtml"
  !insertmacro ${MACRO} ".mhtml"
  !insertmacro ${MACRO} ".mht"
  !insertmacro ${MACRO} ".svg"
  !insertmacro ${MACRO} ".webp"
  !insertmacro ${MACRO} ".avif"
  !insertmacro ${MACRO} ".pdf"
!macroend

!macro registerExtension EXT
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}\FileAssociations" "${EXT}" "${IONE_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${IONE_PROGID}"
!macroend

; The extension's default ProgID is left alone unless it is ours (a user who picked Ione for
; the type through Windows); keys left empty by the removal are dropped too.
!macro unregisterExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${IONE_PROGID}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids"
  ReadRegStr $R7 SHELL_CONTEXT "Software\Classes\${EXT}" ""
  ${if} $R7 == "${IONE_PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}" ""
  ${endIf}
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\${EXT}"
!macroend

!macro registerDefaultBrowser
  DetailPrint "Registering ${PRODUCT_NAME} as a web browser with Windows"
  ; The browser client Settings > Default apps lists.
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegDWORD SHELL_CONTEXT "${IONE_CLIENT_KEY}\InstallInfo" "IconsVisible" 1
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}\InstallInfo" "ReinstallCommand" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --make-default-browser'
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}\InstallInfo" "HideIconsCommand" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hide-icons'
  WriteRegStr SHELL_CONTEXT "${IONE_CLIENT_KEY}\InstallInfo" "ShowIconsCommand" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --show-icons'
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}" "ApplicationDescription" "${IONE_DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}\StartMenu" "StartMenuInternet" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}\URLAssociations" "http" "${IONE_PROGID}"
  WriteRegStr SHELL_CONTEXT "${IONE_CAPABILITIES_KEY}\URLAssociations" "https" "${IONE_PROGID}"
  ; The ProgID both associations point at. "URL Protocol" marks it as a URL handler too.
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}" "" "${PRODUCT_NAME} HTML Document"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}" "FriendlyTypeName" "${PRODUCT_NAME} HTML Document"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}" "AppUserModelID" "${APP_ID}"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\Application" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\Application" "ApplicationDescription" "${IONE_DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\Application" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\Application" "AppUserModelID" "${APP_ID}"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "${IONE_PROGID_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro forEachExtension registerExtension
  ; Last, so Settings never sees a half-written registration.
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${IONE_CAPABILITIES_KEY}"
  ; SHCNE_ASSOCCHANGED: the shell re-reads the associations.
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; The user's own http/https choice (UserChoice) is not touched: Windows owns it and asks for a
; new browser by itself once the ProgID it names is gone.
!macro unregisterDefaultBrowser
  DetailPrint "Removing the ${PRODUCT_NAME} web browser registration"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey SHELL_CONTEXT "${IONE_CLIENT_KEY}"
  DeleteRegKey SHELL_CONTEXT "${IONE_PROGID_KEY}"
  !insertmacro forEachExtension unregisterExtension
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; The AppUserModelId class key the running app writes for its toast notifications
; (src/main/platform/notifications.ts: DisplayName and IconUri under the user's hive, whatever
; the install mode – hence HKCU, not SHELL_CONTEXT). The per-sender key under
; Software\Microsoft\Windows\CurrentVersion\Notifications\Settings is Windows's own record of the
; app having notified and stays, as it does for any uninstalled app. An update's uninstall (the
; --updated run) removes it too; the new build writes it again on its first start. The private
; windows' second id (src/main/platform/privateTaskbar.ts: the app's with `.private`, their own
; taskbar group) has a class key of the same shape, written and removed the same way.
!define IONE_APP_USER_MODEL_ID_KEY "Software\Classes\AppUserModelId\${APP_ID}"
!define IONE_PRIVATE_APP_USER_MODEL_ID_KEY "Software\Classes\AppUserModelId\${APP_ID}.private"

!macro customUnInstall
  !insertmacro unregisterDefaultBrowser
  DeleteRegKey HKCU "${IONE_APP_USER_MODEL_ID_KEY}"
  DeleteRegKey HKCU "${IONE_PRIVATE_APP_USER_MODEL_ID_KEY}"
!macroend

!macro customInstall
  ; The previous appId's uninstall entry points at the same install directory (the product name
  ; did not change), so its files are the ones this install just replaced. Drop the stale entry
  ; without running that uninstaller: it would delete the newly installed files and shortcuts.
  DetailPrint "Retiring the previous Ione application entry (your data is kept)"
  DeleteRegKey HKEY_CURRENT_USER "${IONE_LEGACY_UNINSTALL_KEY}"
  DeleteRegKey HKEY_CURRENT_USER "${IONE_LEGACY_INSTALL_KEY}"

  ; Declared here rather than at file scope: makensis also compiles this script for the
  ; uninstaller, where the macro is not inserted, and treats an unreferenced variable as a
  ; warning (electron-builder turns warnings into errors).
  Var /GLOBAL zenAppIcon
  Var /GLOBAL zenAppIconFile

  ClearErrors
  ReadRegStr $zenAppIcon HKEY_CURRENT_USER "${ZEN_APP_ICON_KEY}" "${ZEN_APP_ICON_VALUE}"
  ${if} $zenAppIcon == ""
    ReadRegStr $zenAppIcon HKEY_CURRENT_USER "${ZEN_LEGACY_APP_ICON_KEY}" "${ZEN_APP_ICON_VALUE}"
  ${endIf}
  ${if} $zenAppIcon != ""
    StrCpy $zenAppIconFile "$INSTDIR\resources\app.asar.unpacked\resources\icons\$zenAppIcon\icon.ico"
    ${if} ${FileExists} "$zenAppIconFile"
      ${if} ${FileExists} "$newStartMenuLink"
        CreateShortCut "$newStartMenuLink" "$appExe" "" "$zenAppIconFile" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${endIf}
      ${if} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$zenAppIconFile" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${endIf}
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      DetailPrint "Shortcuts use the $zenAppIcon app icon"
    ${endIf}
  ${endIf}
  ClearErrors

  Var /GLOBAL zeniumLegacyUninstallString
  Var /GLOBAL zeniumLegacyUninstaller
  Var /GLOBAL zeniumLegacyInstallDir
  Var /GLOBAL zeniumLegacyResult

  ClearErrors
  ReadRegStr $zeniumLegacyUninstallString HKEY_CURRENT_USER "${ZENIUM_LEGACY_UNINSTALL_KEY}" UninstallString
  ${if} $zeniumLegacyUninstallString != ""
    DetailPrint "Removing the previous Zenium installation (now Ione; your data is kept)"
    !insertmacro GetInQuotes $zeniumLegacyUninstaller "$zeniumLegacyUninstallString"
    ReadRegStr $zeniumLegacyInstallDir HKEY_CURRENT_USER "${ZENIUM_LEGACY_INSTALL_KEY}" InstallLocation
    ${if} $zeniumLegacyInstallDir == ""
    ${andIf} $zeniumLegacyUninstaller != ""
      Push $zeniumLegacyUninstaller
      Call GetFileParent
      Pop $zeniumLegacyInstallDir
    ${endIf}

    ${if} ${FileExists} "$zeniumLegacyUninstaller"
      nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /FI "USERNAME eq %USERNAME%" /IM ${ZENIUM_LEGACY_EXECUTABLE}'
      Pop $zeniumLegacyResult
      ${if} $zeniumLegacyResult == 0
        Sleep 3000
        nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /F /FI "USERNAME eq %USERNAME%" /IM ${ZENIUM_LEGACY_EXECUTABLE}'
        Pop $zeniumLegacyResult
        Sleep 500
      ${endIf}

      ClearErrors
      CopyFiles /SILENT /FILESONLY "$zeniumLegacyUninstaller" "$PLUGINSDIR\zenium-uninstaller.exe"
      ${if} ${Errors}
        ExecWait '"$zeniumLegacyUninstaller" /S /KEEP_APP_DATA --updated /currentuser _?=$zeniumLegacyInstallDir' $zeniumLegacyResult
      ${else}
        ExecWait '"$PLUGINSDIR\zenium-uninstaller.exe" /S /KEEP_APP_DATA --updated /currentuser _?=$zeniumLegacyInstallDir' $zeniumLegacyResult
      ${endIf}
      ${if} $zeniumLegacyResult == 0
        DetailPrint "Zenium was removed"
      ${else}
        DetailPrint "Could not remove Zenium automatically (uninstaller exit code $zeniumLegacyResult); remove it from Settings > Apps"
      ${endIf}
    ${else}
      DeleteRegKey HKEY_CURRENT_USER "${ZENIUM_LEGACY_UNINSTALL_KEY}"
      DeleteRegKey HKEY_CURRENT_USER "${ZENIUM_LEGACY_INSTALL_KEY}"
    ${endIf}
  ${endIf}
  ClearErrors

  Var /GLOBAL zenLegacyUninstallString
  Var /GLOBAL zenLegacyUninstaller
  Var /GLOBAL zenLegacyInstallDir
  Var /GLOBAL zenLegacyResult

  ClearErrors
  ReadRegStr $zenLegacyUninstallString HKEY_CURRENT_USER "${ZEN_LEGACY_UNINSTALL_KEY}" UninstallString
  ${if} $zenLegacyUninstallString != ""
    DetailPrint "Removing the previous Zen installation (Zen is now Ione; your data is kept)"
    !insertmacro GetInQuotes $zenLegacyUninstaller "$zenLegacyUninstallString"
    ReadRegStr $zenLegacyInstallDir HKEY_CURRENT_USER "${ZEN_LEGACY_INSTALL_KEY}" InstallLocation
    ${if} $zenLegacyInstallDir == ""
    ${andIf} $zenLegacyUninstaller != ""
      Push $zenLegacyUninstaller
      Call GetFileParent
      Pop $zenLegacyInstallDir
    ${endIf}

    ${if} ${FileExists} "$zenLegacyUninstaller"
      ; A running Zen would keep its files busy. Ask it to close first (WM_CLOSE lets it flush its
      ; session to disk), then insist.
      nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /FI "USERNAME eq %USERNAME%" /IM ${ZEN_LEGACY_EXECUTABLE}'
      Pop $zenLegacyResult
      ${if} $zenLegacyResult == 0
        Sleep 3000
        nsExec::Exec '"$SYSDIR\cmd.exe" /C taskkill /F /FI "USERNAME eq %USERNAME%" /IM ${ZEN_LEGACY_EXECUTABLE}'
        Pop $zenLegacyResult
        Sleep 500
      ${endIf}

      ; Run a copy of the uninstaller so it can delete its own directory (_?= makes it run in place
      ; and lets ExecWait wait for it). --updated selects the careful file removal and, together
      ; with the absence of --delete-app-data, keeps %APPDATA%; shortcuts and registry entries go.
      ClearErrors
      CopyFiles /SILENT /FILESONLY "$zenLegacyUninstaller" "$PLUGINSDIR\zen-uninstaller.exe"
      ${if} ${Errors}
        ExecWait '"$zenLegacyUninstaller" /S /KEEP_APP_DATA --updated /currentuser _?=$zenLegacyInstallDir' $zenLegacyResult
      ${else}
        ExecWait '"$PLUGINSDIR\zen-uninstaller.exe" /S /KEEP_APP_DATA --updated /currentuser _?=$zenLegacyInstallDir' $zenLegacyResult
      ${endIf}
      ${if} $zenLegacyResult == 0
        DetailPrint "Zen was removed"
      ${else}
        DetailPrint "Could not remove Zen automatically (uninstaller exit code $zenLegacyResult); remove it from Settings > Apps"
      ${endIf}
    ${else}
      ; The entry survived its program: nothing to run, drop the stale keys.
      DeleteRegKey HKEY_CURRENT_USER "${ZEN_LEGACY_UNINSTALL_KEY}"
      DeleteRegKey HKEY_CURRENT_USER "${ZEN_LEGACY_INSTALL_KEY}"
    ${endIf}
  ${endIf}
  ClearErrors

  !insertmacro registerDefaultBrowser
!macroend
