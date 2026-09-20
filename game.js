import * as THREE from 'three';

// ============================================================
// NEON RACER — cyberpunk night-city time-trial racing
// ============================================================

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const container = $('gameContainer');
const hud = $('hud');
const hudLap = $('hudLap'), hudTime = $('hudTime'), hudLast = $('hudLast');
const hudBest = $('hudBest'), hudSpeed = $('hudSpeed');
const messageEl = $('message'), wrongWayEl = $('wrongWay');
const touchControls = $('touchControls');
const menu = $('menu'), menuBest = $('menuBest');
const centerOverlay = $('centerOverlay'), countdownEl = $('countdown');
const muteBtn = $('muteBtn');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  $('controlsHint').innerHTML = '◀ ▶ steer &nbsp;•&nbsp; auto-gas &nbsp;•&nbsp; BRAKE slows you &nbsp;•&nbsp; DRIFT for corners';
} else {
  $('controlsHint').innerHTML = '← → / A D steer &nbsp;•&nbsp; auto-gas &nbsp;•&nbsp; ↓ / S brake &nbsp;•&nbsp; Space drift';
}

// ---------- Persistent records ----------
let bestLap = parseFloat(localStorage.getItem('racer-best') || 'Infinity');
let bestGhost = null;
try {
  const g = JSON.parse(localStorage.getItem('racer-ghost') || 'null');
  if (Array.isArray(g) && g.length > 1) bestGhost = g;
} catch (e) { /* ignore */ }
let soundOn = localStorage.getItem('racer-sound') !== 'off';

function fmtLap(ms) {
  if (!isFinite(ms)) return '--:--.-';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}
menuBest.textContent = fmtLap(bestLap);
hudBest.textContent = fmtLap(bestLap);
muteBtn.textContent = soundOn ? '🔊' : '🔇';

// ---------- Track definition ----------
const SAMPLES = 256;
const ROAD_HALF = 9;

function trackRadius(a) {
  return 170 + 40 * Math.sin(2 * a + 1.2) + 20 * Math.sin(3 * a + 0.5);
}

const centerPts = [];
for (let i = 0; i < SAMPLES; i++) {
  const a = (i / SAMPLES) * Math.PI * 2;
  const r = trackRadius(a);
  centerPts.push(new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a)));
}
const tangents = [];
const normals = [];
for (let i = 0; i < SAMPLES; i++) {
  const p = centerPts[(i + 1) % SAMPLES].clone().sub(centerPts[(i - 1 + SAMPLES) % SAMPLES]);
  p.y = 0;
  p.normalize();
  tangents.push(p);
  normals.push(new THREE.Vector3(-p.z, 0, p.x)); // left of travel
}
let trackLen = 0;
for (let i = 0; i < SAMPLES; i++) trackLen += centerPts[i].distanceTo(centerPts[(i + 1) % SAMPLES]);

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

let quality = isTouch ? 1 : 2;
function applyQuality() {
  const dprCap = [1.25, 2, 3][quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const sh = [0, 1024, 2048][quality];
  moon.castShadow = sh > 0;
  if (sh > 0 && moon.shadow.mapSize.x !== sh) {
    moon.shadow.mapSize.set(sh, sh);
    if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
  }
}
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);
scene.fog = new THREE.Fog(0x0b0e1a, 120, 640);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.5, 2500);

// ---------- Lights (night) ----------
scene.add(new THREE.HemisphereLight(0x3b4a6e, 0x05060c, 0.55));
const moon = new THREE.DirectionalLight(0x8fb4ff, 0.5);
moon.position.set(120, 190, 70);
moon.castShadow = true;
moon.shadow.mapSize.set(quality === 2 ? 2048 : 1024, quality === 2 ? 2048 : 1024);
moon.shadow.camera.left = -80;
moon.shadow.camera.right = 80;
moon.shadow.camera.top = 80;
moon.shadow.camera.bottom = -80;
moon.shadow.camera.near = 20;
moon.shadow.camera.far = 600;
moon.shadow.bias = -0.0004;
scene.add(moon);
scene.add(moon.target);
const cityGlowLight = new THREE.DirectionalLight(0xf72585, 0.18);
cityGlowLight.position.set(-100, 40, -140);
scene.add(cityGlowLight);

