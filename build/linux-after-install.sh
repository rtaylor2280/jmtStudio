#!/bin/bash
SANDBOX="/opt/JMT-Studio/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
    chown root:root "$SANDBOX"
    chmod 4755 "$SANDBOX"
fi

# electron-builder installs the icon to 0x0 when it can't detect PNG dimensions.
# Copy it to all standard hicolor sizes so GNOME picks it up.
SRC="/usr/share/icons/hicolor/0x0/apps/jmt-studio.png"
if [ -f "$SRC" ]; then
    for D in 16x16 32x32 48x48 64x64 128x128 256x256 512x512; do
        mkdir -p "/usr/share/icons/hicolor/$D/apps"
        cp "$SRC" "/usr/share/icons/hicolor/$D/apps/jmt-studio.png"
    done
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
