#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
    rm -f "$APPARMOR_PROFILE_DEST"
fi

INSTALLATION_STATE_DIR='/var/lib/tpcowork'
INSTALLATION_ID_PATH='/var/lib/tpcowork/installation-id'
case "${1:-}" in
    remove|purge)
        rm -f "$INSTALLATION_ID_PATH"
        rmdir "$INSTALLATION_STATE_DIR" 2>/dev/null || true
        ;;
esac