applyQuality();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Procedural textures ----------
function canvasTexture(size, draw, rx = 1, ry = 1, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = maxAniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function radialTex(size, stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = radialTex(128, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
const dustTex = radialTex(64, [[0, 'rgba(150,170,220,0.8)'], [1, 'rgba(150,170,220,0)']]);

const groundTex = canvasTexture(256, (cx, s) => {
  cx.fillStyle = '#0c0f16'; cx.fillRect(0, 0, s, s);
  for (let i = 0; i < 1800; i++) {
    cx.globalAlpha = 0.15 + Math.random() * 0.3;
    cx.fillStyle = Math.random() > 0.5 ? '#11151f' : '#080a10';
    const d = 1 + Math.random() * 3;
    cx.fillRect(Math.random() * s, Math.random() * s, d, d);
  }
  cx.globalAlpha = 1;
}, 80, 80);

const asphaltTex = canvasTexture(256, (cx, s) => {
  cx.fillStyle = '#16181f'; cx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    cx.globalAlpha = 0.2 + Math.random() * 0.4;
    cx.fillStyle = ['#101218', '#1e212b', '#0b0d12', '#232733'][(Math.random() * 4) | 0];
    const d = 1 + Math.random() * 2.5;
    cx.fillRect(Math.random() * s, Math.random() * s, d, d);
  }
  cx.globalAlpha = 1;
}, 2, SAMPLES / 4);

function windowTexture(hueShift) {
  return canvasTexture(128, (cx, s) => {
    cx.fillStyle = '#04060b'; cx.fillRect(0, 0, s, s);
    const cols = 7, rows = 16;
    const ww = s / cols, wh = s / rows;
    const palette = ['#ffd166', '#4cc9f0', '#f8f9fa', '#f72585', '#80ffdb'];
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      if (Math.random() < 0.42 + hueShift * 0.1) {
        cx.globalAlpha = 0.75 + Math.random() * 0.25;
        cx.fillStyle = palette[(Math.random() * palette.length) | 0];
      } else {
        cx.globalAlpha = 1;
        cx.fillStyle = '#0a0f18';
      }
      cx.fillRect(x * ww + 2, y * wh + 3, ww - 4, wh - 6);
    }
    cx.globalAlpha = 1;
  }, 1, 2);
}

// ---------- Night sky: gradient dome, stars, moon ----------
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x02030a) },
      midColor: { value: new THREE.Color(0x141b3d) },
      botColor: { value: new THREE.Color(0x3b1d5a) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 topColor, midColor, botColor;
      void main() {
        float h = normalize(vP).y;
        vec3 c = h > 0.12
          ? mix(midColor, topColor, smoothstep(0.12, 0.9, h))
          : mix(botColor, midColor, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1100, 24, 16), skyMat));

  // stars
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = 0.15 + Math.random() * 1.3;
    const r = 1000;
    sp[i * 3] = r * Math.cos(a) * Math.cos(e);
    sp[i * 3 + 1] = r * Math.sin(e);
    sp[i * 3 + 2] = r * Math.sin(a) * Math.cos(e);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));

  // moon + halo
  const moonDir = new THREE.Vector3(120, 190, 70).normalize();
  const moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex(128, [[0, 'rgba(235,242,255,1)'], [0.5, 'rgba(210,225,255,0.9)'], [0.62, 'rgba(160,190,255,0.25)'], [1, 'rgba(160,190,255,0)']]), fog: false, depthWrite: false }));
  moonSpr.position.copy(moonDir).multiplyScalar(980);
  moonSpr.scale.set(150, 150, 1);
  scene.add(moonSpr);

  // distant city glow on horizon
  const glowCols = [0xf72585, 0x4cc9f0, 0xff9e00, 0x7209b7];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: glowCols[i % glowCols.length],
      transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    s.position.set(Math.cos(a) * 900, 60 + Math.random() * 40, Math.sin(a) * 900);
    s.scale.set(420, 150, 1);
    scene.add(s);
  }
}

