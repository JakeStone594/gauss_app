#!/usr/bin/env bash
# Build the desktop executables from desktop/ + web/ — a Windows .exe (and a Linux binary for
# testing), cross-compiled with Go; no Windows machine, no Wine needed.
#
#   tools/build-windows.sh                      → build/gauss-<version>-windows-x64.exe
#                                                 build/gauss-<version>-linux-x64
#   VERSION_NAME=1.3 tools/build-windows.sh
#   NO_WINRES=1 tools/build-windows.sh          skip the icon/version resource
#
# Needs Go (tools/setup-go.sh puts it in ~/tools/go). The build is offline: the launcher has no
# dependencies, and the Windows icon + version resource is compiled with mingw's windres
# (x86_64-w64-mingw32-windres, from binutils-mingw-w64) when it is installed; otherwise
# go-winres is used, which needs the network once to be fetched.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
D="$HERE/desktop"
OUT="$HERE/build"
VN="${VERSION_NAME:-1.2}"
[[ -d "$HOME/tools/go/bin" ]] && export PATH="$HOME/tools/go/bin:$PATH"
command -v go >/dev/null || { echo "go is not installed (https://go.dev/dl)" >&2; exit 1; }
mkdir -p "$OUT"

echo "── embed: the web app"
rm -rf "$D/web"
cp -a "$HERE/web" "$D/web"

cd "$D"
echo "── windows icon + version resource"
rm -f rsrc_windows_*.syso
# windres (offline) first; go-winres (an installed binary, else `go run`, which fetches it) second.
windres_resource() {
    local v4 ico rc
    IFS=. read -r -a parts <<< "$VN.0.0.0"            # 1.2.1 → 1,2,1,0
    v4="${parts[0]},${parts[1]},${parts[2]},${parts[3]}"
    convert web/icons/icon-512.png -define icon:auto-resize=256,128,64,48,32,16 gauss.ico
    sed "s/@VERSION@/$(printf '%s.%s.%s.%s' "${parts[@]:0:4}")/" winres.manifest.in > gauss.manifest
    sed -e "s/@V4@/$v4/" -e "s/@VN@/$VN/" winres.rc.in > gauss.rc
    x86_64-w64-mingw32-windres --codepage=65001 -O coff -F pe-x86-64 -o rsrc_windows_amd64.syso gauss.rc
    rm -f gauss.ico gauss.manifest gauss.rc
}
WINRES=""
for c in go-winres "$HOME/go/bin/go-winres"; do command -v "$c" >/dev/null && { WINRES="$c"; break; }; done
[[ -z "$WINRES" ]] && WINRES="go run github.com/tc-hib/go-winres@v0.3.3"
if [[ "${NO_WINRES:-0}" == 1 ]]; then
    echo "   skipped (NO_WINRES=1)"
elif command -v x86_64-w64-mingw32-windres >/dev/null && windres_resource; then
    echo "   ok (windres)"
elif $WINRES make --in winres.json --out rsrc \
        --product-version "$VN.0.0" --file-version "$VN.0.0" >/dev/null 2>&1; then
    echo "   ok ($WINRES)"
else
    echo "   resource failed — building without an icon"
fi

echo "── build (offline)"
# -trimpath and -s -w: no local paths, symbols or debug info in the binaries (they are published).
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOTELEMETRY=off
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
    -ldflags "-s -w -H windowsgui -X main.version=$VN" -o "$OUT/gauss-$VN-windows-x64.exe" .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
    -ldflags "-s -w -X main.version=$VN" -o "$OUT/gauss-$VN-linux-x64" .
rm -f rsrc_windows_*.syso
rm -rf "$D/web"

ls -la "$OUT/gauss-$VN-windows-x64.exe" "$OUT/gauss-$VN-linux-x64" | awk '{print $5, $9}'
file "$OUT/gauss-$VN-windows-x64.exe" | sed 's/^/   /'
