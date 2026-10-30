#!/usr/bin/env bash
# One step from the Drive master to the streamed video/ folder:
# download, encode for Quest 3 (tools/encode-video.sh), delete the master.
#
#   tools/drive-to-video.sh <file_id_or_share_url> [out_dir=video] [bitrate=28M]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="${TMPDIR:-/tmp}/master-$$.mp4"
trap 'rm -f "$tmp"' EXIT
"$here/fetch-drive.sh" "$1" "$tmp"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size -of compact "$tmp"
"$here/encode-video.sh" "$tmp" "${2:-video}" "${3:-28M}"