// ---------- World geometry ----------
function ribbonGeometry(leftPts, rightPts, vRepeat, colorFn) {
  const n = leftPts.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const colors = colorFn ? new Float32Array(n * 2 * 3) : null;
  for (let i = 0; i < n; i++) {
    const L = leftPts[i], R = rightPts[i];
    positions.set([L.x, L.y, L.z, R.x, R.y, R.z], i * 6);
    const v = (i / (n - 1)) * vRepeat;
    uvs.set([0, v, 1, v], i * 4);
    if (colorFn) {
      const c = colorFn(i);
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function offsetPts(dist) {
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const j = i % SAMPLES;
    pts.push(centerPts[j].clone().addScaledVector(normals[j], dist));
  }
  return pts;
}

// ground
{
  const g = new THREE.Mesh(
    new THREE.CircleGeometry(800, 48),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.08;
  g.receiveShadow = true;
  scene.add(g);
}

// road — dark wet asphalt with specular sheen
{
  const road = new THREE.Mesh(
    ribbonGeometry(offsetPts(ROAD_HALF), offsetPts(-ROAD_HALF), 1, null),
    new THREE.MeshPhongMaterial({ map: asphaltTex, specular: 0x5a6f9e, shininess: 55 })
  );
  road.receiveShadow = true;
  scene.add(road);
}

// glowing edge lines (alternate cyan / magenta)
{
  const cyan = new THREE.Color(0x22d3ee), mag = new THREE.Color(0xf0f);
  const colorFn = (i) => (Math.floor(i / 16) % 2 === 0 ? cyan : mag);
  for (const side of [1, -1]) {
    const line = new THREE.Mesh(
      ribbonGeometry(offsetPts(side * (ROAD_HALF - 0.5)), offsetPts(side * (ROAD_HALF - 1.1)), 1, colorFn),
      new THREE.MeshBasicMaterial({ vertexColors: true })
    );
    line.position.y = 0.015;
    scene.add(line);
  }
}

// glowing center dashes
{
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 64;
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, 16, 64);
  cx.fillStyle = '#67e8f9';
  cx.shadowColor = '#22d3ee'; cx.shadowBlur = 12;
  cx.fillRect(4, 6, 8, 28);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  const dashes = new THREE.Mesh(
    ribbonGeometry(offsetPts(0.35), offsetPts(-0.35), SAMPLES / 5, null),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  dashes.position.y = 0.02;
  scene.add(dashes);
}

// curbs (dimmer at night, still red/white)
{
  const red = new THREE.Color(0x8a2323), white = new THREE.Color(0x9aa3b2);
  const colorFn = (i) => (Math.floor(i / 6) % 2 === 0 ? red : white);
  for (const side of [1, -1]) {
    const curb = new THREE.Mesh(
      ribbonGeometry(offsetPts(side * (ROAD_HALF + 1.7)), offsetPts(side * ROAD_HALF), 1, colorFn),
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    curb.position.y = 0.015;
    curb.receiveShadow = true;
    scene.add(curb);
  }
}

// start line + neon gantry
{
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 32;
  const cx = cv.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    cx.fillStyle = (x + y) % 2 ? '#0f172a' : '#e2e8f0';
    cx.fillRect(x * 16, y * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 3), new THREE.MeshBasicMaterial({ map: tex }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(tangents[0].x, tangents[0].z);
  line.position.copy(centerPts[0]);
  line.position.y = 0.03;
  scene.add(line);

  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x1e2433 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 11, 0.9), postMat);
    post.position.set(sx * (ROAD_HALF + 2.6), 5.5, 0);
    post.castShadow = true;
    gantry.add(post);
    // neon strip on post
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 10.4, 0.2),
      new THREE.MeshBasicMaterial({ color: sx < 0 ? 0x22d3ee : 0xf0f }));
    strip.position.set(sx * (ROAD_HALF + 2.6) + (sx < 0 ? 0.5 : -0.5), 5.5, 0);
    gantry.add(strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF + 2.6) * 2 + 1, 2.4, 0.7), postMat);
  beam.position.y = 10.2;
  beam.castShadow = true;
  gantry.add(beam);

  const bc = document.createElement('canvas');
  bc.width = 1024; bc.height = 128;
  const bx = bc.getContext('2d');
  bx.fillStyle = '#05060f'; bx.fillRect(0, 0, 1024, 128);
  bx.font = '900 76px Trebuchet MS, sans-serif';
  bx.textAlign = 'center'; bx.textBaseline = 'middle';
  bx.shadowColor = '#22d3ee'; bx.shadowBlur = 34;
  bx.fillStyle = '#a5f3fc';
  bx.fillText('NEON RACER', 512, 66);
  const btex = new THREE.CanvasTexture(bc);
  btex.anisotropy = maxAniso;
  btex.colorSpace = THREE.SRGBColorSpace;
  for (const sz of [0.37, -0.37]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry((ROAD_HALF + 2.6) * 2, 2.1),
      new THREE.MeshBasicMaterial({ map: btex, transparent: true }));
    banner.position.set(0, 10.2, sz);
    if (sz < 0) banner.rotation.y = Math.PI;
    gantry.add(banner);
  }
  gantry.position.copy(centerPts[0]);
  gantry.rotation.y = Math.atan2(tangents[0].x, tangents[0].z);
  scene.add(gantry);
}

// ---------- Neon ring arches (tunnel district) ----------
{
  const geo = new THREE.TorusGeometry(ROAD_HALF + 3.2, 0.32, 8, 40, Math.PI);
  for (let s = 24; s <= 104; s += 10) {
    const i = s % SAMPLES;
    const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: ((s / 10) | 0) % 2 === 0 ? 0x22d3ee : 0xff2fd6,
    }));
    ring.position.copy(centerPts[i]);
    ring.position.y = 0.4;
    ring.rotation.y = Math.atan2(tangents[i].x, tangents[i].z);
    scene.add(ring);
    // halo sprite for glow feel
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: ((s / 10) | 0) % 2 === 0 ? 0x22d3ee : 0xff2fd6,
      transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.position.copy(centerPts[i]);
    halo.position.y = 9;
    halo.scale.set(30, 22, 1);
    scene.add(halo);
  }
}

// ---------- Buildings ----------
function scatter(count, minOff, maxOff, place) {
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 40) {
    const a = Math.random() * Math.PI * 2;
    const baseR = trackRadius(a);
    const outside = Math.random() > 0.3;
    const off = minOff + Math.random() * (maxOff - minOff);
    const r = outside ? baseR + off : baseR - off;
    if (r < 45 || r > 620) continue;
    place(r * Math.cos(a), r * Math.sin(a), placed);
    placed++;
  }
  return placed;
}
const beacons = [];
{
  const COUNT = 110;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // pivot at base
  const texA = windowTexture(0), texB = windowTexture(0.5);
  const matA = new THREE.MeshLambertMaterial({ color: 0x8a93a8, emissive: 0xffffff, emissiveMap: texA, emissiveIntensity: 0.9 });
  const matB = new THREE.MeshLambertMaterial({ color: 0x8a93a8, emissive: 0xffffff, emissiveMap: texB, emissiveIntensity: 0.9 });
  const meshA = new THREE.InstancedMesh(geo, matA, COUNT);
  const meshB = new THREE.InstancedMesh(geo, matB, COUNT);
  let nA = 0, nB = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const tallTops = [];
  scatter(COUNT, ROAD_HALF + 30, ROAD_HALF + 220, (x, z, i) => {
    const w = 12 + Math.random() * 18;
    const d = 12 + Math.random() * 18;
    const h = 22 + Math.random() * 68;
    q.setFromAxisAngle(up, Math.random() * Math.PI);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d));
    if (i % 2 === 0) { meshA.setMatrixAt(nA++, m); } else { meshB.setMatrixAt(nB++, m); }
    if (h > 60 && tallTops.length < 24) tallTops.push([x, h, z]);
  });
  meshA.count = nA; meshB.count = nB;
  scene.add(meshA, meshB);

  // blinking red rooftop beacons
  for (const [x, h, z] of tallTops) {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xff2222, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    b.position.set(x, h + 2, z);
    b.scale.set(6, 6, 1);
    scene.add(b);
    beacons.push({ s: b, ph: Math.random() * Math.PI * 2 });
  }

  // neon rooftop edge strips on some buildings
  const stripGeo = new THREE.BoxGeometry(1, 0.5, 1);
  const stripCols = [0x22d3ee, 0xff2fd6, 0xfacc15, 0x4ade80];
  const strips = [];
  for (let k = 0; k < 4; k++) strips.push(new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({ color: stripCols[k] }), 30));
  const sn = [0, 0, 0, 0];
  scatter(90, ROAD_HALF + 30, ROAD_HALF + 200, (x, z, i) => {
    if (i >= 90) return;
    const w = 10 + Math.random() * 14;
    const h = 24 + Math.random() * 55;
    const k = i % 4;
    q.setFromAxisAngle(up, Math.random() * Math.PI);
    m.compose(new THREE.Vector3(x, h + 0.2, z), q, new THREE.Vector3(w + 0.6, 1, w + 0.6));
    strips[k].setMatrixAt(sn[k]++, m);
  });
  strips.forEach((s, k) => { s.count = sn[k]; scene.add(s); });
}

