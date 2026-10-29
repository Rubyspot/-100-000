#!/usr/bin/env bash
# Encode a side-by-side 180° lat-long video for Quest 3 and split it into
# fragmented MP4 segments that video.js streams with Media Source Extensions.
#
#   tools/encode-video.sh input.mp4 [out_dir=video] [bitrate=28M]
#
# 4096x2048 H.264 High (2048x2048 per eye) is the largest size Quest Browser
# decodes reliably in hardware; ~28 Mbit/s keeps it clean. 6 s segments stay
# far below GitHub's 100 MB file limit.
set -euo pipefail
in="$1"; out="${2:-video}"; rate="${3:-28M}"
mkdir -p "$out"; rm -f "$out"/*.m4s "$out"/init.mp4 "$out"/manifest.json "$out"/index.m3u8

ffmpeg -hide_banner -y -i "$in" \
  -vf "scale=4096:2048:flags=lanczos,format=yuv420p" -r 30 \
  -c:v libx264 -preset slow -profile:v high -level:v 5.1 \
  -b:v "$rate" -maxrate "$rate" -bufsize "$rate" -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 192k -ac 2 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/seg%03d.m4s" \
  "$out/index.m3u8"

has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$in" | head -1)
python3 - "$out" "$has_audio" <<'PY'
import json, sys, re
out, has_audio = sys.argv[1], sys.argv[2]
lines = open(f"{out}/index.m3u8").read().splitlines()
segs = [l for l in lines if l.endswith(".m4s")]
dur = sum(float(re.match(r"#EXTINF:([\d.]+)", l).group(1)) for l in lines if l.startswith("#EXTINF"))
codecs = "avc1.640033" + (",mp4a.40.2" if has_audio else "")
json.dump({"mime": f'video/mp4; codecs="{codecs}"', "init": "init.mp4", "segments": segs, "duration": dur},
          open(f"{out}/manifest.json", "w"), indent=1)
print(f"{len(segs)} segments, {dur:.1f} s")
PY
rm -f "$out/index.m3u8"
du -sh "$out"
