#!/usr/bin/env bash
# Build the Darwin-only SystemLanguageModel helper.
#
# Usage: scripts/build-apple-lm-sidecar.sh [arch]
#   arch defaults to host arch (arm64 / x86_64).
#
# FoundationModels.framework ships with the macOS 26+ SDK. Prefer Xcode-beta
# when present so Variant inspection (macOS 27) is available.
set -euo pipefail

ARCH="${1:-$(uname -m)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apple-lm-sidecar/main.swift"
OUT="$ROOT/bin/steno-apple-lm"

if [[ ! -f "$SRC" ]]; then
    echo "missing sidecar source: $SRC" >&2
    exit 1
fi

if [[ -d /Applications/Xcode-beta.app ]]; then
    export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
fi

mkdir -p "$ROOT/bin"

TMP_OUT="${OUT}.tmp.$$"
trap 'rm -f "$TMP_OUT"' EXIT

# `SystemLanguageModel.variant` is a macOS 27 SDK addition. Runtime
# availability checks alone are not enough: Xcode 26 still has to type-check
# the member and fails before it can build the otherwise-compatible sidecar.
# Probe the selected SDK and compile variant reporting only when that API is
# actually present. The model itself remains available through
# `SystemLanguageModel.default` with the macOS 26 SDK.
SWIFT_DEFINE=""
if xcrun swiftc \
    -typecheck \
    -parse-as-library \
    -target "${ARCH}-apple-macos26.0" \
    -framework FoundationModels \
    -DSTENO_HAS_MODEL_VARIANT \
    "$SRC" >/dev/null 2>&1; then
    SWIFT_DEFINE="-DSTENO_HAS_MODEL_VARIANT"
fi

xcrun swiftc \
    -O \
    -parse-as-library \
    -target "${ARCH}-apple-macos26.0" \
    -framework FoundationModels \
    ${SWIFT_DEFINE:+$SWIFT_DEFINE} \
    "$SRC" \
    -o "$TMP_OUT"

test -x "$TMP_OUT"
codesign --sign - "$TMP_OUT" 2>/dev/null || true
mv -f "$TMP_OUT" "$OUT"
trap - EXIT
file "$OUT"