// ---------- Neon billboards ----------
{
  const signs = [
    ['NITRO', '#ff2fd6'], ['NEON', '#22d3ee'], ['TURBO 24/7', '#facc15'],
    ['SYNTH', '#4ade80'], ['ラーメン', '#ff9e00'], ['OVERDRIVE', '#22d3ee'],
    ['MIDNIGHT', '#e879f9'], ['VOLT', '#4cc9f0'],
  ];
  signs.forEach(([text, col], k) => {
    const s = 16 + ((k * 37) % SAMPLES);
    const i = s % SAMPLES;
    const side = k % 2 === 0 ? 1 : -1;
    const px = centerPts[i].x + normals[i].x * side * (ROAD_HALF + 8);
    const pz = centerPts[i].z + normals[i].z * side * (ROAD_HALF + 8);

    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 160;
    const cx = cv.getContext('2d');
    cx.clearRect(0, 0, 512, 160);
    cx.font = '900 84px Trebuchet MS, sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.shadowColor = col; cx.shadowBlur = 30;
    cx.fillStyle = '#ffffff';
    cx.fillText(text, 256, 72);
    cx.shadowBlur = 12;
    cx.strokeStyle = col; cx.lineWidth = 3;
    cx.strokeRect(8, 8, 496, 144);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0x1e2433 }));
    pole.position.set(px, 4.5, pz);
    scene.add(pole);

    const board = new THREE.Mesh(new THREE.PlaneGeometry(13, 4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    board.position.set(px, 10.5, pz);
    board.rotation.y = Math.atan2(centerPts[i].x - px, centerPts[i].z - pz);
    scene.add(board);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(col), transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.position.set(px, 10.5, pz);
    halo.scale.set(22, 12, 1);
    scene.add(halo);
  });
}

// ---------- Street lamps with light pools ----------
{
  const poleGeo = new THREE.CylinderGeometry(0.22, 0.3, 8, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x232a3a });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, 32);
  const m = new THREE.Matrix4();
  let pi = 0;
  const streakTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const cx = cv.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,240,200,0.5)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, 64, 128);
    return new THREE.CanvasTexture(cv);
  })();
  for (let s = 0; s < SAMPLES && pi < 32; s += 8) {
    const side = (s / 8) % 2 === 0 ? 1 : -1;
    const px = centerPts[s].x + normals[s].x * side * (ROAD_HALF + 3.2);
    const pz = centerPts[s].z + normals[s].z * side * (ROAD_HALF + 3.2);
    m.makeTranslation(px, 4, pz);
    poles.setMatrixAt(pi++, m);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    head.position.set(px, 8.1, pz);
    scene.add(head);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffedb0, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.set(px, 8.1, pz);
    glow.scale.set(9, 9, 1);
    scene.add(glow);

    // warm pool of light on the road
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 14),
      new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = -Math.atan2(tangents[s].x, tangents[s].z);
    pool.position.set(
      centerPts[s].x + normals[s].x * side * (ROAD_HALF - 2),
      0.04,
      centerPts[s].z + normals[s].z * side * (ROAD_HALF - 2)
    );
    scene.add(pool);
  }
  poles.count = pi;
  scene.add(poles);
}

