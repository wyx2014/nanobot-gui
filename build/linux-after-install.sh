#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# electron-builder registers the application menu entry system-wide, but Linux
# packages do not create a visible desktop shortcut by default. Install a copy
# for the user who launched the installer (or every regular local user when a
# graphical package manager does not expose that user).
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

    # Never let a malformed XDG setting make the package write outside home or
    # directly into the home directory.
    case "$candidate" in
        "$user_home/"*) printf '%s\n' "$candidate" ;;
        *) return 1 ;;
    esac
}

DESKTOP_ENTRY_SOURCE='/usr/share/applications/${executable}.desktop'
DESKTOP_ENTRY_NAME='${executable}.desktop'
if [ -f "$DESKTOP_ENTRY_SOURCE" ]; then
    desktop_user_records | while IFS=: read -r username _ uid gid _ user_home user_shell; do
        [ -n "$username" ] || continue
        [ "$uid" -ge 1000 ] 2>/dev/null || continue
        [ "$uid" -lt 65534 ] 2>/dev/null || continue
        [ -d "$user_home" ] || continue
        desktop_dir="$(desktop_dir_for_user "$username" "$user_home")" || continue

        if command -v runuser >/dev/null 2>&1; then
            runuser -u "$username" -- env HOME="$user_home" sh -c '
                umask 022
                mkdir -p "$1"
                cp -f "$2" "$1/$3"
                chmod 0755 "$1/$3"
                if command -v gio >/dev/null 2>&1; then
                    gio set "$1/$3" metadata::trusted true >/dev/null 2>&1 || true
                fi
            ' sh "$desktop_dir" "$DESKTOP_ENTRY_SOURCE" "$DESKTOP_ENTRY_NAME" || true
        else
            install -d -m 0755 -o "$uid" -g "$gid" "$desktop_dir" || continue
            install -m 0755 -o "$uid" -g "$gid" "$DESKTOP_ENTRY_SOURCE" "$desktop_dir/$DESKTOP_ENTRY_NAME" || true
        fi
    done
fi

if apparmor_status --enabled > /dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
    if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
        cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
        fi
    else
        echo "Skipping the installation of the AppArmor profile because this AppArmor version does not support it"
    fi
fi

INSTALLATION_STATE_DIR='/var/lib/tpcowork'
INSTALLATION_ID_PATH='/var/lib/tpcowork/installation-id'
install -d -m 0755 "$INSTALLATION_STATE_DIR"
if [ ! -s "$INSTALLATION_ID_PATH" ]; then
    umask 022
    cat /proc/sys/kernel/random/uuid > "$INSTALLATION_ID_PATH"
    chmod 0644 "$INSTALLATION_ID_PATH"
fi
