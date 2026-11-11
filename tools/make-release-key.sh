#!/usr/bin/env bash
# Create the release signing key for the Gauss app — run this YOURSELF, in a terminal.
#
#   tools/make-release-key.sh                     → ~/keys/gauss-app-release.jks
#   GAUSS_KS=/elsewhere/release.jks tools/make-release-key.sh
#
# keytool asks for the keystore passphrase with hidden input. Choose it, keep it in your
# password manager, and never put it in a file, a command line or a chat. The key is RSA 4096,
# valid 10000 days (~27 years), alias "gauss", with a subject that names the app, not a person.
#
# ⚠ The keystore is the identity of the app: every future update must be signed with it, and
# Android refuses an update signed with a different key. Back it up (encrypted) somewhere that
# survives this machine — and do not write down where. If it is lost, users must uninstall and
# reinstall; if it leaks, anyone can ship "updates" to them.
set -euo pipefail

KS="${GAUSS_KS:-$HOME/keys/gauss-app-release.jks}"
ALIAS="${GAUSS_KS_ALIAS:-gauss}"
if [[ -e "$KS" ]]; then
    echo "refusing to overwrite the existing keystore: $KS" >&2
    exit 1
fi
if [[ ! -t 0 ]]; then
    echo "run this in an interactive terminal: the passphrase is typed, never passed in" >&2
    exit 1
fi
TC="${TOOLCHAIN:-$HOME/android-toolchain}"
[[ -f "$TC/env.sh" ]] && source "$TC/env.sh"   # a JDK, if the toolchain brought one
command -v keytool >/dev/null || { echo "keytool (a JDK) is needed" >&2; exit 1; }

mkdir -p "$(dirname "$KS")"
chmod 700 "$(dirname "$KS")"
keytool -genkeypair -v -keystore "$KS" -storetype PKCS12 -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=Gauss app, O=gauss_app"
chmod 600 "$KS"

echo
echo "created $KS"
echo "certificate fingerprint — it goes into each release's notes so users can verify a build"
echo "(keytool asks for the passphrase once more):"
keytool -list -v -keystore "$KS" -alias "$ALIAS" | grep -E 'SHA256:' || true
echo
echo "next:  tools/build-apk.sh --release      (apksigner will ask for the passphrase)"
