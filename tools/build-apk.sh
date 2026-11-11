#!/usr/bin/env bash
# Build the APK from android/ + web/ — no Gradle, just the Android build-tools.
#
#   tools/build-apk.sh              debug build → build/gauss.apk, signed with android/debug.keystore
#                                   (generated on first use; fine for your own phone)
#   tools/build-apk.sh --release    release build → build/gauss-<version>.apk, signed with the
#                                   release key (~/keys/gauss-app-release.jks, or $GAUSS_KS).
#                                   apksigner asks for the passphrase; set GAUSS_KS_PASS to skip
#                                   the prompt in your own shell — never put it in a file.
#
# Steps: web/ → android/assets · aapt2 compile+link (resources, manifest, assets) · javac · d8
# (classes.dex) · zipalign · apksigner. Version code/name come from VERSION_CODE / VERSION_NAME,
# default 1 / 1.0. Needs tools/setup-toolchain.sh to have run once.
set -euo pipefail

RELEASE=0
[[ "${1:-}" == "--release" ]] && RELEASE=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${TOOLCHAIN:-$HOME/android-toolchain}"
[[ -f "$TC/env.sh" ]] || { echo "no toolchain at $TC — run tools/setup-toolchain.sh first" >&2; exit 1; }
# shellcheck disable=SC1091
source "$TC/env.sh"
for t in aapt2 d8 zipalign apksigner javac keytool; do
    command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }
done
# JDK 24+ warns every time apksigner's bundled crypto library loads native code; this JVM flag
# (accepted by JDK 17+) grants it quietly. apksigner's wrapper turns "-Jxyz" into "-xyz".
APKSIGNER=(apksigner -J-enable-native-access=ALL-UNNAMED)

A="$HERE/android"
OUT="$HERE/build"
VC="${VERSION_CODE:-1}"
VN="${VERSION_NAME:-1.0}"
# Clean the intermediates only — signed APKs already in build/ are kept.
rm -rf "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/res.zip" "$OUT/sources.txt" "$OUT"/app.*.apk
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
if [[ $RELEASE == 1 ]]; then
    KS="${GAUSS_KS:-$HOME/keys/gauss-app-release.jks}"
    [[ -f "$KS" ]] || { echo "no release keystore at $KS — run tools/make-release-key.sh first" >&2; exit 1; }
    APK="$OUT/gauss-$VN.apk"
    if [[ -n "${GAUSS_KS_PASS:-}" ]]; then
        "${APKSIGNER[@]}" sign --ks "$KS" --ks-key-alias "${GAUSS_KS_ALIAS:-gauss}" --ks-pass env:GAUSS_KS_PASS \
            --out "$APK" "$OUT/app.aligned.apk"
    else
        [[ -t 0 ]] || { echo "release signing needs a terminal for the passphrase (or GAUSS_KS_PASS)" >&2; exit 1; }
        "${APKSIGNER[@]}" sign --ks "$KS" --ks-key-alias "${GAUSS_KS_ALIAS:-gauss}" --out "$APK" "$OUT/app.aligned.apk"
    fi
else
    KS="$A/debug.keystore"
    if [[ ! -f "$KS" ]]; then
        keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias debug \
            -dname "CN=Gauss debug" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
    fi
    APK="$OUT/gauss.apk"
    "${APKSIGNER[@]}" sign --ks "$KS" --ks-pass pass:android --ks-key-alias debug --out "$APK" "$OUT/app.aligned.apk"
fi
"${APKSIGNER[@]}" verify "$APK"
rm -f "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk" "$APK.idsig"
echo "built $APK ($(du -h "$APK" | cut -f1), version $VN code $VC, $([[ $RELEASE == 1 ]] && echo release key || echo debug key))"
echo "signer: $("${APKSIGNER[@]}" verify --print-certs "$APK" | grep -m1 'SHA-256 digest' | sed 's/.*digest: //')"
