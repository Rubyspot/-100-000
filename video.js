// 180° side-by-side (left eye | right eye) lat-long video.
// In the headset it plays on a WebXR equirect media layer: the compositor
// samples the video directly, so it stays sharp and costs almost no GPU time.
// Without layers (flat preview, other browsers) it falls back to a textured
// half sphere per eye.
import * as THREE from 'three';

// The video is streamed as fragmented MP4 segments through Media Source
// Extensions, so no single file has to fit GitHub's 100 MB limit. Each folder
// in `bases` holds manifest.json ({ label, mime, init, segments, starts,
// duration, bytes, fps }, see tools/manifest.py) written by
// tools/segment-original.sh (untouched 8K HEVC master),
// tools/encode-8k-light.sh (the same picture at 60 Mbit/s) or
// tools/encode-video.sh (4K H.264 copy), best first.
//
// What makes it play smoothly:
// - Segments are loaded ahead of the player, starting when the page is ready
//   and not when play is pressed, and the big 8K sources are kept on disk
//   (Cache API), so by the time the video starts most of it is already here
//   and the next visit streams nothing at all.
// - The best source that will play through without stalling is chosen when
//   play is pressed, from what is on hand and how fast the rest is arriving.
// - If it stalls anyway (connection or decoder), the next lighter source takes
//   over at the same moment in the video.
const MANIFEST_WAIT = 6000; // ms before a host that doesn't answer is passed over
const SB_AHEAD = 70e6;      // bytes buffered ahead of the playhead (Chromium caps a video buffer at 150 MB)
const SB_TOTAL = 125e6;     // bytes buffered in all, ahead and behind
const MEM_WINDOW = 120e6;   // bytes a source that isn't kept on disk loads ahead of the player
const DISK_MIN = 300e6;     // sources this big or bigger are kept on disk (Video180's keepFrom)
const WRITES = 2;           // segments being written to disk at a time before loading waits for them
const LEAD = 40;            // seconds of loading ahead a visitor usually gives before pressing play
const SAFETY = 0.85;        // share of the measured connection speed that is counted on
const START_WAIT = 2;       // seconds a source may still need before it can start
const GIVE_UP = 5;          // seconds without a first segment before the next source is tried
const NO_START = 6;         // seconds with video in the player and nothing moving before the next source is tried
const STALL_LONG = 1.5;     // one stall this long, or two within STALL_SPAN seconds, moves to the next source
const STALL_SPAN = 12;

async function fetchBytes(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

const nameOf = (source) => source.manifest.label || 'video';
const now = () => performance.now() / 1000;
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

// The sources this browser can decode, in the order given. `notes` collects
// why a source was passed over, for the ?debug label in the headset.
async function findSources(bases, notes) {
  // All manifests at once, so a host that is slow to answer holds nothing up.
  const tries = await Promise.all(bases.map(async (base) => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), MANIFEST_WAIT);
    try {
      const r = await fetch(base + 'manifest.json', { signal: stop.signal });
      if (!r.ok) throw new Error(`${r.status} for manifest.json`);
      return { base, manifest: await r.json() };
    } catch (error) {
      return { base, error };
    } finally {
      clearTimeout(timer);
    }
  }));
  const found = [];
  for (const { base, manifest, error } of tries) {
    if (error) {
      notes.push('a source is unreachable');
      console.info(`video: skipping ${base}`, error);
    } else if (window.MediaSource && MediaSource.isTypeSupported(manifest.mime)) {
      found.push({ base, manifest });
    } else {
      notes.push(`${nameOf({ manifest })} can't decode`);
      console.info(`video: skipping ${base}, can't decode ${manifest.mime}`);
    }
  }
  return found;
}

// One source's segments: loads them ahead of the player, one at a time, and
// keeps them. On disk through the Cache API for the big sources, so a 1 GB
// video doesn't sit in memory and a later visit finds it there; in memory
// (MEM_WINDOW bytes ahead of the player) otherwise.
class SegmentStore {
  constructor({ base, manifest }, { keepFrom = DISK_MIN } = {}) {
    this.base = base;
    this.manifest = manifest;
    this.keepFrom = keepFrom;
    this.n = manifest.segments.length;
    // When each segment starts and, last, when the video ends. They aren't all
    // the same length; a manifest that doesn't say is taken to be even.
    const D = manifest.duration, even = manifest.segments.map((_, i) => (i * D) / this.n);
    this.starts = (manifest.starts && manifest.starts.length === this.n ? manifest.starts.slice() : even).concat(D);
    this.segSec = D / this.n; // a typical segment
    this.avg = manifest.bytes ? manifest.bytes / this.n : 0; // bytes a segment (learned if the manifest doesn't say)
    this.cache = null;
    this.diskFull = false;
    this.onDisk = new Set();
    this.mem = new Map(); // segment -> Blob
    this.memBytes = 0;
    this.writes = new Set(); // segments on their way to the disk
    this.at = 0;        // the segment the player is at; loading runs on from here
    this.urgent = -1;   // a segment the player is waiting for
    this.on = false;    // loading ahead
    this.job = null;    // the download in flight: { i, stop, t0, t1 (first byte), got, size }
    this.samples = [];  // [bytes, seconds] of the last downloads
    this.waiters = new Map();
    this.errors = 0;
    this.failed = null;
    this.looping = false;
  }

