#!/usr/bin/env bash
# Download a large Google Drive file (shared as "Anyone with the link").
# Uses drive.usercontent.google.com with confirm=t, which skips the
# "can't scan for viruses" page that big files get. Resumes partial downloads.
#
#   tools/fetch-drive.sh <file_id_or_share_url> <out_file>
set -euo pipefail
id="$1"; out="$2"
[[ "$id" == http* ]] && id=$(sed -E 's#.*/d/([^/?]+).*#\1#; s#.*[?&]id=([^&]+).*#\1#' <<<"$id")
url="https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t"
for i in 1 2 3 4 5; do
  curl -fL --retry 3 -C - -o "$out" "$url" && break
  echo "retry $i"; sleep $((2 ** i))
done
if file "$out" | grep -qi html; then
  echo "Got an HTML page, not the video: set the file's sharing to 'Anyone with the link'." >&2
  exit 1
fi
ls -lh "$out"
