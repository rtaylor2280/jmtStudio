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
    for SIZE in 16 32 48 64 128 256 512; do
        mkdir -p "/usr/share/icons/hicolor/${SIZE}x${SIZE}/apps"
        cp "$SRC" "/usr/share/icons/hicolor/${SIZE}x${SIZE}/apps/jmt-studio.png"
    done
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
