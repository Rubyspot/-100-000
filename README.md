# video-8k: the 180° video's original master, in streamable pieces

This branch holds only the original master of the 180° side-by-side video
(8000×4000, 60 fps, HEVC, about 120 Mbit/s; the 66 s demo cut), split into
fragmented MP4 segments so that no file reaches GitHub's 100 MB limit. The
picture is the master's own stream copied bit for bit, with no re-encode; only
the audio was converted to AAC, because PCM can't play through Media Source
Extensions.

The opening on `main` streams it from

    https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/

(`ORIGINAL_SRC` in `main.js`) and plays the 4K H.264 copy in `main`'s `video/`
folder wherever HEVC can't be decoded or the connection is too slow for it.

- `manifest.json`: label, codec string, init segment, segment list and duration, read by `video.js`.
- `init.mp4` and `seg000.m4s` to `seg032.m4s`: about 2 s and 32 MB each, 1.07 GB in all.
- Made with `tools/segment-original.sh` on `main`. To replace the video, run it on the
  new master and commit the new files here.

The branch shares no history with `main` and is never merged into it. GitHub
Pages caps a site at 1 GB, which is why these files live here instead.
