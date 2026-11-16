#!/usr/bin/env bash
# Build the desktop executables from desktop/ + web/ — a Windows .exe (and a Linux binary for
# testing), cross-compiled with Go; no Windows machine, no Wine needed.
#
#   tools/build-windows.sh                      → build/gauss-<version>-windows-x64.exe
#                                                 build/gauss-<version>-linux-x64
#   VERSION_NAME=1.3 tools/build-windows.sh
#   NO_WINRES=1 tools/build-windows.sh          skip the icon/version resource — fully offline
#
# Needs Go (tools/setup-go.sh puts it in ~/tools/go). The build itself is offline: the launcher
# has no dependencies. Only the Windows icon and version resource need the network, once, to
# fetch go-winres; without it the .exe is identical except for the icon.
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
if [[ "${NO_WINRES:-0}" == 1 ]]; then
    echo "   skipped (NO_WINRES=1)"
elif go run github.com/tc-hib/go-winres@v0.3.3 make --in winres.json --out rsrc \
        --product-version "$VN.0.0" --file-version "$VN.0.0" >/dev/null 2>&1; then
    echo "   ok"
else
    echo "   go-winres failed — building without an icon"
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
