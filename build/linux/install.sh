#!/bin/sh
# Ione Linux installer.
#
# Installs the Ione AppImage (per-user, no root) or the Debian package that sits next to
# this script for the machine's architecture. Nothing is downloaded: only the files in
# this directory are used, and SHA256SUMS.txt is verified first when the release
# shipped one.
#
# Usage: ./install.sh [--format appimage|deb] [--prefix DIR] [--uninstall]
set -eu

APP_NAME='Ione'
BIN_NAME='ione'
DESKTOP_NAME='ione.desktop'
ICON_NAME='ione.png'
PREFIX=${PREFIX:-${HOME:?install.sh: HOME is not set}}
FORMAT=''
ACTION='install'

usage() {
    cat <<'EOF'
Usage: ./install.sh [options]

Installs the Ione AppImage (default, per-user, no root) or the Debian package found
next to this script for the machine's architecture.

Options:
  --format appimage|deb  Choose the package format when both are present.
  --prefix DIR           Install prefix for the AppImage (default: $HOME/.local).
  --uninstall            Remove a previous per-user install and the ione deb, if present.
  -h, --help             Show this help.

The AppImage install writes:
  DIR/bin/ione.AppImage
  DIR/bin/ione                     (symlink)
  DIR/share/applications/ione.desktop
  DIR/share/icons/hicolor/512x512/apps/ione.png

User data under ~/.config/Ione and ~/.cache/Ione is never removed.
EOF
}

fail() {
    printf 'install.sh: %s\n' "$*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case $1 in
        --format)
            [ "$#" -ge 2 ] || fail '--format needs appimage or deb'
            FORMAT=$2
            shift
            ;;
        --format=*)
            FORMAT=${1#--format=}
            ;;
        --prefix)
            [ "$#" -ge 2 ] || fail '--prefix needs a directory'
            PREFIX=$2
            shift
            ;;
        --prefix=*)
            PREFIX=${1#--prefix=}
            ;;
        --uninstall)
            ACTION='uninstall'
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "unknown argument: $1 (try --help)"
            ;;
    esac
    shift
done

