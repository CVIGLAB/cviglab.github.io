/* ============================================================
   cloud3d.js — morphing point-cloud figure for the CVIG Lab site
   (point-cloud completion, denoising via optimal transport,
   neural rendering).

   ~10k points cycle through four shapes, each sampled from a surface:
     1. a noisy, partial single-view scan of a vase (jitter, scan-line
        banding, outliers, the far side and a hole missing)
     2. the denoised, completed vase (procedural lathe surface)
     3. a (2,3) torus knot
     4. a sphere
   Points are matched between shapes by an approximate transport plan
   (sort into height bands, then by angle within each band), so every
   morph reads as a coherent flow rather than a scramble. Morphs are a
   per-point eased lerp with a bottom-to-top stagger.

   Expected markup:

     <link rel="stylesheet" href="/assets/css/cloud3d.css">
     ...
     <figure class="cloud3d" data-label="Animated point cloud morphing from a noisy partial scan to complete shapes">
       <div class="cloud3d__stage"></div>
       <figcaption><span class="cloud3d__state">Noisy partial scan</span></figcaption>
     </figure>
     <script type="module" src="/assets/js/cloud3d.js"></script>

   Behaviour
   - Mounts into every figure.cloud3d that has a .cloud3d__stage.
   - Canvas is transparent (sits on the page), role="img", aria-label
     from the figure's data-label.
   - The figure's data-stage attribute tracks the current shape
     ("scan" | "surface" | "knot" | "sphere"); the text of an optional
     .cloud3d__state span is updated to describe it.
   - Pointer movement over the stage tilts the cloud slightly toward
     the cursor.
   - Colours come from --bg / --ink / --accent / --muted on :root and
     are re-read on prefers-color-scheme changes and <html data-theme>.
   - Pauses offscreen (IntersectionObserver) and in hidden tabs.
   - prefers-reduced-motion: static render of the completed surface,
     no morph loop, no rotation.
   - No WebGL / CDN failure: the figure gets .is-fallback.
   ============================================================ */

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const N_POINTS = 12000;
const MORPH_SECONDS = 2.6;
const STAGGER = 0.38;              // fraction of the morph used for the sweep
const SPIN_SPEED = 0.16;           // rad / s
const BASE_TILT = 0.22;            // look slightly down onto the cloud
const MAX_TILT = 0.28;             // pointer parallax, rad

const STAGES = [
  { key: "scan",    hold: 2.0, label: "Noisy partial scan",
    to: "Noisy partial scan → completed surface" },
  { key: "surface", hold: 3.0, label: "Denoised, completed surface",
    to: "Transporting points → torus knot" },
  { key: "knot",    hold: 2.6, label: "Torus knot",
    to: "Transporting points → sphere" },
  { key: "sphere",  hold: 2.2, label: "Sphere",
    to: "Re-scanning → noisy partial scan" },
];

const figures = [...document.querySelectorAll("figure.cloud3d")]
  .filter((f) => f.querySelector(".cloud3d__stage"));

if (figures.length) boot();

async function boot() {
  let THREE;
  try {
    if (!webglAvailable()) throw new Error("WebGL unavailable");
    THREE = await import(THREE_URL);
  } catch (err) {
    figures.forEach(fallback);
    console.warn("[cloud3d] falling back:", err);
    return;
  }
  const shapes = buildShapes(N_POINTS);
  for (const fig of figures) {
    try { mount(THREE, fig, shapes); }
    catch (err) { fallback(fig); console.warn("[cloud3d]", err); }
  }
}

function fallback(fig) {
  fig.classList.remove("is-live");
  fig.classList.add("is-fallback");
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) { return false; }
}

/* ================================================================
   Shape sampling
   Each shape: { pos: Float32Array(4N) xyz+visibility, nor: Float32Array(3N) }
   ================================================================ */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function buildShapes(n) {
  const rand = mulberry32(20240917);
  const surface = transportOrder(vase(n, rand));
  const scan = scanOf(surface, rand);
  const knot = transportOrder(torusKnot(n, rand));
  const sphere = transportOrder(fibonacciSphere(n, rand));
  return [scan, surface, knot, sphere];
}

