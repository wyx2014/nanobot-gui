!macro customInstall
  CreateDirectory "$APPDATA\tpacowork"
  IfFileExists "$APPDATA\tpacowork\.installation-id" installationMarkerDone

  # Generate a real GUID so even rapid uninstall/reinstall cycles cannot reuse
  # the previous installation identity.
  System::Call 'ole32::CoCreateGuid(g .s)'
  Pop $0
  FileOpen $1 "$APPDATA\tpacowork\.installation-id" w
  FileWrite $1 "$0$\r$\n"
  FileClose $1

  installationMarkerDone:
!macroend

!macro customUnInstall
  # electron-builder runs the old uninstaller during an in-place update.
  # Preserve the marker for updates, but remove it for a genuine uninstall so
  # reinstalling shows onboarding and the close-to-tray notice again.
  ${ifNot} ${isUpdated}
    Delete "$APPDATA\tpacowork\.installation-id"
  ${endIf}
!macroend
