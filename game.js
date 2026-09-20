import * as THREE from 'three';

// ============================================================
// Lowpoly Racer HD — high-resolution 3D time-trial racing
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

// ---------- Renderer / scene (high-res) ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

let quality = isTouch ? 1 : 2; // 0 low, 1 medium, 2 high
function applyQuality() {
  const dprCap = [1.25, 2, 3][quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const sh = [0, 1024, 2048][quality];
  sun.castShadow = sh > 0;
  if (sh > 0 && sun.shadow.mapSize.x !== sh) {
    sun.shadow.mapSize.set(sh, sh);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
}
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0xa8d4f0, 160, 700);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.5, 2500);

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a7c3a, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
sun.position.set(120, 190, 70);
sun.castShadow = true;
sun.shadow.mapSize.set(quality === 2 ? 2048 : 1024, quality === 2 ? 2048 : 1024);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xbcd8ff, 0.35);
fill.position.set(-140, 90, -120);
scene.add(fill);

applyQuality();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Procedural high-res textures ----------
function canvasTexture(size, draw, rx = 1, ry = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function speckle(cx, size, n, colors, aMin, aMax, sMin, sMax) {
  for (let i = 0; i < n; i++) {
    cx.globalAlpha = aMin + Math.random() * (aMax - aMin);
    cx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = sMin + Math.random() * (sMax - sMin);
    cx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  cx.globalAlpha = 1;
}

const grassTex = canvasTexture(256, (cx, s) => {
  cx.fillStyle = '#5da24f'; cx.fillRect(0, 0, s, s);
  speckle(cx, s, 2600, ['#4c8a40', '#6cb85e', '#54964a', '#65b457'], 0.25, 0.6, 1, 4);
}, 90, 90);

const asphaltTex = canvasTexture(256, (cx, s) => {
  cx.fillStyle = '#41454d'; cx.fillRect(0, 0, s, s);
  speckle(cx, s, 3200, ['#363b42', '#4c515a', '#2f3339', '#565b64'], 0.3, 0.7, 1, 3);
}, 2, SAMPLES / 4);

const cloudTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const dustTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(214,196,164,0.85)');
  g.addColorStop(1, 'rgba(214,196,164,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

// ---------- Sky dome, sun disc, clouds ----------
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f6fd6) },
      midColor: { value: new THREE.Color(0x87ceeb) },
      botColor: { value: new THREE.Color(0xeaf7ff) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 topColor, midColor, botColor;
      void main() {
        float h = normalize(vP).y;
        vec3 c = h > 0.0
          ? mix(midColor, topColor, pow(h, 0.55))
          : mix(midColor, botColor, pow(-h, 0.6));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1100, 24, 16), skyMat));

  const sunDir = new THREE.Vector3(120, 190, 70).normalize();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(46, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff7cf, fog: false })
  );
  disc.position.copy(sunDir).multiplyScalar(1000);
  disc.lookAt(0, 0, 0);
  scene.add(disc);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(110, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff7cf, transparent: true, opacity: 0.25, fog: false })
  );
  halo.position.copy(sunDir).multiplyScalar(999);
  halo.lookAt(0, 0, 0);
  scene.add(halo);
}

const clouds = [];
for (let i = 0; i < 14; i++) {
  const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75 + Math.random() * 0.2, depthWrite: false, fog: false });
  const s = new THREE.Sprite(m);
  const a = Math.random() * Math.PI * 2;
  const r = 250 + Math.random() * 450;
  const sc = 130 + Math.random() * 130;
  s.position.set(r * Math.cos(a), 150 + Math.random() * 90, r * Math.sin(a));
  s.scale.set(sc, sc * 0.45, 1);
  scene.add(s);
  clouds.push({ s, v: 1.2 + Math.random() * 1.6 });
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
    new THREE.MeshLambertMaterial({ map: grassTex })
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.08;
  g.receiveShadow = true;
  scene.add(g);
}