  // Find what an earlier visit left on disk (and drop an older video's files).
  async open() {
    if ((this.manifest.bytes || 0) < this.keepFrom || !('caches' in window)) return;
    try {
      const prefix = `video|${new URL(this.base, location.href).href}|`;
      const name = prefix + hash(JSON.stringify(this.manifest));
      for (const k of await caches.keys()) if (k.startsWith(prefix) && k !== name) await caches.delete(k);
      this.cache = await caches.open(name);
      for (const req of await this.cache.keys()) {
        const i = this.manifest.segments.indexOf(req.url.slice(req.url.lastIndexOf('/') + 1));
        if (i >= 0) this.onDisk.add(i);
      }
      const est = await navigator.storage?.estimate?.();
      const missing = this.manifest.bytes * (1 - this.onDisk.size / this.n);
      if (est && est.quota && est.quota - est.usage < missing + 100e6) this.diskFull = true;
    } catch (e) {
      this.cache = null;
      console.info('video: no disk cache for', this.base, e);
    }
  }

  url(i) { return new URL(this.base + this.manifest.segments[i], location.href).href; }
  has(i) { return this.onDisk.has(i) || this.mem.has(i); }
  // The segment that holds time t.
  segAt(t) {
    let lo = 0, hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  // The first segment from `from` on that isn't on hand (n: all of them are).
  gap(from = 0) {
    let i = from;
    while (i < this.n && this.has(i)) i += 1;
    return i;
  }
  // Seconds of video on hand from segment `from` on, without a gap, and what is left to play from there.
  run(from = 0) { return this.starts[this.gap(from)] - this.starts[from]; }
  left(from = 0) { return this.starts[this.n] - this.starts[from]; }
  get complete() { return this.onDisk.size + this.mem.size >= this.n && this.gap(0) === this.n; }
  get keepsAll() { return !!this.cache && !this.diskFull; }
  // Bytes of video a second of it takes.
  get rate() { return this.avg / this.segSec; }

  // Bytes a second the connection has been delivering (0: not known yet).
  // The last few downloads, capped by the one in flight when it is running
  // late. The very first download reports as it goes, so this is known about
  // a second after loading starts.
  get bps() {
    let bytes = 0, sec = 0;
    for (const [b, s] of this.samples) { bytes += b; sec += s; }
    const j = this.job, t = now();
    if (!sec) return j && j.got && t - j.t1 > 1 ? j.got / (t - j.t1) : 0;
    return j && t - j.t0 > 0.5 ? Math.min(bytes / sec, j.size / (t - j.t0)) : bytes / sec;
  }
  get measuredAt() { return this.job ? now() : (this.lastSample || 0); }

  // Load ahead from segment `from` (or carry on from where the player is).
  go(from) {
    if (from !== undefined) this.at = from;
    this.on = true;
    this.kick();
  }
  // Stop loading ahead, and let go of the download in flight unless the player waits for it.
  rest() {
    this.on = false;
    if (this.job && this.job.i !== this.urgent) this.job.stop.abort();
  }
  // The player is at segment i now. A source that lives in memory lets go of what is behind it.
  moveTo(i) {
    this.at = i;
    if (!this.keepsAll) {
      for (const [k, blob] of this.mem) {
        if (k < i - 1) { this.mem.delete(k); this.memBytes -= blob.size; }
      }
    }
    this.kick();
  }
  // The player no longer waits for a segment (it skipped, or went to another source).
  calm() {
    this.urgent = -1;
    const gone = new Error('no longer wanted');
    for (const list of this.waiters.values()) list.forEach((w) => w.reject(gone));
    this.waiters.clear();
  }

  next() {
    if (this.urgent >= 0 && !this.has(this.urgent)) return this.urgent;
    if (!this.on) return -1;
    for (let i = this.at; i < this.n; i++) {
      if (this.has(i)) continue;
      return this.keepsAll || this.memBytes + this.avg <= MEM_WINDOW ? i : -1;
    }
    // With a disk to keep it on, what is before the player too (for the next time).
    if (this.keepsAll) for (let i = 0; i < this.at; i++) if (!this.has(i)) return i;
    return -1;
  }
  kick() { if (!this.looping && !this.failed) this.loop(); }
  async loop() {
    this.looping = true;
    try {
      for (let i = this.next(); i >= 0 && !this.failed; i = this.next()) await this.download(i);
    } finally {
      this.looping = false;
    }
  }

  async download(i) {
    const stop = new AbortController();
    const job = this.job = { i, stop, t0: now(), t1: 0, got: 0, size: this.avg || Infinity };
    try {
      // What goes to the disk cache doesn't need a second copy in the browser's own cache.
      const r = await fetch(this.url(i), { signal: stop.signal, cache: this.keepsAll ? 'no-store' : 'default' });
      if (!r.ok) throw Object.assign(new Error(`${r.status} for ${this.manifest.segments[i]}`), { fatal: r.status >= 400 && r.status < 500 });
      job.t1 = now();
      job.size = Number(r.headers.get('content-length')) || job.size;
      let blob;
      if (this.samples.length || !r.body) {
        blob = await r.blob();
      } else {
        // The first one is read piece by piece, to see how fast it comes (bps).
        const reader = r.body.getReader(), parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          job.got += value.length;
        }
        blob = new Blob(parts);
      }
      this.samples.push([blob.size, Math.max(0.001, now() - job.t0)]);
      if (this.samples.length > 3) this.samples.shift();
      this.lastSample = now();
      if (!this.manifest.bytes) this.avg = this.avg ? this.avg * 0.7 + blob.size * 0.3 : blob.size;
      this.errors = 0;
      if (this.job === job) this.job = null;
      await this.keep(i, blob);
    } catch (e) {
      if (this.job === job) this.job = null;
      if (stop.signal.aborted) {
        // Let go of on purpose. What it showed of the connection's speed is kept.
        const t = now() - job.t1;
        if (!this.samples.length && job.got && t > 1) { this.samples.push([job.got, t]); this.lastSample = now(); }
        return;
      }
      this.errors += 1;
      console.info(`video: ${this.manifest.segments[i]} of ${this.base} didn't arrive`, e.message || e);
      if (e.fatal || this.errors > 3) {
        this.failed = e;
        this.on = false;
        for (const list of this.waiters.values()) list.forEach((w) => w.reject(e));
        this.waiters.clear();
        return;
      }
      await new Promise((done) => setTimeout(done, 400 * 2 ** this.errors));
    }
  }

