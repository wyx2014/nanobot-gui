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

desktop_user_records() {
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != 'root' ]; then
        getent passwd "$SUDO_USER" 2>/dev/null || true
        return
    fi
    if [ -n "${PKEXEC_UID:-}" ]; then
        getent passwd "$PKEXEC_UID" 2>/dev/null || true
        return
    fi
    getent passwd 2>/dev/null | awk -F: '$3 >= 1000 && $3 < 65534 && $7 !~ /(nologin|false)$/ { print }'
}

desktop_dir_for_user() {
    local username="$1"
    local user_home="$2"
    local candidate=''
    local configured=''

    if command -v runuser >/dev/null 2>&1 && command -v xdg-user-dir >/dev/null 2>&1; then
        candidate="$(runuser -u "$username" -- env HOME="$user_home" xdg-user-dir DESKTOP 2>/dev/null || true)"
    fi
    if [ -z "$candidate" ] && [ -r "$user_home/.config/user-dirs.dirs" ]; then
        configured="$(sed -n 's/^XDG_DESKTOP_DIR="\([^"]*\)"$/\1/p' "$user_home/.config/user-dirs.dirs" | head -n 1)"
        case "$configured" in
            '\$HOME/'*) candidate="$user_home/${configured#\$HOME/}" ;;
            "$user_home/"*) candidate="$configured" ;;
        esac
    fi
    if [ -z "$candidate" ]; then
        if [ -d "$user_home/桌面" ]; then
            candidate="$user_home/桌面"
        else
            candidate="$user_home/Desktop"
        fi
    fi
    case "$candidate" in
        "$user_home/"*) printf '%s\n' "$candidate" ;;
        *) return 1 ;;
    esac
}

INSTALLATION_STATE_DIR='/var/lib/tpcowork'
INSTALLATION_ID_PATH='/var/lib/tpcowork/installation-id'
case "${1:-}" in
    remove|purge)
        desktop_user_records | while IFS=: read -r username _ uid _ _ user_home user_shell; do
            [ -n "$username" ] || continue
            [ "$uid" -ge 1000 ] 2>/dev/null || continue
            [ "$uid" -lt 65534 ] 2>/dev/null || continue
            [ -d "$user_home" ] || continue
            desktop_dir="$(desktop_dir_for_user "$username" "$user_home")" || continue
            shortcut="$desktop_dir/${executable}.desktop"
            if [ -f "$shortcut" ] && grep -q '^X-TPCowork-ManagedShortcut=true$' "$shortcut"; then
                rm -f "$shortcut"
            fi
        done
        rm -f "$INSTALLATION_ID_PATH"
        rmdir "$INSTALLATION_STATE_DIR" 2>/dev/null || true
        ;;
esac
