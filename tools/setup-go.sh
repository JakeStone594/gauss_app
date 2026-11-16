#!/usr/bin/env bash
# Install the Go toolchain for tools/build-windows.sh — self-contained, no apt, nothing outside
# ~/tools/go (override with GO_DIR=…). Downloads the current release from go.dev (~80 MB).
#
#   tools/setup-go.sh
set -euo pipefail

GO_DIR="${GO_DIR:-$HOME/tools/go}"
if [[ -x "$GO_DIR/bin/go" ]]; then
    echo "already installed: $("$GO_DIR/bin/go" version)"
    exit 0
fi
ver="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)"      # e.g. go1.25.4
arch="$(uname -m)"
case "$arch" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; esac
url="https://go.dev/dl/${ver}.linux-${arch}.tar.gz"
echo "fetching $url"
tmp="$(mktemp -d)"
curl -fL --retry 3 -o "$tmp/go.tgz" "$url"
mkdir -p "$(dirname "$GO_DIR")"
tar xzf "$tmp/go.tgz" -C "$tmp"
mv "$tmp/go" "$GO_DIR"
rm -rf "$tmp"
echo "installed: $("$GO_DIR/bin/go" version) in $GO_DIR"
echo "tools/build-windows.sh finds it there by itself; for your shell:  export PATH=\"$GO_DIR/bin:\$PATH\""