// ---------- Cars ----------
function buildCar(color, ghost, opts = {}) {
  const g = new THREE.Group();
  const mat = (c, o = {}) => ghost
    ? new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.42, ...o })
    : new THREE.MeshLambertMaterial({ color: c, ...o });

  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    if (!ghost && opts.shadows !== false) mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(2.2, 0.5, 4.4), mat(color), 0, 0.62, 0);
  add(new THREE.BoxGeometry(2.0, 0.28, 1.5), mat(color), 0, 0.78, 1.55, -0.16, 0, 0);
  add(new THREE.BoxGeometry(1.9, 0.32, 0.9), mat(color), 0, 0.5, 2.6);
  add(new THREE.BoxGeometry(2.3, 0.1, 0.5), mat(0x0a0a12), 0, 0.32, 2.9);
  add(new THREE.BoxGeometry(0.55, 0.03, 4.0), mat(0xf8fafc), 0, 0.885, 0.2);
  for (const sx of [-1.12, 1.12]) add(new THREE.BoxGeometry(0.16, 0.22, 3.4), mat(0x0a0a12), sx, 0.4, 0);
  add(new THREE.BoxGeometry(1.7, 0.5, 1.7), mat(0x0d1119), 0, 1.05, -0.5);
  add(new THREE.BoxGeometry(1.6, 0.42, 0.9), mat(0x9fc8e8, { transparent: !ghost, opacity: ghost ? 0.42 : 0.7 }), 0, 1.02, 0.55, -0.35, 0, 0);
  add(new THREE.SphereGeometry(0.3, 10, 8), mat(0xfbbf24), 0, 1.15, -0.55);
  for (const sx of [-1.15, 1.15]) {
    add(new THREE.BoxGeometry(0.3, 0.08, 0.08), mat(0x0a0a12), sx * 0.92, 1.05, 0.25);
    add(new THREE.BoxGeometry(0.22, 0.18, 0.1), mat(0x0a0a12), sx, 1.12, 0.25);
  }
  add(new THREE.BoxGeometry(2.4, 0.1, 0.65), mat(0x0a0a12), 0, 1.5, -2.05);
  for (const sx of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.08, 0.5, 0.7), mat(0x0a0a12), sx, 1.32, -2.05);
  for (const sx of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.12, 0.5, 0.25), mat(0x0a0a12), sx, 1.15, -2.05);
  add(new THREE.BoxGeometry(2.0, 0.28, 0.5), mat(0x0a0a12), 0, 0.4, -2.25);
  for (const sx of [-0.4, 0.4]) add(new THREE.CylinderGeometry(0.09, 0.11, 0.4, 8), mat(0x9ca3af), sx, 0.45, -2.5, Math.PI / 2, 0, 0);

  // headlights + glow
  for (const sx of [-0.65, 0.65]) {
    add(new THREE.BoxGeometry(0.44, 0.16, 0.08),
      ghost ? mat(0xd6e9ff) : new THREE.MeshBasicMaterial({ color: 0xd6e9ff }), sx, 0.62, 3.06);
    if (!ghost) {
      const hg = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xbfe0ff, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      hg.position.set(sx, 0.62, 3.2);
      hg.scale.set(1.8, 1.1, 1);
      g.add(hg);
    }
  }
  // taillights + glow
  for (const sx of [-0.65, 0.65]) {
    add(new THREE.BoxGeometry(0.44, 0.14, 0.08),
      ghost ? mat(0xff2244) : new THREE.MeshBasicMaterial({ color: 0xff2244 }), sx, 0.72, -2.21);
    if (!ghost) {
      const tg = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xff2244, transparent: true, opacity: 0.65,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      tg.position.set(sx, 0.72, -2.35);
      tg.scale.set(1.6, 1.0, 1);
      g.add(tg);
    }
  }

  // neon underglow
  if (!ghost) {
    const under = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 5.8),
      new THREE.MeshBasicMaterial({ map: glowTex, color: opts.glowColor || 0x22d3ee, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.08;
    g.add(under);
  }

  // wheels with glowing rims
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.44, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const tireMat = mat(0x0a0a0a);
  const rimMat = ghost ? mat(0xcbd5e1) : new THREE.MeshBasicMaterial({ color: opts.glowColor || 0x22d3ee });
  for (const [sx, sz, front] of [[-1.08, 1.5, true], [1.08, 1.5, true], [-1.08, -1.5, false], [1.08, -1.5, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.46, sz);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    if (!ghost && opts.shadows !== false) tire.castShadow = true;
    pivot.add(tire, rim);
    g.add(pivot);
    wheels.push({ pivot, tire, rim, front });
  }

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: ghost ? 0.1 : 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.scale.set(0.72, 1.4, 1);
  g.add(blob);

  // player headlight beam
  if (opts.headlights) {
    const spot = new THREE.SpotLight(0xd6e9ff, 3.4, 170, 0.55, 0.5, 0);
    spot.position.set(0, 1.3, 2.4);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, 0, 42);
    g.add(spot, tgt);
    spot.target = tgt;
  }

  return { group: g, wheels };
}

const player = buildCar(0x8b2fc9, false, { glowColor: 0x22d3ee, headlights: true, shadows: true });
scene.add(player.group);
const ghostCar = buildCar(0x38bdf8, true);
ghostCar.group.visible = false;
scene.add(ghostCar.group);

