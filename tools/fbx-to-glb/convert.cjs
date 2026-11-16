// Converts Ilia's seagull and bill FBX files into the GLBs the opening loads
// (assets/seagull/seagull.glb and bill.glb), with three.js's own FBXLoader and
// GLTFExporter running in headless Chromium (Playwright).
//
//   npm pack three@0.186.0 && mkdir three && tar xzf three-0.186.0.tgz -C three
//   node tools/fbx-to-glb/convert.cjs three/package SK_Mesh_Seagull.FBX \
//        Anim_Seagull_Fly.FBX Bill_03_Gentle_Twist.FBX assets/seagull
//
// What it does to the seagull:
// - drops the FBX's all-black vertex colours and paints it as a herring gull
//   (gull-paint.js) until the T_Seagull*.png textures are added;
// - welds the unindexed triangles (22k vertices down to 4.7k);
// - keeps one clean 0.4 s wing beat ("fly", frames 0-12) with the pelvis's
//   forward travel (0.8 m per beat) taken out, plus a wings-level "glide" pose;
// - scales centimetres to metres and centres the flying body on the origin.
// The bill gets planar UVs (front reads left to right, back mirrored) for the
// drawn $100 face, and its UCX_ collision hull is left out.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [threeDir, meshFbx, animFbx, billFbx, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node convert.cjs <three package dir> <mesh.fbx> <anim.fbx> <bill.fbx> <out dir>');
  process.exit(1);
}
const paint = fs.readFileSync(path.join(__dirname, 'gull-paint.js'), 'utf8');

const PAGE = /* html */`<!doctype html><html><body>
<script type="importmap">{"imports":{"three":"http://tool.local/three/build/three.module.js","three/addons/":"http://tool.local/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
const loader = new FBXLoader();
const exporter = new GLTFExporter();
const toB64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const exportGlb = (obj, animations) => new Promise((res, rej) => exporter.parse(obj, (r) => res(toB64(r)), rej, { binary: true, animations, onlyVisible: false }));
const out = {};
try {
  // ---- seagull ----
  const gull = await loader.loadAsync('http://tool.local/in/mesh.fbx');
  const anim = await loader.loadAsync('http://tool.local/in/anim.fbx');
  gull.name = 'Seagull';
  const mesh = gull.getObjectByProperty('type', 'SkinnedMesh');
  const g = mesh.geometry;
  g.deleteAttribute('color');
  {
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
    const paint = new Function('x', 'y', 'z', 'mat', 'bone', 'nx', 'ny', 'nz', await (await fetch('http://tool.local/paint.js')).text());
    const matOf = new Int32Array(n);
    for (const gr of g.groups) for (let i = gr.start; i < gr.start + gr.count; i++) matOf[i] = gr.materialIndex;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, nrm = g.attributes.normal;
    const names = mesh.skeleton.bones.map((b) => b.name.replace('Seagull_', '').replace('_bone', '').replace('(mirrored)', ''));
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      col.set(paint(p.getX(i), p.getY(i), p.getZ(i), matOf[i], names[best], nrm.getX(i), nrm.getY(i), nrm.getZ(i)), i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  mesh.material = [].concat(mesh.material).map((m) => new THREE.MeshStandardMaterial({
    name: m.name, color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true,
    side: m.name === 'M_SeagullFeathers' ? THREE.DoubleSide : THREE.FrontSide,
  }));
  mesh.geometry = mergeVertices(g, 1e-4);
  out.vertices = [g.attributes.position.count, mesh.geometry.attributes.position.count];
  gull.scale.setScalar(0.01); // centimetres -> metres
  const fly = THREE.AnimationUtils.subclip(anim.animations[0], 'fly', 0, 13, 30);
  {
    // Source axes are Z up: the forward travel is along -Y; the bob along Z stays.
    const tr = fly.tracks.find((t) => t.name === 'Seagull_Pelvis_bone.position');
    const v = tr.values, n = tr.times.length;
    out.travel = v[(n - 1) * 3 + 1] - v[1];
    for (let i = 0; i < n; i++) v[i * 3 + 1] = v[1];
  }
  const glide = THREE.AnimationUtils.subclip(fly, 'glide', 4, 5, 30);
  const wrap = new THREE.Group();
  wrap.name = 'SeagullRoot';
  wrap.add(gull);
  {
    const mixer = new THREE.AnimationMixer(wrap);
    mixer.clipAction(fly).play();
    const c = new THREE.Vector3(), b = new THREE.Box3();
    for (let f = 0; f < 12; f++) { mixer.setTime(f / 30); wrap.updateMatrixWorld(true); c.add(b.setFromObject(wrap, true).getCenter(new THREE.Vector3())); }
    c.divideScalar(12);
    mixer.stopAllAction(); mixer.uncacheRoot(wrap);
    gull.position.sub(c);
    out.centre = c.toArray();
  }
  out.gull = await exportGlb(wrap, [fly, glide]);

  // ---- bill ----
  const billFbx = await loader.loadAsync('http://tool.local/in/bill.fbx');
  let bm = null;
  billFbx.traverse((o) => { if (o.isMesh && !o.name.startsWith('UCX_') && !bm) bm = o; });
  const bg = bm.geometry.clone();
  bg.computeBoundingBox();
  const bb = bg.boundingBox, bp = bg.attributes.position, bn = bg.attributes.normal;
  const uv = new Float32Array(bp.count * 2);
  for (let i = 0; i < bp.count; i++) {
    let u = (bp.getX(i) - bb.min.x) / (bb.max.x - bb.min.x);
    if (bn.getZ(i) < 0) u = 1 - u;
    uv[i * 2] = u; uv[i * 2 + 1] = (bp.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
  }
  bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const billMesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ name: 'Bill_Paper', color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }));
  billMesh.name = 'Bill';
  out.billSize = bb.getSize(new THREE.Vector3()).toArray();
  out.bill = await exportGlb(billMesh, []);
} catch (err) {
  out.error = String(err && err.stack || err);
}
window.__out = out;
</script></body></html>`;

(async () => {
  const files = { '/in/mesh.fbx': meshFbx, '/in/anim.fbx': animFbx, '/in/bill.fbx': billFbx };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('http://tool.local/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/page.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
    if (p === '/paint.js') return route.fulfill({ body: paint, contentType: 'text/plain' });
    if (files[p]) return route.fulfill({ body: fs.readFileSync(files[p]), contentType: 'application/octet-stream' });
    if (p.startsWith('/three/')) {
      const f = path.join(threeDir, p.slice('/three/'.length));
      if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' });
    }
    return route.fulfill({ status: 404, body: '' }); // the FBX's texture paths point at Ilia's disk
  });
  await page.goto('http://tool.local/page.html');
  await page.waitForFunction(() => window.__out, null, { timeout: 120000 });
  const out = await page.evaluate(() => window.__out);
  await browser.close();
  if (out.error) throw new Error(out.error);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'seagull.glb'), Buffer.from(out.gull, 'base64'));
  fs.writeFileSync(path.join(outDir, 'bill.glb'), Buffer.from(out.bill, 'base64'));
  console.log(`seagull.glb: ${out.vertices[0]} -> ${out.vertices[1]} vertices, root travel ${out.travel.toFixed(1)} cm removed, centre ${out.centre.map((x) => x.toFixed(3))}`);
  console.log(`bill.glb: ${out.billSize.map((x) => x.toFixed(1)).join(' x ')} units`);
})().catch((err) => { console.error(err.message || err); process.exit(1); });