  async keep(i, blob) {
    this.mem.set(i, blob);
    this.memBytes += blob.size;
    if (this.urgent === i) this.urgent = -1;
    const list = this.waiters.get(i);
    this.waiters.delete(i);
    if (list) list.forEach((w) => w.resolve(blob));
    if (!this.keepsAll) return;
    // To the disk while the next one loads; it stays in memory until it is there.
    const write = this.cache.put(this.url(i), new Response(blob, { headers: { 'Content-Type': 'video/mp4' } })).then(() => {
      this.onDisk.add(i);
      if (this.mem.get(i) === blob) { this.mem.delete(i); this.memBytes -= blob.size; }
    }, (e) => {
      if (!this.diskFull) console.info('video: the disk cache is full; keeping segments in memory from here', e);
      this.diskFull = true;
    }).finally(() => this.writes.delete(write));
    this.writes.add(write);
    if (this.writes.size >= WRITES) await Promise.race(this.writes);
  }

  // Segment i, loading it first if need be (it jumps the queue).
  async get(i) {
    let blob = this.mem.get(i);
    if (!blob && this.onDisk.has(i)) {
      const r = await this.cache.match(this.url(i)).catch(() => null);
      if (r) blob = await r.blob();
      else this.onDisk.delete(i); // the browser threw it out
    }
    if (!blob) {
      if (this.failed) throw this.failed;
      blob = await new Promise((resolve, reject) => {
        if (!this.waiters.has(i)) this.waiters.set(i, []);
        this.waiters.get(i).push({ resolve, reject });
        this.urgent = i;
        // Whatever else is loading can wait.
        if (this.job && this.job.i !== i) this.job.stop.abort();
        this.kick();
      });
    }
    return new Uint8Array(await blob.arrayBuffer());
  }
}