/* Lathe "vase": y in [-1, 1], radius profile r(y), plus a closed base. */
function vase(n, rand) {
  const r = (y) => 0.2 + 0.4 * Math.exp(-(((y + 0.25) / 0.5) ** 2)) + 0.16 * smoothstep(0.55, 1.0, y);
  const dr = (y) => (r(y + 1e-3) - r(y - 1e-3)) / 2e-3;

  // area-weighted CDF over y for the lateral surface
  const BINS = 512;
  const cdf = new Float64Array(BINS + 1);
  for (let i = 0; i < BINS; i++) {
    const y = -1 + (2 * (i + 0.5)) / BINS;
    cdf[i + 1] = cdf[i] + r(y) * Math.sqrt(1 + dr(y) ** 2);
  }
  const lateral = cdf[BINS];
  const rb = r(-1);
  const baseArea = (rb * rb) / 2; // pi r^2 vs 2 pi * integral(r ds): divide both by 2 pi
  const nBase = Math.round((n * baseArea) / (lateral * (2 / BINS) + baseArea));

  const pos = new Float32Array(n * 4);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z, nx, ny, nz;
    if (i < nBase) {
      const rr = rb * Math.sqrt(rand());
      const th = rand() * Math.PI * 2;
      x = rr * Math.cos(th); y = -1; z = rr * Math.sin(th);
      nx = 0; ny = -1; nz = 0;
    } else {
      // invert CDF
      const u = rand() * lateral;
      let lo = 0, hi = BINS;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m; else hi = m; }
      const f = (u - cdf[lo]) / Math.max(1e-9, cdf[lo + 1] - cdf[lo]);
      y = -1 + (2 * (lo + f)) / BINS;
      const th = rand() * Math.PI * 2;
      const ry = r(y);
      x = ry * Math.cos(th); z = ry * Math.sin(th);
      nx = Math.cos(th); ny = -dr(y); nz = Math.sin(th);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    }
    pos.set([x, y * 0.95, z, 1], i * 4);
    nor.set([nx, ny, nz], i * 3);
  }
  return { pos, nor };
}

/* A single-view scan of a surface: visible from one direction only,
   with depth noise, scan-line banding, outliers and a missing patch.
   Point i of the scan corresponds to point i of the surface. */
