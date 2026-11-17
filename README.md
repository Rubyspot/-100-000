# video-8k: the 180° video in 8K, in streamable pieces

This branch holds only the 8K copies of the 180° side-by-side video (8000×4000,
60 fps, HEVC; the 66 s demo cut), split into fragmented MP4 segments so that no
file reaches GitHub's 100 MB limit.

- The folder itself is the original master, about 130 Mbit/s and 1.07 GB. The
  picture is the master's own stream copied bit for bit, with no re-encode; only
  the audio was converted to AAC, because PCM can't play through Media Source
  Extensions. The video controls tag it `8K+`.
- `light/` is the same picture at the same size and frame rate, re-encoded to
  about 65 Mbit/s (0.5 GB), for connections that can't keep up with the master.
  The controls tag it `8K`.

The opening on `main` streams them from

    https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/
    https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/light/

(`ORIGINAL_SRC` and `LIGHT_SRC` in `main.js`). In the headset it loads the best
one the connection can deliver ahead of time, keeps it on disk for the next
visit, and plays the one that will run without stalling; the 4K H.264 copy in
`main`'s `video/` folder is the last resort (`video.js` on `main` has the rules).

In each folder:

- `manifest.json`: tag, codec string, init segment, the segment list with each
  segment's start time, duration, total bytes and frame rate, read by `video.js`.
- `init.mp4` and `seg000.m4s` onward: about 2 s each (32 MB in the master,
  16 MB in `light/`).

Made on `main` with `tools/segment-original.sh` (the master) and
`tools/encode-8k-light.sh` (`light/`). To replace the video, run both on the new
master and commit the new files here; `tools/manifest.py <folder>` rewrites a
manifest on its own.

The branch shares no history with `main` and is never merged into it. GitHub
Pages caps a site at 1 GB, which is why these files live here instead.
