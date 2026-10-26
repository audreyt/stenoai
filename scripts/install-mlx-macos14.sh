#!/usr/bin/env bash
# Replace the installed mlx / mlx-metal wheels with their macosx_14_0 builds.
#
# pip installs the newest wheel the build host accepts. On a macOS 15 (or newer)
# host that is mlx's macosx_15_0 (or later) build, whose libmlx.dylib refuses to
# load on older systems, so the bundled Parakeet failed at model load on macOS
# 14.x (#531) although the app only requires 14.4. Run this after
# `pip install -r requirements.txt` and before PyInstaller, with the same Python.
# scripts/verify_macos_minimum.py checks the result in the built bundle.
#
# No-op off macOS. Uses $PYTHON if set, otherwise `python3`.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-mlx-macos14: not macOS, nothing to do"
  exit 0
fi

PYTHON="${PYTHON:-python3}"
version_of() {
  "$PYTHON" -c "import importlib.metadata as m; print(m.version('$1'))"
}
MLX_VERSION="$(version_of mlx)"
METAL_VERSION="$(version_of mlx-metal)"
PY_VERSION="$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")"

WHEELS="$(mktemp -d "${TMPDIR:-/tmp}/mlx-macos14.XXXXXX")"
trap 'rm -rf "$WHEELS"' EXIT

"$PYTHON" -m pip download "mlx==$MLX_VERSION" "mlx-metal==$METAL_VERSION" \
  --no-deps --only-binary=:all: --platform macosx_14_0_arm64 \
  --python-version "$PY_VERSION" --implementation cp -d "$WHEELS"
"$PYTHON" -m pip install --force-reinstall --no-deps "$WHEELS"/*.whl
echo "install-mlx-macos14: mlx $MLX_VERSION and mlx-metal $METAL_VERSION now use the macosx_14_0 wheels"