// road (textured asphalt)
{
  const road = new THREE.Mesh(
    ribbonGeometry(offsetPts(ROAD_HALF), offsetPts(-ROAD_HALF), 1, null),
    new THREE.MeshLambertMaterial({ map: asphaltTex })
  );
  road.receiveShadow = true;
  scene.add(road);
}

// white edge lines
for (const side of [1, -1]) {
  const geo = ribbonGeometry(offsetPts(side * (ROAD_HALF - 0.55)), offsetPts(side * (ROAD_HALF - 1.15)), 1, null);
  const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
  line.position.y = 0.015;
  scene.add(line);
}

// center dashes
{
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 64;
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, 16, 64);
  cx.fillStyle = '#f8fafc';
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

// red/white curbs
{
  const red = new THREE.Color(0xd63c3c), white = new THREE.Color(0xf1f5f9);
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

// start/finish line + gantry
{
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 32;
  const cx = cv.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    cx.fillStyle = (x + y) % 2 ? '#0f172a' : '#f8fafc';
    cx.fillRect(x * 16, y * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 3),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(tangents[0].x, tangents[0].z);
  line.position.copy(centerPts[0]);
  line.position.y = 0.03;
  scene.add(line);

  // gantry
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 10, 0.9), postMat);
    post.position.set(sx * (ROAD_HALF + 2.6), 5, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF + 2.6) * 2 + 1, 2.4, 0.7), postMat);
  beam.position.y = 9.4;
  beam.castShadow = true;
  gantry.add(beam);

  const bc = document.createElement('canvas');
  bc.width = 1024; bc.height = 128;
  const bx = bc.getContext('2d');
  bx.fillStyle = '#0f172a'; bx.fillRect(0, 0, 1024, 128);
  bx.fillStyle = '#4ade80'; bx.font = '900 72px Trebuchet MS, sans-serif';
  bx.textAlign = 'center'; bx.textBaseline = 'middle';
  bx.fillText('LOWPOLY RACER', 512, 66);
  const btex = new THREE.CanvasTexture(bc);
  btex.anisotropy = maxAniso;
  btex.colorSpace = THREE.SRGBColorSpace;
  const bannerMat = new THREE.MeshBasicMaterial({ map: btex });
  for (const sz of [0.37, -0.37]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry((ROAD_HALF + 2.6) * 2, 2.1), bannerMat);
    banner.position.set(0, 9.4, sz);
    if (sz < 0) banner.rotation.y = Math.PI;
    gantry.add(banner);
  }
  gantry.position.copy(centerPts[0]);
  gantry.rotation.y = Math.atan2(tangents[0].x, tangents[0].z);
  scene.add(gantry);
}

// ---------- Vegetation & rocks (instanced) ----------
function scatter(count, minOff, maxOff, place) {
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 40) {
    const a = Math.random() * Math.PI * 2;
    const baseR = trackRadius(a);
    const outside = Math.random() > 0.35;
    const off = minOff + Math.random() * (maxOff - minOff);
    const r = outside ? baseR + off : baseR - off;
    if (r < 45 || r > 600) continue;
    place(r * Math.cos(a), r * Math.sin(a), placed);
    placed++;
  }
  return placed;
}
{
  const COUNT = 150;
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.8, 3.4, 7),
    new THREE.MeshLambertMaterial({ color: 0x7c4a21 }), COUNT);
  const leafMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(3.2, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x2f7d32 }), COUNT);
  trunkMesh.castShadow = leafMesh.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const n = scatter(COUNT, ROAD_HALF + 24, ROAD_HALF + 190, (x, z, i) => {
    const s = 0.75 + Math.random() * 1.0;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 1.7 * s, z), q, new THREE.Vector3(s, s, s));
    trunkMesh.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, (3.4 + 3.6) * s, z), q, new THREE.Vector3(s, s, s));
    leafMesh.setMatrixAt(i, m);
  });
  trunkMesh.count = leafMesh.count = n;
  scene.add(trunkMesh, leafMesh);

  // bushes
  const BN = 70;
  const bushMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1.6, 1),
    new THREE.MeshLambertMaterial({ color: 0x3f9142, flatShading: true }), BN);
  bushMesh.castShadow = true;
  const bn = scatter(BN, ROAD_HALF + 8, ROAD_HALF + 120, (x, z, i) => {
    const s = 0.6 + Math.random() * 0.9;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0.9 * s, z), q, new THREE.Vector3(s, s * 0.75, s));
    bushMesh.setMatrixAt(i, m);
  });
  bushMesh.count = bn;
  scene.add(bushMesh);

  // rocks
  const RN = 45;
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.4, 0),
    new THREE.MeshLambertMaterial({ color: 0x8b93a0, flatShading: true }), RN);
  rockMesh.castShadow = true;
  const rn = scatter(RN, ROAD_HALF + 10, ROAD_HALF + 160, (x, z, i) => {
    const s = 0.5 + Math.random() * 1.3;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0.5 * s, z), q, new THREE.Vector3(s, s * 0.7, s));
    rockMesh.setMatrixAt(i, m);
  });
  rockMesh.count = rn;
  scene.add(rockMesh);
}

