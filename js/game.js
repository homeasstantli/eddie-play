/* Eddie Simulator — 3D game logic (Claude owns this file). Uses global THREE (r147).
   Art: models/textures at the paths in ASSETS are used when present (needs an
   http server); otherwise placeholder shapes are built in code. */
(() => {
  'use strict';

  // ---------- Config ----------
  const SAVE_KEY = 'eddie-sim-v1';
  const AWAKE = { hunger: 0.03, fun: 0.04, energy: 0.02, clean: 0.015 };   // loss per second
  const ASLEEP = { hunger: 0.015, fun: 0.01, energy: -0.25, clean: 0.005 }; // negative = gain
  const OFFLINE_CAP = 8 * 3600, OFFLINE_FLOOR = 15;
  const MOODS = ['idle', 'happy', 'sad', 'sleepy', 'sleeping', 'eating'];
  const STATS = ['hunger', 'fun', 'energy', 'clean'];
  const BALL_R = 0.055, BALL_Z = 0.25;
  const MODEL_EXT = window.EDDIE_MODEL_EXT || '.glb'; // hosted preview uses .glb.json
  const ASSETS = {
    eddie: 'assets/models/eddie' + MODEL_EXT,
    room: 'assets/models/room' + MODEL_EXT,
    ball: 'assets/models/ball' + MODEL_EXT,
    face: (m) => `assets/textures/face_${m}.png`,
    fx: (k) => `assets/fx/${k}.png`,
  };
  const served = location.protocol !== 'file:';

  const now = () => performance.now();
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Save state ----------
  function freshState() {
    const now = Date.now();
    return { hunger: 80, fun: 80, energy: 80, clean: 80, asleep: false, best: 0, born: now, last: now };
  }
  function loadState() {
    try {
      if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(SAVE_KEY);
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved) return { ...freshState(), ...saved };
    } catch (e) { /* no storage or bad save */ }
    return freshState();
  }
  const S = loadState();
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} };

  function decay(seconds, offline) {
    const rates = S.asleep ? ASLEEP : AWAKE;
    for (const k of STATS) {
      const before = S[k];
      S[k] = clamp(S[k] - rates[k] * seconds);
      if (offline && rates[k] > 0) S[k] = Math.max(S[k], Math.min(before, OFFLINE_FLOOR));
    }
    if (S.asleep && S.energy >= 100) { S.asleep = false; say('Eddie woke up refreshed!', 3000); }
  }

  // ---------- DOM ----------
  const canvas = document.querySelector('#stage canvas');
  const speechEl = document.getElementById('speech');
  const scoreEl = document.getElementById('score');
  const ageEl = document.getElementById('age');
  const statEls = {};
  for (const k of STATS) statEls[k] = document.querySelector(`.stat[data-stat="${k}"]`);
  const buttons = {};
  document.querySelectorAll('button[data-action]').forEach((b) => { buttons[b.dataset.action] = b; });

  let speechTimer = 0, nextChatter = performance.now() + 6000;
  function say(text, ms = 2500) {
    speechEl.textContent = text;
    speechEl.hidden = false;
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => { speechEl.hidden = true; }, ms);
    nextChatter = performance.now() + rand(12000, 20000);
  }

  if (!window.THREE) {
    say('Could not load 3D engine. Check your internet connection.', 1e9);
    return;
  }

  // ---------- Three.js scene ----------
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false; // hex colors are sRGB
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const DAY_BG = new THREE.Color('#fdf6e3'), NIGHT_BG = new THREE.Color('#2b3045');
  scene.background = DAY_BG.clone();

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  camera.position.set(0, 0.3, 0.95);
  camera.lookAt(0, 0.13, 0);

  const hemi = new THREE.HemisphereLight('#fffaf0', '#b9a27a', 0.6);
  const sun = new THREE.DirectionalLight('#ffffff', 0.9);
  sun.position.set(0.6, 1.4, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 4 });
  scene.add(hemi, sun);

  // placeholder room
  const room = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2, 48), new THREE.MeshStandardMaterial({ color: '#e6d3ad', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const rug = new THREE.Mesh(new THREE.CircleGeometry(0.3, 48), new THREE.MeshStandardMaterial({ color: '#c5e1a5', roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.002;
  rug.receiveShadow = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ color: '#f6ead2', roughness: 1 }));
  wall.position.set(0, 1, -0.8);
  room.add(floor, rug, wall);
  scene.add(room);

  // ---------- Eddie ----------
  const eddie = new THREE.Group();        // animated transform
  scene.add(eddie);
  const GREEN = new THREE.Color('#8bc34a'), GRUBBY = new THREE.Color('#8d7a45');
  const podMat = new THREE.MeshStandardMaterial({ color: GREEN.clone(), roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#4f7f24', roughness: 0.7 });

  // face texture drawn in code (also used on a model's "Face" mesh if no PNGs exist)
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = faceCanvas.height = 256;
  const fctx = faceCanvas.getContext('2d');
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.encoding = THREE.sRGBEncoding;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
  const faceTextures = {};               // mood -> loaded PNG texture (model's "Face" mesh only)
  const pngFaceMat = new THREE.MeshBasicMaterial({ transparent: true });

  const placeholder = new THREE.Group();
  for (const x of [-0.085, 0, 0.085]) {
    const bean = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 24), podMat);
    bean.position.set(x, 0.09, 0);
    bean.scale.z = 0.8;
    bean.castShadow = true;
    placeholder.add(bean);
  }
  for (const x of [-0.05, 0.05]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), darkMat);
    foot.position.set(x, 0.012, 0.02);
    foot.scale.y = 0.5;
    foot.castShadow = true;
    placeholder.add(foot);
  }
  const stem = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16, Math.PI), darkMat);
  stem.position.set(0.16, 0.12, 0);
  stem.rotation.z = -0.6;
  placeholder.add(stem);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), faceMat);
  face.position.set(0, 0.09, 0.062);
  placeholder.add(face);
  eddie.add(placeholder);

  let mixer = null, clips = {}, currentClip = null, modelFace = null;
  const tinted = [];                    // model materials + original colors

  // ---------- Ball ----------
  let ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#ff8a65', roughness: 0.4 }));
  ballMesh.castShadow = true;
  ballMesh.visible = false;
  scene.add(ballMesh);
  let ball = null;                       // {x, y, vx, vy, score}

  // ---------- Optional assets ----------
  if (served && THREE.GLTFLoader) {
    const loader = new THREE.GLTFLoader();
    // .glb.json = {"glb": base64} for hosts that don't serve .glb files
    const gltf = {
      load(url, onLoad, _, onError) {
        if (!url.endsWith('.glb.json')) return loader.load(url, onLoad, undefined, onError);
        fetch(url).then((r) => r.json()).then(({ glb }) => {
          const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
          loader.parse(bytes.buffer, '', onLoad, onError);
        }).catch(onError);
      },
    };
    const shadows = (obj) => obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    gltf.load(ASSETS.eddie, (g) => {
      eddie.remove(placeholder);
      shadows(g.scene);
      g.scene.position.y = 0.003;        // stand on the rug, not in it
      eddie.add(g.scene);
      modelFace = g.scene.getObjectByName('Face');
      // tint the model's materials when Eddie gets grubby
      g.scene.traverse((o) => {
        if (o.isMesh && o.material.color && !tinted.some((t) => t.mat === o.material)) {
          tinted.push({ mat: o.material, base: o.material.color.clone() });
        }
      });
      // No Face mesh: hide the model's static face and put the drawn,
      // mood-changing face on the front of the middle bean instead.
      const bean = g.scene.getObjectByName('Bean_1');
      if (!modelFace && bean) {
        g.scene.traverse((o) => { if (/^(Eye|Glint|Smile|Cheek)/.test(o.name)) o.visible = false; });
        g.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(bean);
        const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        face.position.set(c.x, c.y, box.max.z + 0.003);
        face.scale.setScalar(size.x / 0.12);
        eddie.add(face);
      }
      if (g.animations.length) {
        mixer = new THREE.AnimationMixer(g.scene);
        for (const c of g.animations) clips[c.name] = mixer.clipAction(c);
      }
    }, undefined, () => {});
    gltf.load(ASSETS.room, (g) => { scene.remove(room); shadows(g.scene); scene.add(g.scene); }, undefined, () => {});
    gltf.load(ASSETS.ball, (g) => {
      scene.remove(ballMesh);
      shadows(g.scene);
      // model is 0.12 m with its origin at the bottom; centre it and match BALL_R
      const k = (BALL_R * 2) / 0.12;
      g.scene.scale.setScalar(k);
      g.scene.position.y = -BALL_R;
      ballMesh = new THREE.Group();
      ballMesh.add(g.scene);
      ballMesh.visible = false;
      scene.add(ballMesh);
    }, undefined, () => {});
    const tl = new THREE.TextureLoader();
    for (const m of MOODS) {
      tl.load(ASSETS.face(m), (t) => {
        t.encoding = THREE.sRGBEncoding;
        t.flipY = false;                 // glTF UV convention
        faceTextures[m] = t;
      }, undefined, () => {});
    }
  }

  // ---------- Particles (sprites) ----------
  const GLYPH = { heart: ['♥', '#ff6f91'], bubble: ['○', '#7ec8e3'], crumb: ['■', '#c9a26b'], z: ['z', '#8a9cff'] };
  const fxTex = {};
  for (const [k, [ch, color]] of Object.entries(GLYPH)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.font = 'bold 52px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(ch, 32, 34);
    fxTex[k] = new THREE.CanvasTexture(c);
    if (served) new THREE.TextureLoader().load(ASSETS.fx(k), (t) => { fxTex[k] = t; }, undefined, () => {});
  }
  let particles = [];
  function spawn(kind, x, y, z, vx, vy) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex[kind], transparent: true, depthWrite: false }));
    const size = kind === 'crumb' ? 0.014 : 0.035;
    s.scale.set(size, size, size);
    s.position.set(x, y, z);
    scene.add(s);
    particles.push({ kind, s, vx, vy, life: 0, max: kind === 'z' ? 2.4 : 1.2 });
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      if (p.kind === 'crumb') p.vy -= 0.9 * dt;
      p.s.position.x += p.vx * dt + (p.kind === 'z' ? Math.sin(p.life * 3) * 0.0008 : 0);
      p.s.position.y += p.vy * dt;
      p.s.material.opacity = 1 - p.life / p.max;
      if (p.life >= p.max) { scene.remove(p.s); p.s.material.dispose(); }
    }
    particles = particles.filter((p) => p.life < p.max);
  }

  // ---------- HUD ----------
  const fx = { eatUntil: 0, happyUntil: 0, bathUntil: 0, wiggle: 0 };
  function updateHud() {
    for (const k of STATS) {
      statEls[k].querySelector('.fill').style.width = S[k].toFixed(1) + '%';
      statEls[k].classList.toggle('low', S[k] < 25);
    }
    ageEl.textContent = `Day ${Math.floor((Date.now() - S.born) / 86400000) + 1}`;
    const busy = performance.now() < fx.bathUntil || !!ball;
    buttons.feed.disabled = buttons.play.disabled = buttons.bath.disabled = S.asleep || busy;
    buttons.sleep.disabled = busy;
    buttons.sleep.textContent = S.asleep ? 'Wake' : 'Sleep';
    document.body.classList.toggle('asleep', S.asleep);
    scoreEl.hidden = !ball;
    if (ball) scoreEl.textContent = ball.score;
  }

  // ---------- Actions ----------
  const SNACKS = ['a dumpling', 'a rice ball', 'some miso soup', 'a sesame cracker', 'a slice of tofu'];
  const actions = {
    feed() {
      if (S.hunger > 95) return say("I'm full!");
      S.hunger = clamp(S.hunger + 25);
      fx.eatUntil = performance.now() + 1600;
      for (let i = 0; i < 12; i++) spawn('crumb', rand(-0.03, 0.03), 0.1, 0.09, rand(-0.12, 0.12), rand(0.05, 0.25));
      say(`Nom! Eddie ate ${pick(SNACKS)}.`);
    },
    play() {
      if (S.energy < 15) return say('Too sleepy to play...');
      ball = { x: rand(-0.1, 0.1), y: 0.5, vx: rand(-0.08, 0.08), vy: 0, score: 0 };
      say('Tap anywhere to bounce the ball!', 2200);
    },
    bath() { fx.bathUntil = performance.now() + 2500; say('Splish splash!'); },
    sleep() { S.asleep = !S.asleep; say(S.asleep ? 'Goodnight, Eddie.' : 'Good morning!'); },
  };
  for (const [name, btn] of Object.entries(buttons)) {
    btn.addEventListener('click', () => { actions[name](); updateHud(); save(); });
  }

  // ---------- Pointer: petting + ball taps ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointer = null;                    // {px, py, world, petting, travel}

  function pointerInfo(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    ndc.set(px / r.width * 2 - 1, -(py / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(eddie, true)[0];
    // world point on the plane the ball moves in, for Eddie's gaze
    const t = (BALL_Z - raycaster.ray.origin.z) / raycaster.ray.direction.z;
    const world = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t);
    return { px, py, rect: r, hit, world };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const info = pointerInfo(e);
    canvas.setPointerCapture(e.pointerId);
    pointer = { px: info.px, py: info.py, world: info.world, petting: false, travel: 0 };
    // Easy mode: during Play a tap anywhere bounces the ball, as long as it
    // wasn't just tapped (stops tap-spamming for points).
    if (ball) {
      if (now() - (ball.lastTap || 0) < 350) return;
      ball.lastTap = now();
      ball.vy = 1.25;
      ball.vx = Math.max(-0.25, Math.min(0.25, (ball.x - info.world.x) * 1.5));
      ball.score++;
      S.fun = clamp(S.fun + 4);
      S.energy = clamp(S.energy - 1.2);
      spawn('heart', ball.x, ball.y, BALL_Z, rand(-0.05, 0.05), 0.1);
      return;
    }
    if (info.hit) {
      if (S.asleep) return say('Zzz...');
      pointer.petting = true;
      fx.wiggle = 1;
      S.fun = clamp(S.fun + 2);
      spawn('heart', info.hit.point.x, info.hit.point.y + 0.02, info.hit.point.z + 0.02, rand(-0.04, 0.04), 0.12);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer) return;
    const info = pointerInfo(e);
    if (pointer.petting && info.hit) {
      pointer.travel += Math.hypot(info.px - pointer.px, info.py - pointer.py);
      if (pointer.travel > 30) {
        pointer.travel = 0;
        S.fun = clamp(S.fun + 1.5);
        fx.wiggle = 1;
        fx.happyUntil = performance.now() + 900;
        spawn('heart', info.hit.point.x, info.hit.point.y + 0.02, info.hit.point.z + 0.02, rand(-0.04, 0.04), 0.12);
      }
    }
    Object.assign(pointer, { px: info.px, py: info.py, world: info.world });
  });
  const endPointer = () => { pointer = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // ---------- Simulation ----------
  function mood(now) {
    if (S.asleep) return 'sleeping';
    if (now < fx.eatUntil) return 'eating';
    if (now < fx.happyUntil || now < fx.bathUntil) return 'happy';
    const low = Math.min(S.hunger, S.fun, S.clean);
    if (S.energy < 25 && S.energy <= low) return 'sleepy';
    if (low < 25) return 'sad';
    if ((S.hunger + S.fun + S.energy + S.clean) / 4 > 70) return 'happy';
    return 'idle';
  }

  function chatter() {
    if (S.asleep) return;
    if (S.hunger < 35) return say("I'm hungry...");
    if (S.energy < 30) return say('*yawn*');
    if (S.clean < 35) return say('I feel grubby.');
    if (S.fun < 35) return say('Play with me?');
    say(pick(["Hi! I'm Eddie!", 'Beans together, beans forever.', 'Rub my pod!', 'Edamame-zing!', 'What a nice day.']));
  }

  function step(dt, now) {
    decay(dt, false);
    if (now < fx.bathUntil) {
      S.clean = clamp(S.clean + 40 * dt);
      if (Math.random() < dt * 14) spawn('bubble', rand(-0.18, 0.18), rand(0.02, 0.22), rand(0, 0.1), rand(-0.02, 0.02), rand(0.04, 0.09));
    }
    if (S.asleep && Math.random() < dt * 0.8) spawn('z', 0.08, 0.22, 0.05, 0.015, 0.05);
    fx.wiggle = Math.max(0, fx.wiggle - dt * 2.5);

    if (ball) {
      ball.vy -= 1.2 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (Math.abs(ball.x) > 0.4) { ball.x = Math.sign(ball.x) * 0.4; ball.vx *= -1; }
      if (ball.y > 0.62) { ball.y = 0.62; ball.vy = -Math.abs(ball.vy) * 0.5; }
      // bounce on the floor, losing a bit of height each time;
      // the round ends once the ball has almost stopped bouncing
      if (ball.y <= BALL_R && ball.vy < 0) {
        ball.y = BALL_R;
        ball.vy = -ball.vy * 0.7;
        ball.vx *= 0.8;
      }
      if (ball && ball.y <= BALL_R + 0.001 && ball.vy < 0.35) {
        const score = ball.score;
        ball = null;
        if (score > S.best) { S.best = score; say(`New best: ${score}!`, 3000); }
        else say(`Score: ${score}  (best ${S.best})`, 3000);
        if (score >= 3) fx.happyUntil = now + 1500;
      }
    }
    if (now > nextChatter) chatter();
    updateParticles(dt);
  }

  // ---------- Face drawing (placeholder expressions) ----------
  function drawFace(m, t) {
    const c = fctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 256, 256);
    c.setTransform(2, 0, 0, 2, 128, 128);
    let lx = 0, ly = 0;
    const target = ball ? { x: ball.x, y: ball.y } : (pointer && pointer.world);
    if (target && m !== 'sleeping') {
      const dx = target.x, dy = target.y - 0.11, d = Math.hypot(dx, dy) || 1;
      lx = dx / d * 3; ly = -dy / d * 3;
    }
    const ex = 24, ey = -8, my = 16;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.strokeStyle = c.fillStyle = '#2b2b2b';
    c.fillStyle = 'rgba(255,120,140,0.45)';
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 40, 10, 11, 6, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#2b2b2b';
    const arc = (x, y, r, a0, a1) => { c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke(); };
    const line = (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };

    if (m === 'happy' || m === 'eating') {
      for (const s of [-1, 1]) arc(s * ex, ey + 4, 8, Math.PI * 1.1, Math.PI * 1.9);
    } else if (m === 'sleeping') {
      for (const s of [-1, 1]) arc(s * ex, ey - 2, 8, Math.PI * 0.15, Math.PI * 0.85);
    } else if (m === 'sleepy') {
      for (const s of [-1, 1]) { line(s * ex - 8, ey, s * ex + 8, ey); c.beginPath(); c.arc(s * ex, ey, 6, 0, Math.PI); c.fill(); }
    } else if (t % 4 < 0.12) {
      for (const s of [-1, 1]) line(s * ex - 7, ey, s * ex + 7, ey);
    } else {
      for (const s of [-1, 1]) { c.beginPath(); c.arc(s * ex + lx, ey + ly, 7, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#fff';
      for (const s of [-1, 1]) { c.beginPath(); c.arc(s * ex + lx + 2, ey + ly - 2, 2.2, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#2b2b2b';
      if (m === 'sad') for (const s of [-1, 1]) line(s * (ex - 8), ey - 14, s * (ex + 8), ey - 10);
    }

    if (m === 'eating') { c.beginPath(); c.ellipse(0, my + 2, 9, 4 + Math.abs(Math.sin(t * 14)) * 7, 0, 0, Math.PI * 2); c.fill(); }
    else if (m === 'happy') { c.beginPath(); c.arc(0, my - 2, 11, 0, Math.PI); c.closePath(); c.fill(); }
    else if (m === 'sad') arc(0, my + 10, 9, Math.PI * 1.2, Math.PI * 1.8);
    else if (m === 'sleeping' || m === 'sleepy') { c.beginPath(); c.arc(0, my + 2, 4, 0, Math.PI * 2); c.fill(); }
    else arc(0, my - 4, 9, Math.PI * 0.2, Math.PI * 0.8);
    faceTex.needsUpdate = true;
  }

  // ---------- Rendering ----------
  let lastMood = '';
  function render(m, t, dt) {
    const sleeping = m === 'sleeping';
    const bob = sleeping ? Math.sin(t * 1.2) * 0.003 : Math.sin(t * 3) * 0.004;
    const hop = (m === 'happy' && performance.now() < fx.happyUntil) ? Math.abs(Math.sin(t * 9)) * 0.03 : 0;
    eddie.position.y = bob + hop;
    eddie.rotation.z = Math.sin(t * 28) * 0.07 * fx.wiggle;
    eddie.rotation.y = ball ? Math.max(-0.5, Math.min(0.5, ball.x * 1.5)) : eddie.rotation.y * 0.9;
    const sq = Math.sin(t * 3) * 0.015;
    eddie.scale.set(1 + sq, 1 - sq, 1 + sq);

    // expression: PNG face textures if provided, else the drawn face
    if (modelFace && faceTextures[m]) {
      pngFaceMat.map = faceTextures[m];
      modelFace.material = pngFaceMat;
      if (m !== lastMood) pngFaceMat.needsUpdate = true;
    } else {
      if (modelFace) modelFace.material = faceMat;
      drawFace(m, t);
    }
    if (mixer) {
      const next = clips[m] || clips.idle;
      if (next && next !== currentClip) {
        if (currentClip) currentClip.fadeOut(0.3);
        next.reset().fadeIn(0.3).play();
        currentClip = next;
      }
      mixer.update(dt);
    }
    lastMood = m;

    // dirt tint and day/night
    const dirt = Math.max(0, (40 - S.clean) / 40) * 0.6;
    podMat.color.lerpColors(GREEN, GRUBBY, dirt);
    for (const t of tinted) t.mat.color.lerpColors(t.base, GRUBBY, dirt);
    const night = S.asleep ? 1 : 0;
    scene.background.lerp(night ? NIGHT_BG : DAY_BG, Math.min(1, dt * 3));
    hemi.intensity += ((night ? 0.25 : 0.6) - hemi.intensity) * Math.min(1, dt * 3);
    sun.intensity += ((night ? 0.12 : 0.9) - sun.intensity) * Math.min(1, dt * 3);

    ballMesh.visible = !!ball;
    if (ball) { ballMesh.position.set(ball.x, ball.y, BALL_Z); ballMesh.rotation.z -= ball.vx * dt * 20; }

    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- Main loop ----------
  let lastSave = 0, lastHud = 0, lastFrame = performance.now();
  function frame(now) {
    const wall = Date.now();
    const away = (wall - S.last) / 1000;
    if (away > 5) decay(Math.min(away, OFFLINE_CAP), true);
    S.last = wall;
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    step(dt, now);
    render(mood(now), now / 1000, dt);
    if (now - lastHud > 200) { updateHud(); lastHud = now; }
    if (now - lastSave > 2000) { save(); lastSave = now; }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  updateHud();
  requestAnimationFrame(frame);
})();
