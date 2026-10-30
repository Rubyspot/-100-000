#!/usr/bin/env bash
# Cut the 180° SBS master into fragmented MP4 segments for video.js WITHOUT
# re-encoding the picture: the HEVC stream is copied bit for bit, so it keeps
# the master's full resolution, frame rate and bitrate. Only the audio is
# converted (PCM can't play through Media Source Extensions) to 320k AAC.
# Segments break on the master's keyframes, so export it with a short GOP (1 s).
#
# The result is too big for GitHub Pages (~1 GB/min); host it elsewhere and
# point main.js ORIGINAL_SRC (or ?video=<url>/) at it.
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
python3 - "$out" "hvc1.$p.6.L$level.B0" "$has_audio" <<'PY'
import json, sys, re
out, vcodec, has_audio = sys.argv[1:4]
lines = open(f"{out}/index.m3u8").read().splitlines()
segs = [l for l in lines if l.endswith(".m4s")]
dur = sum(float(re.match(r"#EXTINF:([\d.]+)", l).group(1)) for l in lines if l.startswith("#EXTINF"))
codecs = vcodec + (",mp4a.40.2" if has_audio else "")
json.dump({"mime": f'video/mp4; codecs="{codecs}"', "init": "init.mp4", "segments": segs, "duration": dur},
          open(f"{out}/manifest.json", "w"), indent=1)
print(f"{len(segs)} segments, {dur:.1f} s, {codecs}")
PY
rm -f "$out/index.m3u8"
du -sh "$out"
