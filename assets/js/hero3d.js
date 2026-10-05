/* ============================================================
   hero3d.js — interactive "CVIG letters + shadows + moving light"
   figure for the CVIG Lab site (shadow art, photometric stereo /
   relighting).

   Bevelled, extruded 3D letters "CVIG" stand on the floor of a small
   photo-studio cove (floor that curves up into a back wall), lit by a
   single spot light that slowly orbits them, so their soft shadows
   sweep across floor and wall. The viewer can take over the light
   (mouse hover/drag, touch tap/drag, or arrow keys when the canvas is
   focused); when the pointer leaves, the light eases back into its
   orbit. A ColorChecker-style 6x4 chart lies on the floor as the lab's
   calibration-chart motif.

   Expected markup:

     <link rel="stylesheet" href="assets/css/hero3d.css">
     ...
     <figure class="hero3d" data-label="Interactive render: 3D letters CVIG casting shadows under a moving light">
       <div class="hero3d__stage"><img class="hero3d__fallback" src="assets/teasers/knots.jpg" alt=""></div>
       <figcaption>Drag to move the light. …</figcaption>
     </figure>
     <script type="module" src="assets/js/hero3d.js"></script>

   Behaviour
   - The <img class="hero3d__fallback"> is shown until the canvas is live
     (figure gets .is-live), and again if WebGL / Three.js is unavailable
     (figure gets .is-fallback). Wrap caption text that only makes sense
     interactively in <span class="hero3d__hint"> to hide it on fallback.
   - Canvas gets role="img" + aria-label from the figure's data-label.
   - Colours come from the CSS custom properties in style.css and are
     re-read on prefers-color-scheme changes and on <html data-theme>.
   - Rendering pauses offscreen (IntersectionObserver) and in hidden tabs;
     with prefers-reduced-motion the light does not orbit (it rests at a
     3/4 angle) and frames are only drawn on interaction / resize /
     theme change.
   - Three.js and the typeface JSON are loaded dynamically so that a CDN
     failure can be caught and turned into the static fallback. The
     typeface outlines are turned into shapes here (a small port of
     three's FontLoader/TextGeometry, which import 'three' by bare
     specifier and so can't be loaded without an import map); this also
     guarantees a single copy of Three.js.
   ============================================================ */

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const FONT_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/fonts/helvetiker_bold.typeface.json";
const WORD = "CVIG";

// ColorChecker Classic sRGB patch values (same as the .checker motif in style.css)
const CHECKER = [
  "#735244", "#c29682", "#627a9d", "#576c43", "#8580b1", "#67bdaa",
  "#d67e2c", "#505ba6", "#c15a63", "#5e3c6c", "#9dbc40", "#e0a32e",
  "#383d96", "#469449", "#af363c", "#e7c71f", "#bb5695", "#0885a1",
  "#f3f3f2", "#c8c8c8", "#a0a0a0", "#7a7a79", "#555555", "#343434",
];

const figures = [...document.querySelectorAll("figure.hero3d")]
  .filter((f) => f.querySelector(".hero3d__stage"));

if (figures.length) boot();

async function boot() {
  let THREE, font;
  try {
    if (!webglAvailable()) throw new Error("WebGL unavailable");
    [THREE, font] = await Promise.all([
      import(THREE_URL),
      fetch(FONT_URL).then((r) => {
        if (!r.ok) throw new Error("font HTTP " + r.status);
        return r.json();
      }),
    ]);
    if (!font || !font.glyphs || !font.resolution) throw new Error("bad typeface data");
  } catch (err) {
    figures.forEach(fallback);
    console.warn("[hero3d] falling back to static image:", err);
    return;
  }
  for (const fig of figures) {
    try { mount(THREE, font, fig); }
    catch (err) { fallback(fig); console.warn("[hero3d]", err); }
  }
}

function fallback(fig) {
  fig.classList.remove("is-live");
  fig.classList.add("is-fallback");
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch (e) { return false; }
}

/* ---------------------------------------------------------------- */