// Plays one source into the video element out of its store, from `time` on.
// onFail(err) is called if it breaks (it can't be decoded, or a segment can't
// be had). `first` resolves once there is something to show. detach() lets go
// of the element.
function streamSource(video, store, time, onFail = () => {}) {
  const { manifest, base, n, segSec } = store;
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  let dead = false, failed = false, gotFirst;
  const first = new Promise((done) => { gotFirst = done; });
  const fail = (err) => {
    if (dead || failed) return;
    failed = true;
    onFail(err);
  };
  const onError = () => fail(video.error || new Error('video error'));
  let pump = () => {}, onSeeking = () => {};

  async function setUp() {
    video.addEventListener('error', onError);
    video.src = url;
    await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
    if (dead) return;
    ms.duration = manifest.duration;
    const sb = ms.addSourceBuffer(manifest.mime);
    const appended = () => new Promise((r) => sb.addEventListener('updateend', r, { once: true }));

    sb.appendBuffer(await fetchBytes(base + manifest.init));
    await appended();
    if (dead) return;
    // Taking over part way through: the player waits there for its first segment.
    if (time > 0) video.currentTime = time;

    let next = store.segAt(time), busy = false, begun = false, gen = 0, tight = 1;
    store.moveTo(next);
    // The buffered stretch that holds time t (or starts right after it): its end, or t.
    const endFrom = (t) => {
      for (let i = 0; i < sb.buffered.length; i++) {
        if (t >= sb.buffered.start(i) - 0.3 && t < sb.buffered.end(i)) return sb.buffered.end(i);
      }
      return t;
    };
    pump = async () => {
      if (dead || failed || busy || ms.readyState === 'closed') return;
      busy = true;
      const g = gen;
      try {
        const t = video.currentTime;
        // How far ahead to keep the buffer, and how much to keep behind for
        // "back 10 s": as much as the byte budget lets this source have.
        const rate = store.rate || 16e6;
        const ahead = Math.max(2 * segSec, Math.min(24, SB_AHEAD / rate)) * tight;
        const behind = Math.min(12, Math.max(1, (SB_TOTAL - (ahead + segSec) * rate) / rate - 0.5));
        if (sb.buffered.length && sb.buffered.start(0) < t - behind - 0.5) {
          sb.remove(0, t - behind);
          await appended();
        }
        // The browser may drop buffered video when memory is short: carry on from the playhead then.
        const end = endFrom(t), here = store.segAt(t);
        if (end <= t && next > here && !video.seeking) next = here;
        if (next < n && end - t < ahead) {
          const i = next;
          let bytes;
          try { bytes = await store.get(i); } catch (e) { if (dead || g !== gen) return; throw e; }
          if (dead || g !== gen) return; // let go of, or the viewer skipped while this segment was loading
          try {
            sb.appendBuffer(bytes);
            await appended();
            next = i + 1;
            begun = true;
            store.moveTo(store.segAt(video.currentTime));
            gotFirst();
          } catch (e) {
            if (e.name !== 'QuotaExceededError') throw e;
            tight = Math.max(0.25, tight / 2); // buffer full: keep less, and try this segment again shortly
            busy = false;
            setTimeout(pump, 500);
            return;
          }
        } else if (next >= n) {
          if (ms.readyState === 'open' && !sb.updating) ms.endOfStream();
          return;
        } else {
          return; // enough buffered: the next timeupdate looks again
        }
      } catch (e) {
        fail(e);
        return;
      } finally {
        busy = false;
      }
      setTimeout(pump, 0);
    };
    // A skip to a time that isn't buffered: drop what is, and load from the
    // segment holding the new time.
    onSeeking = async () => {
      const t = video.currentTime;
      if (!begun && Math.abs(t - time) < 0.001) return; // the move to where this source takes over
      for (let i = 0; i < sb.buffered.length; i++) {
        if (t >= sb.buffered.start(i) && t < sb.buffered.end(i) - 0.3) { pump(); return; }
      }
      const g = ++gen;
      store.calm(); // whatever segment was being waited for isn't wanted now
      while (busy || sb.updating) await new Promise((r) => setTimeout(r, 25));
      if (dead || g !== gen) return;
      next = store.segAt(t);
      store.moveTo(next);
      try {
        if (sb.buffered.length) {
          sb.remove(0, Infinity);
          await appended();
        }
      } catch (e) {
        fail(e);
        return;
      }
      pump();
    };
    video.addEventListener('timeupdate', pump);
    video.addEventListener('waiting', pump);
    video.addEventListener('seeking', onSeeking);
    pump();
  }
  setUp().catch(fail);

  function detach() {
    dead = true;
    store.calm();
    video.removeEventListener('error', onError);
    video.removeEventListener('timeupdate', pump);
    video.removeEventListener('waiting', pump);
    video.removeEventListener('seeking', onSeeking);
    if (video.src === url) { video.removeAttribute('src'); video.load(); }
    URL.revokeObjectURL(url);
  }
  return { first, detach };
}

// The sources of one video and which of them plays.
// onSource(source, notes): the source that is about to play ({ base, manifest })
// and why any others were passed over. onSwap(first): a lighter source is
// taking over where the last one was; `first` resolves once it has something to show.
// onDead(): the last source broke, and nothing can play.
class Sources {
  constructor(video, bases, { keepFrom, onSource, onSwap, onDead } = {}) {
    this.video = video;
    this.bases = bases;
    this.keepFrom = keepFrom;
    this.onSource = onSource || (() => {});
    this.onSwap = onSwap || (() => {});
    this.onDead = onDead || (() => {});
    this.notes = [];
    this.sources = [];
    this.stores = [];
    this.cur = -1;        // the source attached to the element, -1: none
    this.stream = null;
    this.loadingAhead = false;
    this.target = -1;     // the source being loaded ahead
    this.started = false; // the attached source has video in the player
    this.rolling = false; // ...and it has started to move
    this.askedAt = 0;     // when it was told to play, while it isn't moving yet
    this.stalls = [];     // when playback stalled lately (seconds)
    this.stallCount = 0;
    this.stallAt = 0;
    this.quietUntil = 0;  // stalls before this don't count (a skip)
    this.timer = 0;

    const v = video;
    v.addEventListener('waiting', () => {
      if (this.cur < 0 || !this.rolling || v.seeking || v.paused || now() < this.quietUntil) return;
      if (!this.stallAt) this.stallAt = now();
    });
    v.addEventListener('playing', () => {
      if (this.cur < 0) return;
      this.rolling = true;
      this.stallEnd();
    });
    v.addEventListener('seeking', () => { this.stallAt = 0; this.quietUntil = now() + 2.5; });
    v.addEventListener('pause', () => { this.stallAt = 0; });
  }

  async init() {
    this.sources = await findSources(this.bases, this.notes);
    if (!this.sources.length) throw new Error(`No playable video in ${this.bases.join(', ')}`);
    this.stores = this.sources.map((s) => new SegmentStore(s, { keepFrom: this.keepFrom }));
    await Promise.all(this.stores.map((s) => s.open()));
  }