// ambient traffic (GTA flavour)
const traffic = [];
{
  const cols = [0x22d3ee, 0xfacc15, 0x4ade80, 0xf472b6];
  const glows = [0x22d3ee, 0xfacc15, 0x4ade80, 0xf472b6];
  for (let i = 0; i < 4; i++) {
    const c = buildCar(cols[i], false, { glowColor: glows[i], shadows: false });
    scene.add(c.group);
    traffic.push({ car: c, s: (i / 4) * SAMPLES + i * 13, speed: 12 + i * 1.5, off: i % 2 === 0 ? 3.4 : -3.4 });
  }
}
function updateTraffic(dt) {
  for (const t of traffic) {
    t.s = (t.s + (t.speed / trackLen) * SAMPLES * dt) % SAMPLES;
    const i0 = Math.floor(t.s) % SAMPLES;
    const i1 = (i0 + 1) % SAMPLES;
    const f = t.s - Math.floor(t.s);
    const px = centerPts[i0].x + (centerPts[i1].x - centerPts[i0].x) * f + normals[i0].x * t.off;
    const pz = centerPts[i0].z + (centerPts[i1].z - centerPts[i0].z) * f + normals[i0].z * t.off;
    const tx = tangents[i0].x + (tangents[i1].x - tangents[i0].x) * f;
    const tz = tangents[i0].z + (tangents[i1].z - tangents[i0].z) * f;
    t.car.group.position.set(px, 0, pz);
    t.car.group.rotation.y = Math.atan2(tx, tz);
    for (const w of t.car.wheels) {
      const spin = (t.speed * dt) / 0.46;
      w.tire.rotation.x += spin;
      w.rim.rotation.x += spin;
    }
    // gentle collision with player
    const dx = pos.x - px, dz = pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d < 3.6 && d > 0.001) {
      const push = 3.6 - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
      speed *= 0.94;
    }
  }
}

// ---------- Dust particles ----------
const DUST_N = 90;
const dustPool = [];
for (let i = 0; i < DUST_N; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false }));
  s.scale.set(0.5, 0.5, 1);
  scene.add(s);
  dustPool.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
}
let dustIdx = 0;
function spawnDust(x, y, z, spread) {
  const d = dustPool[dustIdx];
  dustIdx = (dustIdx + 1) % DUST_N;
  d.s.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
  d.vx = (Math.random() - 0.5) * 3;
  d.vy = 1.5 + Math.random() * 2.5;
  d.vz = (Math.random() - 0.5) * 3;
  d.max = d.life = 0.6 + Math.random() * 0.5;
  const sc = 1 + Math.random() * 1.2;
  d.s.scale.set(sc, sc, 1);
}
function updateDust(dt) {
  for (const d of dustPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.s.material.opacity = 0; continue; }
    d.s.position.x += d.vx * dt;
    d.s.position.y += d.vy * dt;
    d.s.position.z += d.vz * dt;
    d.vy *= 1 - 1.5 * dt;
    d.s.material.opacity = (d.life / d.max) * 0.5;
    const sc = d.s.scale.x + 3.5 * dt;
    d.s.scale.set(sc, sc, 1);
  }
}

// ---------- Audio ----------
let audioCtx = null;
let engOsc = null, engGain = null;

function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function initEngine() {
  try {
    const a = ac();
    if (!a || engOsc) return;
    engOsc = a.createOscillator();
    engOsc.type = 'sawtooth';
    engOsc.frequency.value = 70;
    const filt = a.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 700;
    engGain = a.createGain();
    engGain.gain.value = 0;
    engOsc.connect(filt);
    filt.connect(engGain);
    engGain.connect(a.destination);
    engOsc.start();
  } catch (e) { /* no audio */ }
}

function beep(freq, dur, delay = 0) {
  if (!soundOn) return;
  try {
    const a = ac();
    if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (e) { /* silent */ }
}

muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  soundOn = !soundOn;
  localStorage.setItem('racer-sound', soundOn ? 'on' : 'off');
  muteBtn.textContent = soundOn ? '🔊' : '🔇';
});

// ---------- Input ----------
const keys = { left: false, right: false, brake: false, drift: false };
const touch = { left: false, right: false, brake: false, drift: false };

