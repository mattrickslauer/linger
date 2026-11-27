#!/usr/bin/env bash
# Render preview stills at the given global times and tile them.
# usage: preview.sh WORK_DIR OUT.jpg t1 t2 ...
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$1"; out="$2"; shift 2
cp "$here/index.html" "$work/"
python3 "$here/render.py" "$work" --at "$@"
files=()
for t in "$@"; do files+=("$work/preview/$(printf 't%07.2f.jpg' "$t")"); done
magick montage "${files[@]}" -tile 2x -geometry 960x540+4+4 -background black "$out"
