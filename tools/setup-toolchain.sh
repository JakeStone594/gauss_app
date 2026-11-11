#!/usr/bin/env bash
# Self-contained Android build tools for gauss_app — no apt, nothing outside $TOOLCHAIN.
#
#   tools/setup-toolchain.sh            installs into ~/android-toolchain (override with TOOLCHAIN=…)
#   source ~/android-toolchain/env.sh   afterwards, in any shell that builds the APK
#
# Downloads: a JDK 17 (only if the system java is older than 17), the Android command-line
# tools, platform android-34 and build-tools 35.0.0. About 600–700 MB in total.
set -euo pipefail

TC="${TOOLCHAIN:-$HOME/android-toolchain}"
mkdir -p "$TC"
cd "$TC"
log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# ── Java ───────────────────────────────────────────────────────────────────
JAVA_HOME_LINE=""
jv=0
if command -v java >/dev/null 2>&1; then
    jv="$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+)(\.[0-9]+)*".*/\1/')"
fi
if [[ "${jv:-0}" -ge 17 ]]; then
    log "system java $jv is new enough"
else
    log "system java is ${jv:-absent}; fetching Temurin JDK 17"
    curl -fL --retry 3 -o jdk.tar.gz \
        "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
    rm -rf jdk && mkdir jdk
    tar xzf jdk.tar.gz -C jdk --strip-components=1
    rm jdk.tar.gz
    export JAVA_HOME="$TC/jdk"
    export PATH="$JAVA_HOME/bin:$PATH"
    JAVA_HOME_LINE="export JAVA_HOME=\"$TC/jdk\"; export PATH=\"\$JAVA_HOME/bin:\$PATH\""
fi
java -version 2>&1 | head -1

# ── command-line tools (sdkmanager) ────────────────────────────────────────
if [[ ! -x cmdline-tools/latest/bin/sdkmanager ]]; then
    url="$(curl -fsL https://developer.android.com/studio \
          | grep -o 'https://dl.google.com/android/repository/commandlinetools-linux-[0-9]*_latest.zip' \
          | head -1 || true)"
    url="${url:-https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip}"
    log "fetching $url"
    curl -fL --retry 3 -o clt.zip "$url"
    rm -rf cmdline-tools && mkdir cmdline-tools
    unzip -q clt.zip -d cmdline-tools
    mv cmdline-tools/cmdline-tools cmdline-tools/latest
    rm clt.zip
fi

# ── SDK packages ───────────────────────────────────────────────────────────
SDK="$TC/sdk"
mkdir -p "$SDK"
log "accepting licences"
yes | cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
log "installing platform + build-tools"
cmdline-tools/latest/bin/sdkmanager --sdk_root="$SDK" "platforms;android-34" "build-tools;35.0.0"

cat > env.sh <<EOF
# source this before building: build-tools, android.jar and (if needed) the JDK
$JAVA_HOME_LINE
export ANDROID_HOME="$SDK"
export ANDROID_JAR="$SDK/platforms/android-34/android.jar"
export PATH="$SDK/build-tools/35.0.0:\$PATH"
EOF

log "done"
ls "$SDK/build-tools/35.0.0/aapt2" "$SDK/build-tools/35.0.0/d8" "$SDK/build-tools/35.0.0/apksigner" "$SDK/platforms/android-34/android.jar"
du -sh "$TC"