function mount(THREE, font, fig) {
  const stage = fig.querySelector(".hero3d__stage");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* renderer + canvas */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", fig.dataset.label || "Interactive 3D render with a movable light");
  canvas.tabIndex = 0;

  /* scene + camera */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.1, 50);
  camera.position.set(0, 1.9, 7.2);
  camera.lookAt(0, 0.82, -0.4);

  /* studio cove: floor curving up into a back wall, one surface */
  const cove = new THREE.Mesh(coveGeometry(THREE), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
  cove.receiveShadow = true;
  scene.add(cove);

  /* calibration chart on the floor */
  const chart = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 0.66),
    new THREE.MeshStandardMaterial({ map: checkerTexture(THREE), roughness: 1, metalness: 0, transparent: true }),
  );
  chart.rotation.set(-Math.PI / 2, 0, 0.32);
  chart.position.set(1.72, 0.004, 1.15);
  chart.receiveShadow = true;
  scene.add(chart);

  /* the letters: bevelled, extruded "CVIG" standing on the floor */
  const LETTER_W = 3.7;                 // world width of the word (~65% of the frame)
  const LETTERS_Z = -0.35;              // centre depth, just in front of the cove
  const letterMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
  const letters = new THREE.Mesh(letterGeometry(THREE, font, WORD), letterMat);
  letters.scale.setScalar(LETTER_W / letters.geometry.userData.width);
  letters.position.set(0, 0, LETTERS_Z);
  letters.castShadow = true;
  letters.receiveShadow = true;
  scene.add(letters);
  const LETTER_H = letters.geometry.userData.height * letters.scale.y;

  /* lights */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const spot = new THREE.SpotLight(0xffffff, 46, 0, Math.PI / 3, 0.85, 2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1536, 1536);
  spot.shadow.camera.near = 0.4;
  spot.shadow.camera.far = 16;
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.02;
  spot.target.position.set(0, LETTER_H * 0.45, LETTERS_Z);
  scene.add(spot, spot.target);

  /* light marker: small emissive bulb + faint halo (no bloom) */
  const marker = new THREE.Group();
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
  marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), bulbMat));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(THREE), transparent: true, depthWrite: false, opacity: 0.55,
  }));
  halo.scale.setScalar(0.42);
  marker.add(halo);
  scene.add(marker);

  /* light orbit: an ellipse around the letters, a little lower in front
     (long shadows on the wall) and higher behind (shadows toward the viewer) */
  const ORBIT = { rx: 2.45, rz: 1.4, cz: -0.2, y: 2.3, dy: 0.35, period: 12 };
  const orbitAt = (phi, out) => out.set(
    ORBIT.rx * Math.cos(phi),
    ORBIT.y - ORBIT.dy * Math.sin(phi),
    ORBIT.cz + ORBIT.rz * Math.sin(phi),
  );
  const nearestPhase = (p) => Math.atan2((p.z - ORBIT.cz) / ORBIT.rz, p.x / ORBIT.rx);

  const LIGHT_Z = 1.45;                                   // pointer plane, in front of the letters
  const REST = new THREE.Vector3(-1.75, 2.65, 1.25);      // reduced-motion 3/4 key light
  let phase = Math.PI - 0.75;                             // start front-left, a 3/4 angle
  const lightTarget = reduceMotion.matches ? REST.clone() : orbitAt(phase, new THREE.Vector3());
  const lightPos = lightTarget.clone();
  spot.position.copy(lightPos);
  marker.position.copy(lightPos);

  /* colours from CSS custom properties */
  const css = (name, fallbackValue) =>
    (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallbackValue);

  function applyTheme() {
    const bg = new THREE.Color().setStyle(css("--bg", "#fafaf9"));
    const ink = new THREE.Color().setStyle(css("--ink", "#111827"));
    const accent = new THREE.Color().setStyle(css("--accent", "#1d4ed8"));
    const muted = new THREE.Color().setStyle(css("--muted", "#6b7280"));
    const darkTheme = luminance(bg) < 0.2;

    renderer.setClearColor(bg, 1);
    cove.material.color.copy(bg);
    // light: accent pulled toward ink -> navy; dark: accent desaturated toward --muted -> periwinkle
    if (darkTheme) letterMat.color.copy(accent).lerp(muted, 0.4).multiplyScalar(0.72);
    else letterMat.color.copy(accent).lerp(ink, 0.66).lerp(muted, 0.1);
    hemi.color.copy(bg).lerp(new THREE.Color(0xffffff), darkTheme ? 0.15 : 0.5);
    hemi.groundColor.copy(bg).multiplyScalar(0.7);
    hemi.intensity = darkTheme ? 1.6 : 1.5;
    spot.intensity = darkTheme ? 26 : 27;
    chart.material.opacity = darkTheme ? 0.7 : 0.85;
    halo.material.opacity = darkTheme ? 0.5 : 0.75;
    invalidate();
  }

  /* sizing */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  /* who drives the light: the orbit, or the viewer (pointer / keys) */
  let steering = false, resumeTimer = 0, follow = 9;
  function steer() {
    steering = true;
    clearTimeout(resumeTimer);
  }
  function resumeOrbit(delay = 0) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!steering) return;
      steering = false;
      phase = nearestPhase(lightPos);   // rejoin the orbit where it is closest
      follow = 1.2;                     // ...and ease into it
      invalidate();
    }, delay);
  }

  /* pointer -> light position (ray onto the plane z = LIGHT_Z) */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const lightPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -LIGHT_Z);
  const hit = new THREE.Vector3();

  function setTarget(x, y) {
    lightTarget.set(
      THREE.MathUtils.clamp(x, -2.6, 2.6),
      THREE.MathUtils.clamp(y, 0.3, 3.6),
      LIGHT_Z,
    );
    invalidate();
  }
  function pointTo(e) {
    steer();
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(lightPlane, hit)) setTarget(hit.x, hit.y);
  }

  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.classList.add("is-dragging");
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    pointTo(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    // mouse: hovering is enough; touch/pen: only while pressed
    if (dragging || e.pointerType === "mouse") pointTo(e);
  });
  const endDrag = (e) => {
    dragging = false;
    canvas.classList.remove("is-dragging");
    // touch/pen have no hover: give the orbit back after a pause
    if (e.pointerType !== "mouse") resumeOrbit(2500);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !dragging) resumeOrbit(0);
  });

  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.5 : 0.2;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    if (!steering) lightTarget.copy(lightPos);   // nudge from where the light is now
    steer();
    setTarget(lightTarget.x + d[0], lightTarget.y + d[1]);
    resumeOrbit(4000);
  });
  canvas.addEventListener("blur", () => { if (!dragging) resumeOrbit(1500); });

  /* render loop — only runs while on screen, tab visible, and something changes */
  let onScreen = true, running = false, dirty = true, last = 0, t = 0;

  function animated() { return !reduceMotion.matches; }
  function active() { return onScreen && !document.hidden; }
  function invalidate() { dirty = true; kick(); }
  function kick() {
    if (running || !active()) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!active()) { running = false; return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    let rate = 9;
    if (animated()) {
      t += dt;
      // the word stays readable: only a very slight sway
      letters.rotation.y = Math.sin(t * (2 * Math.PI / 9)) * 0.035;
      if (!steering) {
        phase += dt * (2 * Math.PI / ORBIT.period);
        orbitAt(phase, lightTarget);
        follow = Math.min(6, follow + dt * 2.5);
        rate = follow;
      }
      dirty = true;
    }
    if (lightPos.distanceToSquared(lightTarget) > 1e-6) {
      lightPos.lerp(lightTarget, 1 - Math.exp(-dt * rate));
      spot.position.copy(lightPos);
      marker.position.copy(lightPos);
      dirty = true;
    }

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
      requestAnimationFrame(frame);
    } else {
      running = false; // idle until the next invalidate()
    }
  }

  /* observers */
  new ResizeObserver(resize).observe(stage);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      if (onScreen) invalidate();
    }).observe(stage);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) invalidate(); });
  reduceMotion.addEventListener?.("change", () => {
    if (reduceMotion.matches) { letters.rotation.y = 0; if (!steering) lightTarget.copy(REST); }
    else { steering = false; phase = nearestPhase(lightPos); follow = 1.2; }
    invalidate();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); fallback(fig); });

  /* go live */
  stage.appendChild(canvas);
  applyTheme();
  resize();
  renderer.render(scene, camera); // first frame before revealing
  fig.classList.add("is-live");
  kick();
}