case $PREFIX in
    /*) ;;
    *) PREFIX=$(pwd)/$PREFIX ;;
esac
PREFIX=${PREFIX%/}
[ -n "$PREFIX" ] || PREFIX=/

BIN_DIR=$PREFIX/bin
DESKTOP_DIR=$PREFIX/share/applications
ICON_DIR=$PREFIX/share/icons/hicolor/512x512/apps

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$1" | awk '{print $NF}'
    else
        fail 'no SHA-256 tool found (need sha256sum, shasum, or openssl)'
    fi
}

verify_checksum() {
    file=$1
    sums=$script_dir/SHA256SUMS.txt
    if [ ! -f "$sums" ]; then
        printf 'No SHA256SUMS.txt next to the installer; skipping checksum verification.\n' >&2
        return 0
    fi
    name=$(basename "$file")
    expected=$(awk -v name="$name" '($2 == name || $2 == "*" name) { print $1; exit }' "$sums")
    [ -n "$expected" ] || fail "SHA256SUMS.txt has no entry for $name"
    actual=$(sha256_of "$file")
    expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
    actual=$(printf '%s' "$actual" | tr 'A-F' 'a-f')
    [ "$actual" = "$expected" ] || fail "SHA-256 mismatch for $name: expected $expected, got $actual"
    printf 'Verified %s\n' "$name"
}

refresh_caches() {
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
    fi
}

write_desktop_entry() {
    exec_path=$1
    cat > "$DESKTOP_DIR/$DESKTOP_NAME" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
GenericName=Web Browser
Comment=Browse the web with Ione
Exec="$exec_path" --no-sandbox %U
Terminal=false
Icon=ione
StartupWMClass=ione
Categories=Network;WebBrowser;
MimeType=text/html;application/xhtml+xml;multipart/related;image/svg+xml;image/webp;image/avif;application/pdf;x-scheme-handler/http;x-scheme-handler/https;
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=New Window
Exec="$exec_path" --no-sandbox --new-window

[Desktop Action new-private-window]
Name=New Private Window
Exec="$exec_path" --no-sandbox --private-window
EOF
    chmod 644 "$DESKTOP_DIR/$DESKTOP_NAME"
}

# The AppImage's .DirIcon is a symlink to the real icon; extract the link, resolve its
# target, then extract that file. The runtime handles this without FUSE.
install_icon_from_appimage() {
    image=$1
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/ione-icon.XXXXXX") || {
        printf 'warning: could not create a temporary directory for the icon.\n' >&2
        return 0
    }
    icon_rel=''
    if ( cd "$tmp" && "$image" --appimage-extract '.DirIcon' >/dev/null 2>&1 ); then
        if [ -L "$tmp/squashfs-root/.DirIcon" ]; then
            icon_rel=$(readlink "$tmp/squashfs-root/.DirIcon" 2>/dev/null || true)
            icon_rel=${icon_rel#/}
        elif [ -f "$tmp/squashfs-root/.DirIcon" ]; then
            icon_rel='.DirIcon'
        fi
    fi
    if [ -n "$icon_rel" ] &&
        ( cd "$tmp" && "$image" --appimage-extract "$icon_rel" >/dev/null 2>&1 ) &&
        [ -f "$tmp/squashfs-root/$icon_rel" ]; then
        cp "$tmp/squashfs-root/$icon_rel" "$ICON_DIR/$ICON_NAME"
    else
        printf 'warning: could not extract the icon; the menu entry uses the theme fallback.\n' >&2
    fi
    rm -rf "$tmp"
}

install_appimage() {
    image=$1
    verify_checksum "$image"
    mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
    target=$BIN_DIR/ione.AppImage
    staged=$target.new.$$
    cp "$image" "$staged"
    chmod 755 "$staged"
    mv -f "$staged" "$target"
    ln -sf 'ione.AppImage' "$BIN_DIR/$BIN_NAME"
    install_icon_from_appimage "$target"
    # Point the desktop entry at the real AppImage (not the symlink) so electron-updater's
    # AppImage updater replaces the file it was launched from.
    write_desktop_entry "$target"
    refresh_caches
    printf 'Installed %s at %s\n' "$APP_NAME" "$target"
    printf 'Open %s from the application menu, or run %s.\n' "$APP_NAME" "$BIN_NAME"
    case :$PATH: in
        *:"$BIN_DIR":*) ;;
        *) printf 'Add %s to PATH to run %s from a shell.\n' "$BIN_DIR" "$BIN_NAME" ;;
    esac
}

install_deb() {
    file=$1
    verify_checksum "$file"
    command -v dpkg >/dev/null 2>&1 || fail 'dpkg was not found; install the AppImage instead'
    if [ "$(id -u)" -eq 0 ]; then
        dpkg -i "$file"
    elif command -v sudo >/dev/null 2>&1; then
        sudo dpkg -i "$file"
    else
        fail 'installing the .deb needs root; run with sudo or install the AppImage instead'
    fi
    printf 'Installed %s. If dependencies are missing, run: sudo apt-get -f install\n' "$APP_NAME"
}

remove_deb_if_installed() {
    command -v dpkg >/dev/null 2>&1 || return 0
    dpkg -s "$BIN_NAME" >/dev/null 2>&1 || return 0
    if [ "$(id -u)" -eq 0 ]; then
        dpkg -r "$BIN_NAME"
    elif command -v sudo >/dev/null 2>&1; then
        sudo dpkg -r "$BIN_NAME"
    else
        printf 'A system-wide %s package is installed; remove it with: sudo dpkg -r %s\n' "$APP_NAME" "$BIN_NAME" >&2
    fi
}

uninstall() {
    remove_deb_if_installed
    rm -f "$BIN_DIR/$BIN_NAME" "$BIN_DIR/ione.AppImage" \
        "$DESKTOP_DIR/$DESKTOP_NAME" "$ICON_DIR/$ICON_NAME"
    refresh_caches
    printf 'Removed the per-user %s install from %s.\n' "$APP_NAME" "$PREFIX"
    printf 'User data in ~/.config/Ione and ~/.cache/Ione was left untouched.\n'
}

if [ "$ACTION" = 'uninstall' ]; then
    uninstall
    exit 0
fi

case $(uname -m) in
    x86_64|amd64)
        APPIMAGE_ARCH=x86_64
        DEB_ARCH=amd64
        ;;
    aarch64|arm64)
        APPIMAGE_ARCH=arm64
        DEB_ARCH=arm64
        ;;
    *)
        fail "unsupported architecture: $(uname -m) (Ione ships x86_64 and arm64)"
        ;;
esac

# Last matching file. Release directories normally contain exactly one version; if several
# are present, the lexically last name wins.
newest_matching() {
    found=''
    for candidate in "$@"; do
        [ -f "$candidate" ] || continue
        found=$candidate
    done
    printf '%s' "$found"
}

set -- "$script_dir"/ione-*-"$APPIMAGE_ARCH".AppImage
appimage=$(newest_matching "$@")
set -- "$script_dir"/ione_*_"$DEB_ARCH".deb
deb=$(newest_matching "$@")

if [ -z "$FORMAT" ]; then
    if [ -n "$appimage" ]; then
        FORMAT=appimage
    elif [ -n "$deb" ]; then
        FORMAT=deb
    else
        fail "no Ione AppImage (ione-*-$APPIMAGE_ARCH.AppImage) or .deb (ione_*_$DEB_ARCH.deb) found in $script_dir"
    fi
fi

case $FORMAT in
    appimage)
        [ -n "$appimage" ] || fail "no Ione AppImage for $APPIMAGE_ARCH in $script_dir"
        install_appimage "$appimage"
        ;;
    deb)
        [ -n "$deb" ] || fail "no Ione .deb for $DEB_ARCH in $script_dir"
        install_deb "$deb"
        ;;
    *)
        fail "unknown format: $FORMAT (expected appimage or deb)"
        ;;
esac
