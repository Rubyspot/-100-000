#!/usr/bin/env bash
# Encode a side-by-side 180° lat-long video for Quest 3 and split it into
# fragmented MP4 segments that video.js streams with Media Source Extensions.
#
#   tools/encode-video.sh input.mp4 [out_dir=video] [bitrate=28M]
#
# 4096x2048 H.264 High (2048x2048 per eye) is the largest H.264 size Quest
# Browser decodes reliably in hardware. Keeps the source frame rate (up to 60).
# 2 s segments stay far below GitHub's 100 MB file limit. This is the fallback
# for browsers that can't decode the 8K HEVC sources (tools/segment-original.sh,
# tools/encode-8k-light.sh) and for connections too slow for them.
set -euo pipefail
in="$1"; out="${2:-video}"; rate="${3:-30M}"
mkdir -p "$out"; rm -f "$out"/*.m4s "$out"/init.mp4 "$out"/manifest.json "$out"/index.m3u8

ffmpeg -hide_banner -y -i "$in" \
  -vf "scale=4096:2048:flags=lanczos,format=yuv420p" -fpsmax 60 \
  -c:v libx264 -preset slow -profile:v high -level:v 5.2 \
  -b:v "$rate" -maxrate "$rate" -bufsize "$rate" -force_key_frames "expr:gte(t,n_forced*1)" -sc_threshold 0 \
  -c:a aac -b:a 192k -ac 2 \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/seg%03d.m4s" \
  "$out/index.m3u8"

has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$in" | head -1)
rm -f "$out/index.m3u8"
python3 "$(dirname "$0")/manifest.py" "$out" --label 4K --mime "video/mp4; codecs=\"avc1.640034${has_audio:+,mp4a.40.2}\""
du -sh "$out"