function scanOf(surface, rand) {
  const n = surface.nor.length / 3;
  const pos = new Float32Array(n * 4);
  const nor = surface.nor.slice();
  const S = norm3([0.35, 0.25, 1]);            // scanner direction
  const H = [0.38, 0.32, 0.5];                 // centre of the hole (near the front surface)
  for (let i = 0; i < n; i++) {
    let x = surface.pos[i * 4], y = surface.pos[i * 4 + 1], z = surface.pos[i * 4 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    const facing = nx * S[0] + ny * S[1] + nz * S[2];
    let vis = 1;
    if (facing < 0.05) vis = rand() < smoothstep(0.05, -0.35, facing) ? 0 : 1;
    if (Math.hypot(x - H[0], y - H[1], z - H[2]) < 0.34) vis = 0;
    if (vis === 0) {
      // hidden points wait just outside the surface and fade in on completion
      x *= 1.18; y *= 1.06; z *= 1.18;
    } else if (rand() < 0.02) {
      // outliers
      x += gauss(rand) * 0.18; y += gauss(rand) * 0.18; z += gauss(rand) * 0.18;
    } else {
      // depth noise along the scanner ray + small isotropic jitter
      const d = gauss(rand) * 0.045;
      x += S[0] * d + gauss(rand) * 0.012;
      y += S[1] * d + gauss(rand) * 0.012;
      z += S[2] * d + gauss(rand) * 0.012;
      // scan-line banding
      const q = Math.round(y / 0.055) * 0.055;
      y += (q - y) * 0.7;
    }
    pos.set([x, y, z, vis], i * 4);
  }
  return { pos, nor };
}

/* (2,3) torus knot tube, sampled uniformly along arc length. */
function torusKnot(n, rand) {
  const P = 2, Q = 3, R = 0.62, TUBE = 0.17;
  const curve = (u) => {
    const qu = (Q / P) * u, cs = Math.cos(qu);
    return [R * (2 + cs) * 0.5 * Math.cos(u), R * (2 + cs) * 0.5 * Math.sin(u), R * Math.sin(qu) * 0.5];
  };
  const U = Math.PI * 2 * P;
  const BINS = 2048;
  const cdf = new Float64Array(BINS + 1);
  let prev = curve(0);
  for (let i = 1; i <= BINS; i++) {
    const c = curve((U * i) / BINS);
    cdf[i] = cdf[i - 1] + Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]);
    prev = c;
  }
  const total = cdf[BINS];
  const pos = new Float32Array(n * 4);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = rand() * total;
    let lo = 0, hi = BINS;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] < s) lo = m; else hi = m; }
    const u = (U * (lo + (s - cdf[lo]) / Math.max(1e-9, cdf[lo + 1] - cdf[lo]))) / BINS;
    // frame as in THREE.TorusKnotGeometry
    const p1 = curve(u), p2 = curve(u + 0.01);
    const T = sub3(p2, p1), Nn = add3(p2, p1);
    const B = norm3(cross3(T, Nn));
    const N2 = norm3(cross3(B, T));
    const v = rand() * Math.PI * 2;
    const cx = Math.cos(v), sy = Math.sin(v);
    const nrm = [cx * N2[0] + sy * B[0], cx * N2[1] + sy * B[1], cx * N2[2] + sy * B[2]];
    pos.set([p1[0] + TUBE * nrm[0], p1[1] + TUBE * nrm[1], p1[2] + TUBE * nrm[2], 1], i * 4);
    nor.set(nrm, i * 3);
  }
  return { pos, nor };
}

function fibonacciSphere(n, rand) {
  const RAD = 0.86, GA = Math.PI * (3 - Math.sqrt(5));
  const pos = new Float32Array(n * 4);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y), th = GA * i + (rand() - 0.5) * 0.35;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    pos.set([x * RAD, y * RAD, z * RAD, 1], i * 4);
    nor.set([x, y, z], i * 3);
  }
  return { pos, nor };
}

/* Approximate transport plan: order points into ~sqrt(N) height bands,
   then by azimuth inside each band. Index i in one shape is then
   matched with index i in another. */
function transportOrder(shape) {
  const n = shape.nor.length / 3;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => shape.pos[a * 4 + 1] - shape.pos[b * 4 + 1]);
  const band = Math.max(1, Math.round(Math.sqrt(n)));
  const az = (i) => Math.atan2(shape.pos[i * 4 + 2], shape.pos[i * 4]);
  for (let s = 0; s < n; s += band) {
    const slice = idx.slice(s, s + band).sort((a, b) => az(a) - az(b));
    for (let k = 0; k < slice.length; k++) idx[s + k] = slice[k];
  }
  const pos = new Float32Array(n * 4);
  const nor = new Float32Array(n * 3);
  idx.forEach((src, dst) => {
    pos.set(shape.pos.subarray(src * 4, src * 4 + 4), dst * 4);
    nor.set(shape.nor.subarray(src * 3, src * 3 + 3), dst * 3);
  });
  return { pos, nor };
}

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/* ================================================================
   Shaders
   ================================================================ */