// mountains with snow caps
{
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d8fa8, flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const r = 640 + Math.random() * 100;
    const h = 110 + Math.random() * 110;
    const w = 80 + Math.random() * 70;
    const mtn = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), rockMat);
    mtn.position.set(r * Math.cos(a), h / 2 - 2, r * Math.sin(a));
    mtn.scale.set(w, h, w);
    mtn.rotation.y = Math.random() * Math.PI;
    scene.add(mtn);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), snowMat);
    cap.position.set(r * Math.cos(a), h - 2 - h * 0.16, r * Math.sin(a));
    cap.scale.set(w * 0.34, h * 0.32, w * 0.34);
    cap.rotation.y = mtn.rotation.y;
    scene.add(cap);
  }
}

// ---------- Cars (detailed) ----------
function buildCar(color, ghost) {
  const g = new THREE.Group();
  const mat = (c, opts = {}) => ghost
    ? new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.42, ...opts })
    : new THREE.MeshLambertMaterial({ color: c, ...opts });

  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    if (!ghost) mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  // chassis
  add(new THREE.BoxGeometry(2.2, 0.5, 4.4), mat(color), 0, 0.62, 0);
  // sloped hood
  add(new THREE.BoxGeometry(2.0, 0.28, 1.5), mat(color), 0, 0.78, 1.55, -0.16, 0, 0);
  // nose cone
  add(new THREE.BoxGeometry(1.9, 0.32, 0.9), mat(color), 0, 0.5, 2.6);
  // front splitter
  add(new THREE.BoxGeometry(2.3, 0.1, 0.5), mat(0x111827), 0, 0.32, 2.9);
  // racing stripe
  add(new THREE.BoxGeometry(0.55, 0.03, 4.0), mat(0xf8fafc), 0, 0.885, 0.2);
  // side skirts
  for (const sx of [-1.12, 1.12]) add(new THREE.BoxGeometry(0.16, 0.22, 3.4), mat(0x111827), sx, 0.4, 0);
  // cockpit + windshield
  add(new THREE.BoxGeometry(1.7, 0.5, 1.7), mat(0x141a24), 0, 1.05, -0.5);
  add(new THREE.BoxGeometry(1.6, 0.42, 0.9), mat(0x9fc8e8, { transparent: !ghost, opacity: ghost ? 0.42 : 0.75 }), 0, 1.02, 0.55, -0.35, 0, 0);
  // driver helmet
  add(new THREE.SphereGeometry(0.3, 10, 8), mat(0xfbbf24), 0, 1.15, -0.55);
  // mirrors
  for (const sx of [-1.15, 1.15]) {
    add(new THREE.BoxGeometry(0.3, 0.08, 0.08), mat(0x111827), sx * 0.92, 1.05, 0.25);
    add(new THREE.BoxGeometry(0.22, 0.18, 0.1), mat(0x111827), sx, 1.12, 0.25);
  }
  // rear wing + end plates + struts
  add(new THREE.BoxGeometry(2.4, 0.1, 0.65), mat(0x111827), 0, 1.5, -2.05);
  for (const sx of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.08, 0.5, 0.7), mat(0x111827), sx, 1.32, -2.05);
  for (const sx of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.12, 0.5, 0.25), mat(0x111827), sx, 1.15, -2.05);
  // rear diffuser
  add(new THREE.BoxGeometry(2.0, 0.28, 0.5), mat(0x111827), 0, 0.4, -2.25);
  // exhausts
  for (const sx of [-0.4, 0.4]) {
    const ex = add(new THREE.CylinderGeometry(0.09, 0.11, 0.4, 8), mat(0x9ca3af), sx, 0.45, -2.5, Math.PI / 2, 0, 0);
    ex.castShadow = false;
  }
  // headlights
  for (const sx of [-0.65, 0.65]) {
    add(new THREE.BoxGeometry(0.44, 0.16, 0.08),
      ghost ? mat(0xfde68a) : new THREE.MeshBasicMaterial({ color: 0xfde68a }),
      sx, 0.62, 3.06);
  }
  // taillights
  for (const sx of [-0.65, 0.65]) {
    add(new THREE.BoxGeometry(0.44, 0.14, 0.08),
      ghost ? mat(0xef4444) : new THREE.MeshBasicMaterial({ color: 0xef4444 }),
      sx, 0.72, -2.21);
  }

  // wheels with rims
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.44, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const tireMat = mat(0x151515);
  const rimMat = mat(0xcbd5e1);
  for (const [sx, sz, front] of [[-1.08, 1.5, true], [1.08, 1.5, true], [-1.08, -1.5, false], [1.08, -1.5, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.46, sz);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    if (!ghost) { tire.castShadow = true; }
    pivot.add(tire, rim);
    g.add(pivot);
    wheels.push({ pivot, tire, rim, front });
  }

  // soft blob shadow (grounds the car even where the shadow map is coarse)
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: ghost ? 0.1 : 0.22, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.scale.set(0.72, 1.4, 1);
  g.add(blob);

  return { group: g, wheels };
}

