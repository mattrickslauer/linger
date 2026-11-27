#!/usr/bin/env bash
# Encode rendered frames + soundtrack into the final H.264 MP4.
# usage: encode.sh WORK_DIR OUT.mp4
set -euo pipefail
work="$1"; out="$2"
ffmpeg -v error -stats -y -framerate 30 -i "$work/out/%05d.jpg" -i "$work/mix.wav" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -tune film \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$out"