const VERT = /* glsl */ `
  attribute vec4 aFrom;
  attribute vec4 aTo;
  attribute vec3 aNFrom;
  attribute vec3 aNTo;
  attribute vec4 aRand;   // x: stagger delay, y: arc amount, z: size jitter

  uniform float uT;
  uniform float uStagger;
  uniform float uSize;
  uniform float uScale;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uBg;
  uniform vec2 uFog;      // view-space depth range for fading toward the background

  varying vec3 vCol;
  varying float vAlpha;

  float easeInOut(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
  }

  void main() {
    float t = clamp((uT - aRand.x * uStagger) / (1.0 - uStagger), 0.0, 1.0);
    t = easeInOut(t);

    vec3 nrm = normalize(mix(aNFrom, aNTo, t) + vec3(1e-4));
    vec3 p = mix(aFrom.xyz, aTo.xyz, t);
    p += nrm * sin(3.14159265 * t) * 0.14 * aRand.y;   // slight outward arc in flight
    float vis = mix(aFrom.w, aTo.w, t);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vis < 0.01 ? 0.0 : uSize * aRand.z * uScale / -mv.z;

    vec3 n = normalize(normalMatrix * nrm);
    vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
    float diff = dot(n, L) * 0.5 + 0.5;   // half-Lambert: back points stay mid-tone
    float rim = 1.0 - abs(n.z);

    float h = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uLow, uHigh, smoothstep(0.0, 1.0, h));
    float fog = smoothstep(uFog.x, uFog.y, -mv.z);
    float strength = (0.48 + 0.45 * diff + 0.07 * rim) * (1.0 - 0.3 * fog);
    vCol = mix(uBg, col, strength);
    vAlpha = vis * (0.9 - 0.3 * fog);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float a = 1.0 - smoothstep(0.55, 1.0, r2);
    gl_FragColor = vec4(vCol, a * vAlpha);
  }
`;

/* ================================================================
   Mount
   ================================================================ */