/* ---------------------------------------------------------------- */

// Extruded, bevelled text from typeface.js JSON (port of three's
// Font.generateShapes + TextGeometry). Centred on x and z, baseline
// lifted so the lowest point (incl. bevel) sits on y = 0.
// userData.width / .height give the bounding size in font units.
function letterGeometry(THREE, data, text) {
  const size = 1, scale = size / data.resolution, tracking = 0.045 * size;
  const shapes = [];
  let offsetX = 0;
  for (const ch of Array.from(text)) {
    const glyph = data.glyphs[ch] || data.glyphs["?"];
    if (!glyph) throw new Error("glyph missing: " + ch);
    const path = new THREE.ShapePath();
    const o = glyph.o ? glyph.o.split(" ") : [];
    const n = (i) => o[i] * scale;
    for (let i = 0; i < o.length;) {
      const a = o[i++];
      if (a === "m" || a === "l") {
        const x = n(i++) + offsetX, y = n(i++);
        a === "m" ? path.moveTo(x, y) : path.lineTo(x, y);
      } else if (a === "q") {
        const x = n(i++) + offsetX, y = n(i++), cx = n(i++) + offsetX, cy = n(i++);
        path.quadraticCurveTo(cx, cy, x, y);
      } else if (a === "b") {
        const x = n(i++) + offsetX, y = n(i++);
        const c1x = n(i++) + offsetX, c1y = n(i++), c2x = n(i++) + offsetX, c2y = n(i++);
        path.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
      }
    }
    shapes.push(...path.toShapes());
    offsetX += glyph.ha * scale + tracking;
  }
  if (!shapes.length) throw new Error("no glyph outlines");

  // cap height of the shapes, to size the depth and bevel relative to it
  const box = new THREE.Box2();
  shapes.forEach((s) => s.getPoints(4).forEach((p) => box.expandByPoint(p)));
  const capH = box.max.y - box.min.y;

  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: capH * 0.35 - capH * 0.06,     // total depth ~0.35 x letter height incl. bevels
    curveSegments: 10,
    bevelEnabled: true,
    bevelThickness: capH * 0.03,
    bevelSize: capH * 0.022,
    bevelSegments: 4,
  });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.userData.width = b.max.x - b.min.x;
  g.userData.height = b.max.y - b.min.y;
  return g;
}