const keyMap = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'brake', KeyS: 'brake',
  Space: 'drift',
};
window.addEventListener('keydown', (e) => {
  const k = keyMap[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (k) { keys[k] = false; e.preventDefault(); }
});

function bindHold(el, on, off) {
  const start = (e) => { e.preventDefault(); on(); el.classList.add('active'); };
  const end = (e) => { e.preventDefault(); off(); el.classList.remove('active'); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHold($('btnLeft'), () => (touch.left = true), () => (touch.left = false));
bindHold($('btnRight'), () => (touch.right = true), () => (touch.right = false));
bindHold($('btnBrake'), () => (touch.brake = true), () => (touch.brake = false));
bindHold($('btnDrift'), () => (touch.drift = true), () => (touch.drift = false));

function readInput() {
  return {
    steer: ((keys.left || touch.left) ? 1 : 0) - ((keys.right || touch.right) ? 1 : 0),
    brake: keys.brake || touch.brake,
    drift: keys.drift || touch.drift,
  };
}

// ---------- Race state ----------
let state = 'menu';
let pos = new THREE.Vector3();
let vel = new THREE.Vector3();
let heading = 0;
let speed = 0;
let lapCount = 0;
let lapStart = 0;
let lastLap = Infinity;
let lapStartProg = 0;
let progUnwrapped = 0;
let prevRaw = 0;
let nextCp = 0;
let progHistory = [];
let curRecording = [];
let recTimer = 0;
let pauseBegin = 0;
let msgTimeout = null;
let camFov = 66;

const CP = [0.25, 0.5, 0.75];

function nearestRaw(p) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const dx = p.x - centerPts[i].x, dz = p.z - centerPts[i].z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const a = centerPts[best], b = centerPts[(best + 1) % SAMPLES];
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return { idx: best, raw: best + t, dist: Math.sqrt(bestD) };
}

function resetCarToStart() {
  pos.copy(centerPts[0]);
  vel.set(0, 0, 0);
  heading = Math.atan2(tangents[0].x, tangents[0].z);
  speed = 0;
  prevRaw = 0;
  progUnwrapped = 0;
  lapStartProg = 0;
  nextCp = 0;
  lapCount = 0;
  lastLap = Infinity;
  progHistory = [];
  curRecording = [];
  recTimer = 0;
  camFov = 66;
  camera.fov = 66;
  camera.updateProjectionMatrix();
  player.group.position.copy(pos);
  player.group.rotation.y = heading;
  hudLap.textContent = '1';
  hudLast.textContent = '--:--.-';
  const fx = Math.sin(heading), fz = Math.cos(heading);
  camera.position.set(pos.x - fx * 10.5, 4.8, pos.z - fz * 10.5);
  camera.lookAt(pos.x + fx * 7, 1.4, pos.z + fz * 7);
}

function showMessage(text, ms = 1800) {
  messageEl.textContent = text;
  messageEl.classList.add('show');
  if (msgTimeout) clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => messageEl.classList.remove('show'), ms);
}

function startCountdown() {
  ac();
  initEngine();
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  if (isTouch) touchControls.classList.remove('hidden');
  resetCarToStart();
  state = 'countdown';
  centerOverlay.classList.remove('hidden');
  let n = 3;
  countdownEl.textContent = n;
  beep(440, 0.15);
  const iv = setInterval(() => {
    n--;
    if (n > 0) {
      countdownEl.textContent = n;
      beep(440, 0.15);
    } else {
      clearInterval(iv);
      countdownEl.textContent = 'GO!';
      beep(880, 0.4);
      setTimeout(() => {
        centerOverlay.classList.add('hidden');
        if (state === 'countdown') {
          state = 'racing';
          lapStart = performance.now();
        }
      }, 700);
    }
  }, 900);
}

$('startRaceBtn').addEventListener('click', startCountdown);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'racing') {
    state = 'paused';
    pauseBegin = performance.now();
    countdownEl.textContent = '⏸ Paused — tap to resume';
    centerOverlay.classList.remove('hidden');
  }
});
centerOverlay.addEventListener('click', () => {
  if (state === 'paused') {
    lapStart += performance.now() - pauseBegin;
    centerOverlay.classList.add('hidden');
    state = 'racing';
  }
});

function completeLap(now) {
  const t = now - lapStart;
  lastLap = t;
  hudLast.textContent = fmtLap(t);
  lapCount++;
  hudLap.textContent = lapCount + 1;

  if (t < bestLap) {
    bestLap = t;
    bestGhost = curRecording.slice();
    localStorage.setItem('racer-best', String(t));
    try { localStorage.setItem('racer-ghost', JSON.stringify(bestGhost)); } catch (e) { /* quota */ }
    hudBest.textContent = fmtLap(t);
    menuBest.textContent = fmtLap(t);
    showMessage('🏆 NEW BEST LAP!', 2200);
    beep(660, 0.15); beep(880, 0.15, 0.15); beep(1320, 0.3, 0.3);
  } else {
    showMessage(fmtLap(t), 1500);
    beep(880, 0.2);
  }

  lapStart = now;
  lapStartProg = progUnwrapped;
  nextCp = 0;
  curRecording = [];
  recTimer = 0;
}

// ---------- Per-frame update ----------
const tmpV = new THREE.Vector3();