function mount(THREE, fig, shapes) {
  const stage = fig.querySelector(".cloud3d__stage");
  const stateEl = fig.querySelector(".cloud3d__state");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const n = shapes[0].nor.length / 3;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", fig.dataset.label || "Animated 3D point cloud");

  const scene = new THREE.Scene();
  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 50);

  /* geometry: from / to buffers are rewritten at the start of each morph */
  const geo = new THREE.BufferGeometry();
  const aFrom = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
  const aTo = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
  const aNFrom = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  const aNTo = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  [aFrom, aTo, aNFrom, aNTo].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
  const rnd = mulberry32(7);
  const aRand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // points are ordered bottom-to-top, so index drives a sweeping stagger
    aRand[i * 4] = 0.78 * (i / n) + 0.22 * rnd();
    aRand[i * 4 + 1] = 0.4 + 0.6 * rnd();
    aRand[i * 4 + 2] = 0.75 + 0.5 * rnd();
    aRand[i * 4 + 3] = rnd();
  }
  geo.setAttribute("position", aTo);         // for bounding volumes only
  geo.setAttribute("aFrom", aFrom);
  geo.setAttribute("aTo", aTo);
  geo.setAttribute("aNFrom", aNFrom);
  geo.setAttribute("aNTo", aNTo);
  geo.setAttribute("aRand", new THREE.BufferAttribute(aRand, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);

  const uniforms = {
    uT: { value: 1 },
    uStagger: { value: STAGGER },
    uSize: { value: 0.024 },
    uScale: { value: 600 },
    uLow: { value: new THREE.Vector3() },
    uHigh: { value: new THREE.Vector3() },
    uBg: { value: new THREE.Vector3() },
    uFog: { value: new THREE.Vector2(3.5, 6) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const spin = new THREE.Group();     // continuous orbit
  const tilt = new THREE.Group();     // base tilt + pointer parallax
  spin.add(points);
  tilt.add(spin);
  scene.add(tilt);
  spin.rotation.y = -0.5;

  /* ---------- stage state machine ---------- */
  let cur = 0, phase = "hold", timer = 0;

  function setShape(from, to) {
    aFrom.array.set(shapes[from].pos); aNFrom.array.set(shapes[from].nor);
    aTo.array.set(shapes[to].pos);     aNTo.array.set(shapes[to].nor);
    [aFrom, aTo, aNFrom, aNTo].forEach((a) => { a.needsUpdate = true; });
  }
  function announce(text, key) {
    fig.dataset.stage = key;
    if (stateEl && stateEl.textContent !== text) stateEl.textContent = text;
  }
  function showStatic(i) {
    cur = i; phase = "hold"; timer = 0;
    setShape(i, i);
    uniforms.uT.value = 1;
    announce(STAGES[i].label, STAGES[i].key);
  }

  function advance(dt) {
    timer += dt;
    if (phase === "hold") {
      if (timer >= STAGES[cur].hold) {
        const next = (cur + 1) % STAGES.length;
        setShape(cur, next);
        uniforms.uT.value = 0;
        phase = "morph"; timer = 0;
        announce(STAGES[cur].to, STAGES[cur].key + "-" + STAGES[next].key);
      }
    } else {
      uniforms.uT.value = Math.min(1, timer / MORPH_SECONDS);
      if (timer >= MORPH_SECONDS) {
        cur = (cur + 1) % STAGES.length;
        phase = "hold"; timer = 0;
        uniforms.uT.value = 1;
        announce(STAGES[cur].label, STAGES[cur].key);
      }
    }
  }

  /* ---------- colours ---------- */
  const css = (name, fb) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
  const srgb = (s) => {
    const c = new THREE.Color();
    try { c.setStyle(s); } catch (e) { /* keep black */ }
    return c.convertLinearToSRGB();
  };
  function applyTheme() {
    const bg = srgb(css("--bg", "#fafaf9"));
    const ink = srgb(css("--ink", "#111827"));
    const accent = srgb(css("--accent", "#1d4ed8"));
    const muted = srgb(css("--muted", "#6b7280"));
    // low: accent pulled toward ink (navy / pale blue); high: slate
    const low = accent.clone().lerp(ink, 0.45);
    const high = muted.clone().lerp(ink, 0.3);
    uniforms.uLow.value.set(low.r, low.g, low.b);
    uniforms.uHigh.value.set(high.r, high.g, high.b);
    uniforms.uBg.value.set(bg.r, bg.g, bg.b);
    requestRender();
  }

  /* ---------- sizing ---------- */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // fit a ~2.3 x 2.3 unit box regardless of aspect
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fitH = 1.2 / tanHalf;
    const fitW = 1.2 / (tanHalf * camera.aspect);
    const dist = Math.max(fitH, fitW) + 0.6;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * tanHalf);
    uniforms.uFog.value.set(dist - 1.0, dist + 1.4);
    requestRender();
  }

  /* ---------- pointer parallax ---------- */
  const target = { x: 0, y: 0 };
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  stage.addEventListener("pointerleave", () => { target.x = 0; target.y = 0; });

  /* ---------- loop ---------- */
  let visible = true, last = 0, running = false;

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!reduceMotion.matches) {
      advance(dt);
      spin.rotation.y += dt * SPIN_SPEED;
      const k = 1 - Math.exp(-dt * 3);
      tilt.rotation.x += (BASE_TILT + target.y * MAX_TILT - tilt.rotation.x) * k;
      tilt.rotation.y += (target.x * MAX_TILT - tilt.rotation.y) * k;
    }
    renderer.render(scene, camera);
  }

  function update() {
    const shouldRun = visible && !document.hidden && !reduceMotion.matches;
    if (shouldRun === running) return;
    running = shouldRun;
    last = 0;
    renderer.setAnimationLoop(running ? frame : null);
  }

  function requestRender() {
    if (!running) renderer.render(scene, camera);
  }

  function applyMotionPref() {
    if (reduceMotion.matches) {
      showStatic(1);
      tilt.rotation.set(BASE_TILT, 0, 0);
    }
    update();
    requestRender();
  }

  /* ---------- wire up ---------- */
  stage.appendChild(canvas);
  showStatic(0);
  applyTheme();
  resize();
  applyMotionPref();
  tilt.rotation.x = BASE_TILT;

  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    update();
  }, { rootMargin: "80px" }).observe(stage);
  document.addEventListener("visibilitychange", update);
  reduceMotion.addEventListener("change", applyMotionPref);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });

  fig.classList.add("is-live");
  requestRender();
}