  // How fast source i would load on this connection, in playing speeds
  // (1 = exactly as fast as it plays). 0: nothing has been measured yet.
  speed(i) {
    const st = this.stores[i];
    if (!st.rate) return 0;
    // The newest measurement, whichever source it was made on.
    let bps = st.bps, at = bps ? st.measuredAt : -1;
    for (const o of this.stores) {
      if (o !== st && o.bps && o.measuredAt > at) { bps = o.bps; at = o.measuredAt; }
    }
    return bps / st.rate;
  }

  // Seconds of loading source i still needs before it can play from `from`
  // (a segment) to the end without stalling. 0: it can now. Infinity: unknown.
  need(i, from = 0) {
    const st = this.stores[i], D = st.left(from), m = Math.min(D, st.segSec);
    const got = st.run(from);
    if (got >= D - 1e-6) return 0;
    const speed = this.speed(i);
    if (!speed) return got >= m ? 0 : Infinity;
    const eff = SAFETY * speed;
    // Fast enough to stay ahead: only the first segment has to be here.
    // Slower: enough has to be here already that the rest arrives before it is due.
    const want = eff >= 1 ? m : D - eff * (D - m);
    return got >= want ? 0 : (want - got) / speed;
  }

  // Which source to load ahead. Only one that is better than the best already
  // here in full is worth loading. Of those: the best that would be ready to
  // play within LEAD seconds, or else the lightest, which gets there soonest.
  // Once that one is all here, the next better one follows, for the next time.
  plan() {
    if (!this.loadingAhead || this.cur >= 0) return;
    const full = this.stores.findIndex((st) => st.complete);
    let target = -1;
    for (let i = 0; i < (full < 0 ? this.stores.length : full); i++) {
      if (this.stores[i].failed) continue;
      target = i;
      const need = this.need(i);
      // Nothing measured yet: start with the best and find out. The one being
      // loaded gets some slack, so a wavering connection doesn't flip the choice.
      if (need <= LEAD * (i === this.target ? 1.3 : 1) || need === Infinity) break;
    }
    if (target !== this.target) {
      if (target >= 0) console.info(`video: loading ${nameOf(this.sources[target])} ahead`);
      this.target = target;
    }
    this.stores.forEach((st, i) => { if (i === target) st.go(0); else st.rest(); });
  }
  // Start loading ahead (called once the rest of the page has what it needs).
  loadAhead() {
    if (this.loadingAhead) return;
    this.loadingAhead = true;
    this.plan();
    this.tick();
  }
  tick() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.cur < 0) this.plan();
      else this.watch();
    }, 500);
  }

  // The source to play now: the best that can start within START_WAIT seconds
  // and then play through, else the lightest.
  choose() {
    let first = -1, lightest = 0, measured = false;
    for (let i = 0; i < this.stores.length; i++) {
      if (this.stores[i].failed) { this.notes.push(`${nameOf(this.sources[i])} failed`); continue; }
      if (first < 0) first = i;
      lightest = i;
      const need = this.need(i);
      if (need <= START_WAIT) return i;
      if (need !== Infinity) {
        measured = true;
        this.notes.push(`${nameOf(this.sources[i])} too slow`);
      }
    }
    // Nothing is known about the connection: try the best and see (watch()).
    return measured ? lightest : Math.max(0, first);
  }

  // Get ready to play from the start: pick the source and start filling the player.
  prime() {
    if (this.cur >= 0) return;
    this.notes = this.notes.filter((n) => !/too slow|stalled|failed|start/.test(n));
    this.attach(this.choose(), 0);
    this.tick();
  }

  attach(i, time) {
    const st = this.stores[i];
    this.cur = i;
    this.target = -1;
    this.stores.forEach((o) => { if (o !== st) o.rest(); });
    st.go(st.segAt(time));
    this.startedAt = now();
    this.started = this.rolling = false;
    this.askedAt = 0;
    this.stallAt = 0;
    this.stalls = [];
    const stream = this.stream = streamSource(this.video, st, time, (err) => {
      // It broke: not again in this visit, and the next source carries on if there is one.
      console.warn(`video: ${st.base} stopped working`, err);
      if (this.stream !== stream) return;
      st.failed = st.failed || err;
      if (this.stepDown('failed')) return;
      this.release();
      this.onDead(err);
    });
    stream.first.then(() => { if (this.stream === stream) this.started = true; });
    console.info(`video: playing ${st.base} (${st.manifest.mime})`);
    this.onSource(this.sources[i], this.notes);
    return stream;
  }

  // A lighter source takes over where this one is. False if there is none.
  stepDown(why) {
    const from = this.cur, t = this.video.currentTime || 0, lighter = [];
    for (let i = from + 1; i < this.stores.length; i++) if (!this.stores[i].failed) lighter.push(i);
    if (from < 0 || !lighter.length) return false;
    // The next one down. When the connection is the trouble, the first one it
    // can keep up with, so the video isn't interrupted twice.
    let to = lighter[0];
    if (why === 'stalled' || why === 'too slow') {
      to = lighter.find((i) => this.need(i, this.stores[i].segAt(t)) <= START_WAIT) ?? lighter[lighter.length - 1];
    }
    this.notes.push(`${nameOf(this.sources[from])} ${why}`);
    console.info(`video: ${nameOf(this.sources[from])} ${why} at ${t.toFixed(1)} s, going to ${nameOf(this.sources[to])}`);
    this.stream.detach();
    this.onSwap(this.attach(to, t).first);
    return true;
  }

  stallEnd() {
    if (!this.stallAt) return;
    this.stalls.push(now());
    this.stallCount += 1;
    this.stallAt = 0;
  }
  // While a source is attached: is it getting anywhere, and has it stalled too much?
  watch() {
    if (this.cur < 0) return;
    const v = this.video, t = now(), st = this.stores[this.cur];
    if (!this.started) {
      // Nothing in the player yet. If the connection turns out too slow for
      // this source, there is no point in starting it; if nothing is known
      // about the connection, GIVE_UP seconds is all it gets.
      const need = this.need(this.cur, st.at);
      if (need > START_WAIT && (need !== Infinity || t - this.startedAt > GIVE_UP)) this.stepDown('too slow');
      return;
    }
    if (!this.rolling) {
      // It has video and was told to play, and still nothing moves: the decoder isn't coping.
      if (v.paused) this.askedAt = 0;
      else if (!this.askedAt) this.askedAt = t;
      else if (t - this.askedAt > NO_START) this.stepDown("won't start");
      return;
    }
    this.stalls = this.stalls.filter((s) => t - s < STALL_SPAN);
    const long = this.stallAt && t - this.stallAt > STALL_LONG;
    if (long || this.stalls.length >= 2) {
      this.stallEnd();
      this.stepDown('stalled');
    }
  }

  // Let go of the element (the video stopped). Loading stops with it: what
  // comes after the video (Jane, the race) gets the connection and the disk
  // to itself, and a replay loads on from what is here.
  release() {
    if (this.cur < 0) return;
    this.stream.detach();
    this.stream = null;
    this.cur = -1;
    this.stallAt = 0;
    this.loadingAhead = false;
    this.stores.forEach((st) => st.rest());
  }

  // For the ?debug label.
  stats() {
    const v = this.video, i = this.cur >= 0 ? this.cur : this.target;
    const parts = [];
    if (i < 0) {
      const full = this.stores.findIndex((st) => st.complete);
      return full < 0 ? '' : `${nameOf(this.sources[full])} loaded`;
    }
    const st = this.stores[i];
    if (this.cur >= 0) {
      let ahead = 0;
      for (let k = 0; k < v.buffered.length; k++) {
        if (v.currentTime >= v.buffered.start(k) - 0.3 && v.currentTime < v.buffered.end(k)) ahead = v.buffered.end(k) - v.currentTime;
      }
      parts.push(`buf ${ahead.toFixed(1)}s`);
    } else {
      parts.push(`loading ${nameOf(this.sources[i])}`);
    }
    parts.push(`here ${Math.round(st.run(this.cur >= 0 ? st.segAt(v.currentTime) : 0))}s`);
    const bps = st.bps;
    if (bps) parts.push(`net ${Math.round(bps * 8 / 1e6)}M`);
    const q = v.getVideoPlaybackQuality?.();
    if (this.cur >= 0 && q && q.totalVideoFrames) parts.push(`drop ${Math.round(100 * q.droppedVideoFrames / q.totalVideoFrames)}%`);
    parts.push(`stall ${this.stallCount}`);
    return parts.join(' ');
  }
}

