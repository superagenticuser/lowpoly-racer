import * as THREE from 'three';

// ============================================================
// Lowpoly Racer — 3D time-trial racing
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

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 150, 620);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.5, 2000);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a7c3a, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.35);
sun.position.set(150, 230, 80);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
    new THREE.CircleGeometry(750, 40),
    new THREE.MeshLambertMaterial({ color: 0x5da24f })
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.08;
  scene.add(g);
}

// road
{
  const geo = ribbonGeometry(offsetPts(ROAD_HALF), offsetPts(-ROAD_HALF), 1, null);
  const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3d434e }));
  road.position.y = 0.0;
  scene.add(road);
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
  const geo = ribbonGeometry(offsetPts(0.35), offsetPts(-0.35), SAMPLES / 5, null);
  const dashes = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  dashes.position.y = 0.02;
  scene.add(dashes);
}

// red/white curbs
{
  const red = new THREE.Color(0xd63c3c), white = new THREE.Color(0xf1f5f9);
  const colorFn = (i) => (Math.floor(i / 8) % 2 === 0 ? red : white);
  for (const side of [1, -1]) {
    const geo = ribbonGeometry(
      offsetPts(side * (ROAD_HALF + 1.7)),
      offsetPts(side * ROAD_HALF),
      1,
      colorFn
    );
    const curb = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    curb.position.y = 0.015;
    scene.add(curb);
  }
}

// start/finish line
{
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 32;
  const cx = cv.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    cx.fillStyle = (x + y) % 2 ? '#0f172a' : '#f8fafc';
    cx.fillRect(x * 16, y * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(cv);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 3),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(tangents[0].x, tangents[0].z);
  line.position.copy(centerPts[0]);
  line.position.y = 0.03;
  scene.add(line);
}

// trees (instanced)
{
  const COUNT = 70;
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.75, 3.2, 6);
  const leafGeo = new THREE.ConeGeometry(3.1, 7.5, 7);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7c4a21 }), COUNT);
  const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2f7d32 }), COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0, guard = 0;
  while (placed < COUNT && guard++ < 2000) {
    const a = Math.random() * Math.PI * 2;
    const baseR = trackRadius(a);
    const outside = Math.random() > 0.35;
    const off = ROAD_HALF + 24 + Math.random() * 150;
    const r = outside ? baseR + off : baseR - off;
    if (r < 40 || r > 560) continue;
    const x = r * Math.cos(a), z = r * Math.sin(a);
    const s = 0.7 + Math.random() * 0.9;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 1.6 * s, z), q, new THREE.Vector3(s, s, s));
    trunkMesh.setMatrixAt(placed, m);
    m.compose(new THREE.Vector3(x, (3.2 + 3.4) * s, z), q, new THREE.Vector3(s, s, s));
    leafMesh.setMatrixAt(placed, m);
    placed++;
  }
  trunkMesh.count = leafMesh.count = placed;
  scene.add(trunkMesh, leafMesh);
}

// distant mountains
{
  const geo = new THREE.ConeGeometry(1, 1, 5);
  const mat = new THREE.MeshLambertMaterial({ color: 0x7d8fa8, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
    const r = 600 + Math.random() * 90;
    const h = 90 + Math.random() * 90;
    const w = 70 + Math.random() * 60;
    const mtn = new THREE.Mesh(geo, mat);
    mtn.position.set(r * Math.cos(a), h / 2 - 2, r * Math.sin(a));
    mtn.scale.set(w, h, w);
    mtn.rotation.y = Math.random() * Math.PI;
    scene.add(mtn);
  }
}

// ---------- Cars ----------
function buildCar(color, ghost) {
  const g = new THREE.Group();
  const mat = (c) => ghost
    ? new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.42 })
    : new THREE.MeshLambertMaterial({ color: c });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 4.4), mat(color));
  body.position.y = 0.62;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.34, 1.0), mat(color));
  nose.position.set(0, 0.5, 2.55);
  g.add(nose);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.55, 1.9), mat(0x1e293b));
  cabin.position.set(0, 1.12, -0.35);
  g.add(cabin);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 0.62), mat(0x111827));
  wing.position.set(0, 1.28, -2.0);
  g.add(wing);
  for (const sx of [-0.8, 0.8]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.3), mat(0x111827));
    strut.position.set(sx, 1.0, -2.0);
    g.add(strut);
  }

  // headlights
  for (const sx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.1),
      ghost
        ? mat(0xfde68a)
        : new THREE.MeshBasicMaterial({ color: 0xfde68a })
    );
    lamp.position.set(sx, 0.62, 3.06);
    g.add(lamp);
  }

  // wheels (front pair steers)
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.42, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(0x151515);
  const wheels = [];
  for (const [sx, sz, front] of [[-1.05, 1.5, true], [1.05, 1.5, true], [-1.05, -1.5, false], [1.05, -1.5, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.44, sz);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    pivot.add(w);
    g.add(pivot);
    wheels.push({ pivot, mesh: w, front });
  }

  // blob shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: ghost ? 0.12 : 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.scale.set(0.72, 1.35, 1);
  g.add(shadow);

  return { group: g, wheels };
}

const player = buildCar(0xe11d48, false);
scene.add(player.group);
const ghostCar = buildCar(0x38bdf8, true);
ghostCar.group.visible = false;
scene.add(ghostCar.group);

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

const CP = [0.25, 0.5, 0.75];

function nearestRaw(p) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const dx = p.x - centerPts[i].x, dz = p.z - centerPts[i].z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  // fractional progress along segment best -> best+1
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
  player.group.position.copy(pos);
  player.group.rotation.y = heading;
  hudLap.textContent = '1';
  hudLast.textContent = '--:--.-';
  // snap camera behind car
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

    // ghost recording
    recTimer += dt;
    if (recTimer >= 0.08) {
      recTimer = 0;
      curRecording.push({ t: now - lapStart, x: pos.x, z: pos.z, h: heading });
    }

    // HUD
    hudTime.textContent = fmtLap(now - lapStart);
    hudSpeed.textContent = Math.round(Math.abs(speed) * 3.4);
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
      ghostCar.group.position.set(
        a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f
      );
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
    w.mesh.rotation.x += (speed * dt) / 0.44;
    if (w.front) w.pivot.rotation.y = input.steer * 0.42;
  }

  // --- engine sound ---
  if (engGain) {
    const target = state === 'racing' && soundOn ? 0.045 : 0;
    engGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.1);
    if (engOsc) engOsc.frequency.setTargetAtTime(65 + Math.abs(speed) * 3.6, audioCtx.currentTime, 0.08);
  }

  // --- chase camera ---
  const camBack = 10.5, camUp = 4.8;
  tmpV.set(pos.x - fx * camBack, camUp, pos.z - fz * camBack);
  camera.position.lerp(tmpV, 1 - Math.exp(-6 * dt));
  camera.lookAt(pos.x + fx * 7, 1.5, pos.z + fz * 7);
}

// ---------- Main loop ----------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 0.05);
  if (state === 'racing' || state === 'countdown') update(dt, now);
  else if (state === 'menu') {
    // slow orbit around the track for the menu backdrop
    const t = now * 0.00004;
    const cx = centerPts[0];
    camera.position.set(cx.x + Math.cos(t) * 260, 120, cx.z + Math.sin(t) * 260);
    camera.lookAt(cx.x, 0, cx.z);
    if (engGain && audioCtx) engGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
  }
  renderer.render(scene, camera);
}

// idle camera init
resetCarToStart();
requestAnimationFrame(loop);
