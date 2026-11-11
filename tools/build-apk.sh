#!/usr/bin/env bash
# Build build/gauss.apk from android/ + web/ — no Gradle, just the Android build-tools.
#
#   tools/build-apk.sh              (needs tools/setup-toolchain.sh to have run once)
#
# Steps: web/ → android/assets · aapt2 compile+link (resources, manifest, assets) · javac · d8
# (classes.dex) · zipalign · apksigner with a local debug key (android/debug.keystore, generated
# on first use). Version code/name come from VERSION_CODE / VERSION_NAME, default 1 / 1.0.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${TOOLCHAIN:-$HOME/android-toolchain}"
[[ -f "$TC/env.sh" ]] || { echo "no toolchain at $TC — run tools/setup-toolchain.sh first" >&2; exit 1; }
# shellcheck disable=SC1091
source "$TC/env.sh"
for t in aapt2 d8 zipalign apksigner javac keytool; do
    command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }
done

A="$HERE/android"
OUT="$HERE/build"
VC="${VERSION_CODE:-1}"
VN="${VERSION_NAME:-1.0}"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "── assets: the web app"
rm -rf "$A/assets"
mkdir -p "$A/assets"
cp "$HERE"/web/index.html "$HERE"/web/style.css "$HERE"/web/app.js "$HERE"/web/engine.js "$A/assets/"

echo "── icons"
[[ -f "$A/res/mipmap-xxxhdpi/ic_launcher.png" ]] || "$HERE/tools/make-icons.sh"

echo "── resources"
aapt2 compile --dir "$A/res" -o "$OUT/res.zip"
aapt2 link -o "$OUT/app.unsigned.apk" -I "$ANDROID_JAR" \
    --manifest "$A/AndroidManifest.xml" -A "$A/assets" --java "$OUT/gen" \
    --min-sdk-version 24 --target-sdk-version 34 \
    --version-code "$VC" --version-name "$VN" "$OUT/res.zip"

echo "── java → dex"
find "$A/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac --release 11 -Xlint:-options -cp "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt"
d8 --release --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q -u "$OUT/app.unsigned.apk" classes.dex)

echo "── align + sign"
zipalign -f 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"
KS="$A/debug.keystore"
if [[ ! -f "$KS" ]]; then
    keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias debug \
        -dname "CN=Gauss debug" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:android --ks-key-alias debug --out "$OUT/gauss.apk" "$OUT/app.aligned.apk"
apksigner verify "$OUT/gauss.apk"
rm -f "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk" "$OUT/gauss.apk.idsig"
echo "built $OUT/gauss.apk ($(du -h "$OUT/gauss.apk" | cut -f1), version $VN code $VC)"