export class Video180 {
  // src: source folders, best first (or one video file). edge: degrees the
  // dark surround reaches into the picture. hz: display refresh rate to ask
  // for while it plays (0: leave it, undefined: one that suits the video).
  // keepFrom: sources of at least this many bytes are kept on disk.
  constructor({ renderer, scene, src, edge = 6, hz, keepFrom = DISK_MIN }) {
    this.renderer = renderer;
    this.src = src;
    this.hz = hz;
    this.keepFrom = keepFrom;
    this.layer = null;
    this.playing = false;
    this.onEnded = null;
    this.label = ''; // which source plays ("8K+", "8K", "4K"), from its manifest
    this.note = '';  // the same plus why others were passed over, for ?debug
    this.stats = ''; // how it is shown and how it is loading, for ?debug
    this.fps = 60;
    this.sources = null;
    this.rateBefore = 0;
    this.runId = 0;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('ended', () => this.stop());
    this.video = video;
    this.ready = this.load();

    // Fallback: half sphere, one per eye (camera layers 1 and 2 are the eyes in WebXR).
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const geo = new THREE.SphereGeometry(30, 96, 48, Math.PI, Math.PI); // front half, centred on -Z
    // root sits on the viewer's head (update), so everything on it behaves as
    // if infinitely far away, like the media layer.
    this.root = new THREE.Group();
    this.eyes = [0, 0.5].map((offset, i) => {
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false,
        uniforms: { map: { value: tex }, offset: { value: offset } },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform sampler2D map; uniform float offset; varying vec2 vUv;
          void main() {
            // Seen from inside, u runs right to left; flip it.
            gl_FragColor = texture2D(map, vec2((1.0 - vUv.x) * 0.5 + offset, vUv.y));
            #include <colorspace_fragment>
          }`,
      }));
      mesh.renderOrder = -40;
      mesh.userData.eye = i + 1;
      this.root.add(mesh);
      return mesh;
    });
    // The surround: dark behind the viewer, so the 180° edge reads as a stage
    // and not a hole, and reaching `edge` degrees into the picture with a soft
    // border. It overlaps the picture's rim, so the room can't show through
    // between the two, wherever the head goes.
    const reach = THREE.MathUtils.degToRad(Math.min(30, Math.max(1, edge)));
    const shellGeo = new THREE.SphereGeometry(29, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2 + reach);
    shellGeo.rotateX(Math.PI / 2); // its pole behind the viewer (+Z)
    const SHADE = /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    this.shell = new THREE.Mesh(shellGeo, new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true,
      uniforms: { color: { value: new THREE.Color(0x050607) }, inner: { value: Math.sin(reach) }, outer: { value: Math.sin(reach / 3) } },
      vertexShader: SHADE,
      fragmentShader: /* glsl */`
        uniform vec3 color; uniform float inner; uniform float outer; varying vec3 vDir;
        void main() {
          // Cosine of the angle from straight ahead (-Z): 0 at the picture's rim.
          float c = -normalize(vDir).z;
          gl_FragColor = vec4(color, 1.0 - smoothstep(outer, inner, c));
          #include <colorspace_fragment>
        }`,
    }));
    this.shell.renderOrder = -41;
    this.root.add(this.shell);
    // The curtain: the picture's half, dark until the video has something to
    // show (and again while a lighter source takes over), then it fades away.
    this.curtain = new THREE.Mesh(
      new THREE.SphereGeometry(28.5, 32, 16, Math.PI, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.BackSide, depthWrite: false, transparent: true }),
    );
    this.curtain.renderOrder = -39;
    this.root.add(this.curtain);
    this.curtainUp = true;
    this.root.visible = false;
    scene.add(this.root);
    this.lastT = 0;
    this.statsAt = 0;
  }

  async load() {
    const srcs = [].concat(this.src).filter(Boolean);
    if (srcs.length === 1 && /\.(mp4|webm|mov)$/i.test(srcs[0])) { this.video.src = srcs[0]; return; }
    const sources = new Sources(this.video, srcs, {
      keepFrom: this.keepFrom,
      // Nothing can play (any more): back to the room.
      onDead: () => this.stop(),
      onSource: (source, notes) => {
        this.label = source.manifest.label || '';
        this.fps = source.manifest.fps || 60;
        this.passed = notes;
      },
      // A source broke or stalled and a lighter one is taking over where it
      // was: go dark, and show it on a fresh layer once it has a picture.
      onSwap: (first) => {
        const run = this.runId;
        this.curtainUp = true;
        this.dropLayer();
        first.then(() => {
          if (run !== this.runId || !this.playing) return;
          this.makeLayer();
          this.video.play().catch(() => {});
        });
      },
    });
    await sources.init();
    this.sources = sources;
  }

  // Start loading the video ahead of time (once the page has what it needs to start).
  preload() { this.ready.then(() => this.sources?.loadAhead(), () => {}); }
  // Play was pressed: pick the source and start filling the player.
  prime() { this.sources?.prime(); }

  // Call inside a user gesture (the Enter button) so later play() calls are allowed with sound.
  unlock() {
    if (this.playing) return;
    const v = this.video, p = v.play();
    if (p) p.catch(() => {});
    v.pause();
  }

  makeLayer() {
    const { renderer, video } = this;
    const session = renderer.xr.getSession();
    this.dropLayer();
    if (!(session && window.XRMediaBinding && session.renderState.layers && this.layerPose)) return false;
    try {
      const binding = new XRMediaBinding(session);
      const { p, q } = this.layerPose;
      this.layer = binding.createEquirectLayer(video, {
        space: renderer.xr.getReferenceSpace(),
        layout: 'stereo-left-right',
        transform: new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }),
        radius: 0, // infinitely far, no parallax with head movement
        centralHorizontalAngle: Math.PI,
        upperVerticalAngle: Math.PI / 2,
        lowerVerticalAngle: -Math.PI / 2,
      });
      session.updateRenderState({ layers: [this.layer, ...session.renderState.layers.filter((l) => l !== this.layer)] });
    } catch (e) {
      console.warn('video: no media layer, drawing the video as a texture', e);
      this.layer = null;
    }
    this.eyes.forEach((m) => { m.visible = !this.layer; });
    return !!this.layer;
  }
  dropLayer() {
    const session = this.renderer.xr.getSession();
    if (this.layer && session) {
      try {
        session.updateRenderState({ layers: session.renderState.layers.filter((l) => l !== this.layer) });
        this.layer.destroy?.();
      } catch (e) { console.warn('video:', e); }
    }
    this.layer = null;
  }

  // A 60 fps video steps evenly on a 120 Hz display (two refreshes a frame)
  // and unevenly on 72 or 90, which shows as judder. So while it plays the
  // headset is asked for the lowest refresh rate that is a whole multiple of
  // the video's frame rate, and afterwards for the rate it had.
  setRate(on) {
    const session = this.renderer.xr.getSession();
    if (!session || !session.updateTargetFrameRate || this.hz === 0) return;
    try {
      if (on) {
        const rates = Array.from(session.supportedFrameRates || []);
        const want = this.hz
          || rates.filter((r) => r >= 72 && Math.abs(r / this.fps - Math.round(r / this.fps)) < 0.01).sort((a, b) => a - b)[0];
        if (!want || !rates.some((r) => Math.abs(r - want) < 0.5) || Math.abs((session.frameRate || 0) - want) < 0.5) return;
        if (!this.rateBefore) this.rateBefore = session.frameRate || 0;
        session.updateTargetFrameRate(want).catch(() => {});
      } else if (this.rateBefore) {
        session.updateTargetFrameRate(this.rateBefore).catch(() => {});
        this.rateBefore = 0;
      }
    } catch (e) { console.warn('video:', e); }
  }

  // pose: THREE.Object3D whose world position/rotation is the viewer's head
  // position and forward direction when the video starts.
  // rig: optional parent of the camera; the media layer lives in XR
  // reference space, which moves with it.
  async play(pose, rig = null) {
    await this.ready;
    const { video } = this;
    const run = ++this.runId;
    this.playing = true;
    this.prime();
    pose.updateMatrixWorld(true);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    pose.matrixWorld.decompose(pos, quat, new THREE.Vector3());
    const m = pose.matrixWorld.clone();
    if (rig) m.premultiply(rig.matrixWorld.clone().invert());
    this.layerPose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    m.decompose(this.layerPose.p, this.layerPose.q, new THREE.Vector3());

    // Dark all round until there is a picture.
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    this.curtainUp = true;
    this.curtain.material.opacity = 1;
    this.curtain.visible = true;
    this.eyes.forEach((e) => { e.visible = true; });
    this.root.visible = true;
    this.setRate(true);

    // The layer needs the video to know its size first.
    if (video.readyState < 1) {
      await new Promise((done) => {
        const go = () => { video.removeEventListener('loadedmetadata', go); clearTimeout(timer); done(); };
        const timer = setTimeout(go, 8000);
        video.addEventListener('loadedmetadata', go);
      });
    }
    if (run !== this.runId || !this.playing) return;
    this.makeLayer();
    // A lighter source taking over (or a pause) cuts this short, which is no failure.
    await video.play().catch((e) => { if (e.name !== 'AbortError') throw e; });
  }

  get paused() { return this.video.paused; }
  // Playing, with no picture to show yet (loading, or a lighter source is taking over).
  get waiting() { return this.playing && this.curtainUp; }
  get currentTime() { return this.video.currentTime || 0; }
  get duration() { return Number.isFinite(this.video.duration) ? this.video.duration : 0; }
  togglePause() {
    if (!this.playing) return;
    if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }
  seekBy(seconds) {
    if (!this.playing) return;
    const v = this.video;
    v.currentTime = Math.min(Math.max(0, this.duration - 0.5), Math.max(0, v.currentTime + seconds));
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.runId += 1;
    this.video.pause();
    this.dropLayer();
    this.setRate(false);
    // Let go of the decoder (an 8K one holds a lot of memory). What was
    // loaded stays, for a replay and for the next visit.
    if (this.sources) this.sources.release();
    else this.video.currentTime = 0;
    this.root.visible = false;
    this.onEnded?.();
  }

  // Each frame. head: the viewer's head (camera) object.
  update(head) {
    const xr = this.renderer.xr.isPresenting;
    this.eyes.forEach((m, i) => {
      if (xr) m.layers.set(m.userData.eye);
      else m.layers.set(i === 0 ? 0 : 3); // flat preview: left eye only
    });
    const t = now(), dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    if (this.root.visible) {
      if (head) this.root.position.setFromMatrixPosition(head.matrixWorld);
      // The curtain lifts once the video is moving.
      const v = this.video;
      if (this.curtainUp && this.playing && !v.paused && !v.seeking && v.readyState >= 3 && v.currentTime > 0.03) this.curtainUp = false;
      const mat = this.curtain.material;
      mat.opacity = Math.min(1, Math.max(0, mat.opacity + (this.curtainUp ? 6 : -2.5) * dt));
      this.curtain.visible = mat.opacity > 0.002;
    }
    if (t - this.statsAt > 0.5) {
      this.statsAt = t;
      const passed = this.passed && this.passed.length ? ` (${this.passed.join(', ')})` : '';
      this.note = this.sources && this.label ? `${this.label}${passed}` : '';
      // How it is shown (media layer or texture) and at what refresh rate, then how it is loading.
      const hz = this.renderer.xr.getSession()?.frameRate;
      const how = this.playing ? `${this.layer ? 'layer' : 'texture'}${hz ? ` ${Math.round(hz)}Hz` : ''} ` : '';
      this.stats = this.sources ? how + this.sources.stats() : '';
    }
  }
}
