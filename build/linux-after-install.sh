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

# Install AppStream metainfo so GNOME App Center shows developer name, release
# date, and project license instead of "Unknown" everywhere. Without this file
# at /usr/share/metainfo/, the App Center has nothing to populate those fields
# with for a sideloaded third-party .deb.
#
# IMPORTANT: bump the <release version=... date=...> line per release. There's
# no auto-generation of this yet (backlog item). Date format is YYYY-MM-DD.
mkdir -p /usr/share/metainfo
cat > /usr/share/metainfo/com.jmt.proffieos-editor.metainfo.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>com.jmt.proffieos-editor</id>
  <name>JMT Studio</name>
  <summary>ProffieOS configuration tool</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>LicenseRef-proprietary</project_license>
  <description>
    <p>ProffieOS Configuration Tool by Jedi Master Tech. Edit, compile, and flash lightsaber firmware configurations to Proffieboard hardware.</p>
  </description>
  <launchable type="desktop-id">jmt-studio.desktop</launchable>
  <url type="homepage">https://jedimastertech.com</url>
  <developer id="com.jmt">
    <name>Jedi Master Tech</name>
  </developer>
  <releases>
    <release version="1.7.0" date="2026-05-31"/>
  </releases>
  <content_rating type="oars-1.1"/>
</component>
EOF