// Floor that bends up into the back wall through a quarter-circle cove.
function coveGeometry(THREE) {
  const W = 14, FLOOR = 6, R = 1.0, WALL = 7, Z0 = -0.9; // wall at z = Z0 - R
  const ARC = (Math.PI / 2) * R, L = FLOOR + ARC + WALL;
  const g = new THREE.PlaneGeometry(W, L, 1, 160);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = p.getY(i) + L / 2;
    let y, z;
    if (s <= FLOOR) { y = 0; z = Z0 + FLOOR - s; }
    else if (s <= FLOOR + ARC) {
      const a = (s - FLOOR) / R;
      y = R - R * Math.cos(a); z = Z0 - R * Math.sin(a);
    } else { y = R + (s - FLOOR - ARC); z = Z0 - R; }
    p.setY(i, y); p.setZ(i, z);
  }
  g.computeVertexNormals();
  return g;
}

function checkerTexture(THREE) {
  const cols = 6, rows = 4, cell = 64, gap = 10, pad = 14;
  const c = document.createElement("canvas");
  c.width = pad * 2 + cols * cell + (cols - 1) * gap;
  c.height = pad * 2 + rows * cell + (rows - 1) * gap;
  const g = c.getContext("2d");
  g.fillStyle = "#1c1c1c";
  g.fillRect(0, 0, c.width, c.height);
  CHECKER.forEach((hex, i) => {
    g.fillStyle = hex;
    g.fillRect(pad + (i % cols) * (cell + gap), pad + Math.floor(i / cols) * (cell + gap), cell, cell);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function haloTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,240,205,0.9)");
  grad.addColorStop(0.25, "rgba(255,232,185,0.35)");
  grad.addColorStop(1, "rgba(255,232,185,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
