#!/usr/bin/env bash
# Lighter 8K copy of the 180° SBS master, for connections that can't keep up
# with the untouched one (tools/segment-original.sh, ~130 Mbit/s): the same
# picture size and frame rate, HEVC at 60 Mbit/s, cut into the same 2 s
# segments on 1 s keyframes. video.js plays it when the master would stall,
# before it falls back to the 4K copy (tools/encode-video.sh).
#
#   tools/encode-8k-light.sh master.mov [out_dir=video-8k-light] [bitrate=60M]
#
# Slow: about 2.5 frames a second on 4 cores. The result goes in the light/
# folder of the video-8k branch (main.js LIGHT_SRC).
set -euo pipefail
in="$1"; out="${2:-video-8k-light}"; rate="${3:-60M}"
mkdir -p "$out"; rm -f "$out"/*.m4s "$out"/init.mp4 "$out"/manifest.json "$out"/index.m3u8

r="${rate%M}"; max="$((r * 12 / 10))M"; buf="$((r * 24 / 10))M"
# Audio that is already AAC is copied; anything else (PCM in a .mov) becomes 320k AAC.
acodec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$in" | head -1)
if [ "$acodec" = aac ]; then audio=(-c:a copy); else audio=(-c:a aac -b:a 320k -ac 2); fi

ffmpeg -hide_banner -loglevel error -stats -y -i "$in" -map 0:v:0 -map 0:a:0? \
  -vf format=yuv420p -fpsmax 60 \
  -c:v libx265 -preset "${PRESET:-fast}" -tag:v hvc1 \
  -b:v "$rate" -maxrate "$max" -bufsize "$buf" -force_key_frames "expr:gte(t,n_forced*1)" \
  -x265-params "keyint=60:min-keyint=60:scenecut=0:open-gop=0:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited:log-level=error" \
  "${audio[@]}" \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/seg%03d.m4s" \
  "$out/index.m3u8"

# RFC 6381 codec string from the stream itself, e.g. hvc1.1.6.L183.B0
read -r profile level < <(ffprobe -v error -select_streams v:0 -show_entries stream=profile,level -of csv=p=0 "$out/init.mp4" | tr ',' ' ')
case "$profile" in Main) p=1;; "Main 10") p=2;; *) echo "unexpected HEVC profile $profile" >&2; exit 1;; esac
has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$in" | head -1)
width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$out/init.mp4")
# Tag shown on the video controls while this source plays.
if [ "$width" -ge 7000 ]; then label=8K; elif [ "$width" -ge 5000 ]; then label=6K; elif [ "$width" -ge 3500 ]; then label=4K; else label=HD; fi
rm -f "$out/index.m3u8"
python3 "$(dirname "$0")/manifest.py" "$out" --label "$label" --mime "video/mp4; codecs=\"hvc1.$p.6.L$level.B0${has_audio:+,mp4a.40.2}\""
du -sh "$out"