function update(dt, now) {
  const input = state === 'racing' ? readInput() : { steer: 0, brake: false, drift: false };

  // --- physics ---
  const near = nearestRaw(pos);
  const onGrass = near.dist > ROAD_HALF + 0.8;
  const maxSpd = onGrass ? 20 : 46;

  if (!input.brake) speed += 30 * dt * Math.max(0, 1 - speed / maxSpd);
  if (input.brake) speed -= 55 * dt;
  speed -= speed * (onGrass ? 1.7 : 0.32) * dt;
  speed = Math.max(-12, Math.min(maxSpd, speed));

  const authority = Math.min(1, Math.abs(speed) / 9);
  const turnRate = input.steer * 2.6 * authority * (input.drift ? 1.5 : 1);
  heading += turnRate * dt * (speed < -0.5 ? -1 : 1);

  const fx = Math.sin(heading), fz = Math.cos(heading);
  const grip = input.drift ? 2.1 : 9;
  const k = Math.min(1, grip * dt);
  vel.x += (fx * speed - vel.x) * k;
  vel.z += (fz * speed - vel.z) * k;
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;

  // soft walls at curb edge
  const WALL_D = ROAD_HALF + 2.6;
  const near2 = nearestRaw(pos);
  if (near2.dist > WALL_D) {
    const cp = centerPts[near2.idx];
    const dx = pos.x - cp.x, dz = pos.z - cp.z;
    const d = Math.hypot(dx, dz) || 1;
    pos.x = cp.x + (dx / d) * WALL_D;
    pos.z = cp.z + (dz / d) * WALL_D;
    const nx = dx / d, nz = dz / d;
    const vOut = vel.x * nx + vel.z * nz;
    if (vOut > 0) { vel.x -= nx * vOut; vel.z -= nz * vOut; }
    speed *= 0.97;
  }

  // --- progress / laps ---
  let dRaw = near2.raw - prevRaw;
  if (dRaw < -SAMPLES / 2) dRaw += SAMPLES;
  if (dRaw > SAMPLES / 2) dRaw -= SAMPLES;
  if (state === 'racing') progUnwrapped += dRaw;
  prevRaw = near2.raw;

  progHistory.push(progUnwrapped);
  if (progHistory.length > 60) progHistory.shift();
  const goingWrong = state === 'racing' && progHistory.length > 30 &&
    progUnwrapped < progHistory[0] - 25;
  wrongWayEl.classList.toggle('hidden', !goingWrong);

  if (state === 'racing') {
    const rel = progUnwrapped - lapStartProg;
    if (nextCp < 3 && rel >= CP[nextCp] * SAMPLES) nextCp++;
    if (rel >= SAMPLES && nextCp === 3) completeLap(now);

    recTimer += dt;
    if (recTimer >= 0.08) {
      recTimer = 0;
      curRecording.push({ t: now - lapStart, x: pos.x, z: pos.z, h: heading });
    }

    hudTime.textContent = fmtLap(now - lapStart);
    hudSpeed.textContent = Math.round(Math.abs(speed) * 3.4);

    const drifting = input.drift && Math.abs(speed) > 14;
    if (drifting || (onGrass && Math.abs(speed) > 8)) {
      const lx = Math.cos(heading), lz = -Math.sin(heading);
      for (const s of [-1, 1]) {
        spawnDust(pos.x - fx * 1.6 + lx * 1.05 * s, 0.5, pos.z - fz * 1.6 + lz * 1.05 * s, 1.2);
      }
    }

    updateTraffic(dt);
  }

  // --- ghost replay ---
  if (bestGhost && bestGhost.length > 1 && (state === 'racing' || state === 'paused')) {
    const gt = now - lapStart;
    const rec = bestGhost;
    if (gt <= rec[rec.length - 1].t + 400) {
      let lo = 0, hi = rec.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rec[mid].t < gt) lo = mid + 1; else hi = mid;
      }
      const b = rec[Math.min(lo, rec.length - 1)];
      const a = rec[Math.max(0, lo - 1)];
      const span = Math.max(1, b.t - a.t);
      const f = Math.max(0, Math.min(1, (gt - a.t) / span));
      ghostCar.group.position.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      ghostCar.group.rotation.y = a.h + dh * f;
      ghostCar.group.visible = true;
    } else {
      ghostCar.group.visible = false;
    }
  } else {
    ghostCar.group.visible = false;
  }

  // --- car visuals ---
  player.group.position.set(pos.x, 0, pos.z);
  player.group.rotation.y = heading;
  for (const w of player.wheels) {
    const spin = (speed * dt) / 0.46;
    w.tire.rotation.x += spin;
    w.rim.rotation.x += spin;
    if (w.front) w.pivot.rotation.y = input.steer * 0.42;
  }

  // --- engine sound ---
  if (engGain) {
    const target = state === 'racing' && soundOn ? 0.045 : 0;
    engGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.1);
    if (engOsc) engOsc.frequency.setTargetAtTime(65 + Math.abs(speed) * 3.6, audioCtx.currentTime, 0.08);
  }

  // --- moon follows car for shadows ---
  moon.position.set(pos.x + 120, 190, pos.z + 70);
  moon.target.position.set(pos.x, 0, pos.z);
  moon.target.updateMatrixWorld();

  // --- chase camera with speed FOV kick ---
  const targetFov = 66 + (Math.abs(speed) / 46) * 9;
  camFov += (targetFov - camFov) * Math.min(1, 4 * dt);
  if (Math.abs(camFov - camera.fov) > 0.05) {
    camera.fov = camFov;
    camera.updateProjectionMatrix();
  }
  tmpV.set(pos.x - fx * 10.5, 4.8, pos.z - fz * 10.5);
  camera.position.lerp(tmpV, 1 - Math.exp(-6 * dt));
  camera.lookAt(pos.x + fx * 7, 1.5, pos.z + fz * 7);

  updateDust(dt);
}

// ---------- Main loop + adaptive quality ----------
let lastT = performance.now();
let emaDt = 1 / 60;
let frameCount = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 0.05);

  emaDt += (Math.min(dt, 0.1) - emaDt) * 0.04;
  if (++frameCount % 240 === 0 && emaDt > 1 / 28 && quality > 0) {
    quality--;
    applyQuality();
  }

  // blinking rooftop beacons
  const bt = now * 0.004;
  for (const b of beacons) {
    b.s.material.opacity = 0.35 + 0.35 * Math.sin(bt + b.ph);
  }

  if (state === 'racing' || state === 'countdown') {
    update(dt, now);
  } else if (state === 'menu') {
    const t = now * 0.00004;
    const cx = centerPts[0];
    camera.position.set(cx.x + Math.cos(t) * 260, 120, cx.z + Math.sin(t) * 260);
    camera.lookAt(cx.x, 0, cx.z);
    if (engGain && audioCtx) engGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
    updateDust(dt);
  } else if (state === 'paused') {
    updateDust(dt);
  }
  renderer.render(scene, camera);
}

container.appendChild(renderer.domElement);

// idle camera init
resetCarToStart();
requestAnimationFrame(loop);
