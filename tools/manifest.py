#!/usr/bin/env python3
"""Write manifest.json for a folder of fragmented MP4 segments (init.mp4 and
seg*.m4s), the list video.js streams from:

  { label, mime, init, segments, starts, duration, bytes, fps }

  label   tag on the video controls while this source plays ("8K+", "8K", "4K")
  mime    what the browser is asked whether it can decode
  starts  when each segment starts, in seconds (the last one is shorter, and a
          stream-copied master's are as long as its keyframes make them)
  bytes   all segments together; from it video.js works out how fast the
          connection has to be, and whether to keep the source on disk
  fps     frames a second; the headset is asked for a refresh rate it divides

  tools/manifest.py <folder> [--label 8K] [--mime 'video/mp4; codecs="..."']

Without --label or --mime the folder's present manifest.json supplies them, so
this also brings an older manifest up to date. Needs ffprobe.
"""
import argparse, json, os, subprocess, sys


def probe(args):
    return subprocess.run(["ffprobe", "-v", "error", *args], check=True, capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--label")
    ap.add_argument("--mime")
    a = ap.parse_args()
    path = os.path.join(a.folder, "manifest.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    label, mime = a.label or old.get("label"), a.mime or old.get("mime")
    if not label or not mime:
        sys.exit("no manifest.json there yet: give --label and --mime")
    init = os.path.join(a.folder, "init.mp4")
    segs = sorted(f for f in os.listdir(a.folder) if f.endswith(".m4s"))
    if not segs or not os.path.exists(init):
        sys.exit(f"no init.mp4 and seg*.m4s in {a.folder}")

    starts, end = [], 0.0
    for seg in segs:
        # A segment only reads together with the init segment in front of it.
        src = f"concat:{init}|{os.path.join(a.folder, seg)}"
        rows = [r.split(",") for r in probe(["-select_streams", "v:0", "-show_entries", "packet=pts_time,duration_time",
                                             "-of", "csv=p=0", src]).split()]
        times = [(float(r[0]), float(r[1]) if len(r) > 1 and r[1] not in ("", "N/A") else 0.0) for r in rows if r[0] not in ("", "N/A")]
        starts.append(round(min(t for t, _ in times), 4))
        end = max(t + d for t, d in times)
    num, den = probe(["-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0",
                      f"concat:{init}|{os.path.join(a.folder, segs[0])}"]).strip().split("/")
    fps = round(int(num) / int(den), 3)
    size = sum(os.path.getsize(os.path.join(a.folder, s)) for s in segs)
    json.dump({"label": label, "mime": mime, "init": "init.mp4", "segments": segs, "starts": starts,
               "duration": round(end, 4), "bytes": size, "fps": int(fps) if fps == int(fps) else fps},
              open(path, "w"), indent=1)
    print(f"{len(segs)} segments, {end:.1f} s, {fps:g} fps, {label}, {mime.split('codecs=')[-1]}, {size * 8 / end / 1e6:.0f} Mbit/s")


main()
