#!/usr/bin/env bash
# Cut the 180° SBS master into fragmented MP4 segments for video.js WITHOUT
# re-encoding the picture: the HEVC stream is copied bit for bit, so it keeps
# the master's full resolution, frame rate and bitrate. Only the audio is
# converted (PCM can't play through Media Source Extensions) to 320k AAC.
# Segments break on the master's keyframes, so export it with a short GOP (1 s).
#
# The result is too big for GitHub Pages (~1 GB/min), so it is committed to the
# video-8k branch (its README says how) and main.js ORIGINAL_SRC streams it
# from GitHub's raw file server. ?video=<url>/ plays any other copy.
# tools/encode-8k-light.sh makes the lighter 8K copy that goes next to it.
#
#   tools/segment-original.sh master.mov [out_dir=video-original]
set -euo pipefail
in="$1"; out="${2:-video-original}"
mkdir -p "$out"; rm -f "$out"/*.m4s "$out"/init.mp4 "$out"/manifest.json "$out"/index.m3u8

ffmpeg -hide_banner -loglevel error -y -i "$in" -map 0:v:0 -map 0:a:0? \
  -c:v copy -tag:v hvc1 -c:a aac -b:a 320k -ac 2 \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/seg%03d.m4s" \
  "$out/index.m3u8"

# RFC 6381 codec string from the stream itself, e.g. hvc1.1.6.L186.B0
read -r profile level < <(ffprobe -v error -select_streams v:0 -show_entries stream=profile,level -of csv=p=0 "$out/init.mp4" | tr ',' ' ')
case "$profile" in Main) p=1;; "Main 10") p=2;; *) echo "unexpected HEVC profile $profile" >&2; exit 1;; esac
has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$in" | head -1)
width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$out/init.mp4")
# Tag shown on the video controls while this source plays; the + marks the untouched master.
if [ "$width" -ge 7000 ]; then label=8K+; elif [ "$width" -ge 5000 ]; then label=6K+; elif [ "$width" -ge 3500 ]; then label=4K+; else label=HD; fi
rm -f "$out/index.m3u8"
python3 "$(dirname "$0")/manifest.py" "$out" --label "$label" --mime "video/mp4; codecs=\"hvc1.$p.6.L$level.B0${has_audio:+,mp4a.40.2}\""
du -sh "$out"
