#!/usr/bin/env bash
# Draw the launcher and PWA icons with ImageMagick: a blue rounded square with "[G]" in it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
FONT=""
convert -list font 2>/dev/null | grep -q 'Font: DejaVu-Sans-Mono-Bold' && FONT="-font DejaVu-Sans-Mono-Bold"
# shellcheck disable=SC2086
convert -size 512x512 xc:none -fill '#2457d6' -draw 'roundrectangle 0,0 511,511 100,100' \
    -fill white $FONT -pointsize 300 -gravity center -annotate +0+12 '[G]' "$TMP/icon-512.png"
convert "$TMP/icon-512.png" -resize 192x192 "$TMP/icon-192.png"
mkdir -p "$HERE/web/icons"
cp "$TMP/icon-512.png" "$TMP/icon-192.png" "$HERE/web/icons/"
for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    d="${spec%%:*}"; px="${spec##*:}"
    mkdir -p "$HERE/android/res/mipmap-$d"
    convert "$TMP/icon-512.png" -resize "${px}x${px}" "$HERE/android/res/mipmap-$d/ic_launcher.png"
done
rm -rf "$TMP"
echo "icons written to web/icons and android/res/mipmap-*"