const player = buildCar(0xe11d48, false);
scene.add(player.group);
const ghostCar = buildCar(0x38bdf8, true);
ghostCar.group.visible = false;
scene.add(ghostCar.group);

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
    const f = d.life / d.max;
    d.s.material.opacity = f * 0.55;
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
let state = 'menu'; // menu | countdown | racing | paused
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

    // drift / grass dust
    const drifting = input.drift && Math.abs(speed) > 14;
    if (drifting || (onGrass && Math.abs(speed) > 8)) {
      const lx = Math.cos(heading), lz = -Math.sin(heading);
      for (const s of [-1, 1]) {
        spawnDust(pos.x - fx * 1.6 + lx * 1.05 * s, 0.5, pos.z - fz * 1.6 + lz * 1.05 * s, 1.2);
      }
    }
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

  // --- sun follows car for crisp shadows ---
  sun.position.set(pos.x + 120, 190, pos.z + 70);
  sun.target.position.set(pos.x, 0, pos.z);
  sun.target.updateMatrixWorld();

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

  if (state === 'racing' || state === 'countdown') {
    update(dt, now);
  } else if (state === 'menu') {
    const t = now * 0.00004;
    const cx = centerPts[0];
    camera.position.set(cx.x + Math.cos(t) * 260, 120, cx.z + Math.sin(t) * 260);
    camera.lookAt(cx.x, 0, cx.z);
    if (engGain && audioCtx) engGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
    for (const c of clouds) {
      c.s.position.x += c.v * dt;
      if (c.s.position.x > 750) c.s.position.x = -750;
    }
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
