#!/usr/bin/env bash
# One of Ilia's Jane scans (.ply from Postshot) -> the file the opening loads,
# plus the numbers jane/splat-jane.js needs for it.
#
#   tools/jane-pose.sh scan.ply yoga      -> assets/jane/yoga-150k.sog
#
# Same recipe as the surf and sing poses: spherical harmonics off, cut to
# 150k splats with the adaptive decimator, SOG v2. Then it prints the scan's
# measurements for JANE_SCANS in jane/splat-jane.js:
#   feetY   where her feet are (scan units, y points down)
#   cx, cz  the vertical axis she spins around in the transformation
#   height  head to feet. That sets her size (she is 1.75 m), so it only fits
#           a standing pose; for a seated or bent one keep surf's 1.634 (the
#           same capture rig) or measure something on her that is in both.
# Needs node (npx fetches @playcanvas/splat-transform) and python3 with numpy.
set -euo pipefail
in="$1"; name="$2"; count="${3:-150000}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
T="npx -y @playcanvas/splat-transform -g cpu -w"
$T "$in" -H 0 "$tmp/sh0.ply" >/dev/null
$T "$tmp/sh0.ply" --decimate-adaptive "$count" "$tmp/cut.ply" >/dev/null
$T "$tmp/cut.ply" --sog-version 2 "$repo/assets/jane/$name-$((count / 1000))k.sog" >/dev/null
ls -la "$repo/assets/jane/$name-$((count / 1000))k.sog"
python3 -I - "$in" "$name" <<'EOF'
import sys, numpy as np
path, name = sys.argv[1], sys.argv[2]
with open(path, 'rb') as f:
    head = b''
    while not head.endswith(b'end_header\n'):
        head += f.readline()
    lines = head.decode().split('\n')
    n = int([l for l in lines if l.startswith('element vertex')][0].split()[2])
    props = [l.split()[2] for l in lines if l.startswith('property')]
    data = np.frombuffer(f.read(n * 4 * len(props)), dtype='<f4').reshape(n, len(props))
d = {k: data[:, i] for i, k in enumerate(props)}
x, y, z = d['x'], d['y'], d['z']
solid = 1 / (1 + np.exp(-d['opacity'])) > 0.5
top, feet = np.percentile(y[solid], [0.1, 99.9])
h = (feet - y) / (feet - top)
torso = solid & (h > 0.3) & (h < 0.7)
print(f"  {name}: {{ url: './assets/jane/{name}-150k.sog', height: {feet - top:.3f}, feetY: {feet:.3f}, "
      f"cx: {np.median(x[torso]):.3f}, cz: {np.median(z[torso]):.3f}, aa: true }},")
print('(height is head to feet as scanned; for a pose that is not standing, use 1.634)')
EOF
