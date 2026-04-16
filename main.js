/* global Hands, Camera, drawConnectors, drawLandmarks, HAND_CONNECTIONS */

(() => {
  const video = /** @type {HTMLVideoElement} */ (document.getElementById("video"));
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

  const overlay = document.getElementById("overlay");
  const errEl = document.getElementById("err");
  const startBtn = /** @type {HTMLButtonElement} */ (document.getElementById("startBtn"));
  const pauseOverlay = document.getElementById("pauseOverlay");
  const resumeBtn = /** @type {HTMLButtonElement} */ (document.getElementById("resumeBtn"));
  const restartBtn = /** @type {HTMLButtonElement} */ (document.getElementById("restartBtn"));

  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const timeEl = document.getElementById("time");

  const sens = /** @type {HTMLInputElement} */ (document.getElementById("sens"));
  const sensVal = document.getElementById("sensVal");
  const smooth = /** @type {HTMLInputElement} */ (document.getElementById("smooth"));
  const smoothVal = document.getElementById("smoothVal");
  const debug = /** @type {HTMLInputElement} */ (document.getElementById("debug"));
  const pauseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("pauseBtn"));
  const mirror = /** @type {HTMLInputElement} */ (document.getElementById("mirror"));

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "").trim();
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    const v = parseInt(h, 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function rgbToHex(r, g, b) {
    const to = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function mixHex(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.hypot(dx, dy);
  }

  function segmentPointDistance(ax, ay, bx, by, px, py) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLen2 = abx * abx + aby * aby || 1e-9;
    let t = (apx * abx + apy * aby) / abLen2;
    t = clamp(t, 0, 1);
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
  }

  function nowMs() {
    return performance.now();
  }

  function cssSize(el) {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  // Canvas sizing
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let width = 0;
  let height = 0;

  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const s = cssSize(canvas);
    width = Math.max(1, Math.floor(s.w));
    height = Math.max(1, Math.floor(s.h));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  // Settings
  let sensitivity = Number(sens.value); // px/s
  let smoothing = Number(smooth.value); // 0..0.95
  let showDebug = Boolean(debug.checked);
  let mirrorMode = mirror ? Boolean(mirror.checked) : true;
  sensVal.textContent = String(sensitivity);
  smoothVal.textContent = smoothing.toFixed(2);

  sens.addEventListener("input", () => {
    sensitivity = Number(sens.value);
    sensVal.textContent = String(sensitivity);
  });
  smooth.addEventListener("input", () => {
    smoothing = Number(smooth.value);
    smoothVal.textContent = Number(smoothing).toFixed(2);
  });
  debug.addEventListener("change", () => {
    showDebug = Boolean(debug.checked);
  });
  if (mirror) {
    mirror.addEventListener("change", () => {
      mirrorMode = Boolean(mirror.checked);
      video.style.transform = mirrorMode ? "scaleX(-1)" : "scaleX(1)";
    });
  }

  // Ensure initial video preview matches mirror mode.
  video.style.transform = mirrorMode ? "scaleX(-1)" : "scaleX(1)";

  // Game state
  const GAME_SECONDS = 60;
  const GRAVITY = 1200; // px/s^2
  const MISS_LINE = 60;

  let score = 0;
  let lives = 5;
  let gameStartAt = 0;
  let gameOver = false;
  let started = false;
  let paused = false;
  let pausedAt = 0;

  /** @type {{id:string,type:'fruit'|'bomb'|'piece',x:number,y:number,vx:number,vy:number,r:number,color:string,spin:number,rot:number, sliced?:boolean, parentId?:string, generation?:number}[]} */
  let fruits = [];
  /** @type {{x:number,y:number,vx:number,vy:number,life:number,size:number,color:string}[]} */
  let particles = [];

  // Hand tracking state
  /** @type {{x:number,y:number,t:number} | null} */
  let tip = null;
  /** @type {{x:number,y:number,t:number} | null} */
  let tipPrev = null;
  /** @type {{x:number,y:number,t:number}[]} */
  let trail = [];
  /** @type {any[] | null} */
  let lastLandmarks = null;

  // MediaPipe instances
  let hands = null;
  let camera = null;

  // Audio (very small, no asset)
  /** @type {AudioContext | null} */
  let audioCtx = null;

  function beep(freq, durationMs, gain = 0.06) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + durationMs / 1000);
    } catch {
      // ignore audio failures
    }
  }

  function setError(text) {
    if (!errEl) return;
    errEl.textContent = text || "";
  }

  function resetGame() {
    score = 0;
    lives = 5;
    fruits = [];
    particles = [];
    gameStartAt = nowMs();
    gameOver = false;
    paused = false;
    pausedAt = 0;
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    const left = started ? Math.max(0, GAME_SECONDS - (nowMs() - gameStartAt) / 1000) : GAME_SECONDS;
    timeEl.textContent = String(Math.ceil(left));
  }

  function endGame(reason) {
    gameOver = true;
    started = false;
    paused = false;
    if (overlay) overlay.style.display = "grid";
    if (pauseOverlay) pauseOverlay.style.display = "none";
    startBtn.textContent = "Restart";
    setError(reason || "");
  }

  function setPaused(next) {
    if (!started || gameOver) return;
    if (paused === next) return;
    paused = next;
    if (paused) {
      pausedAt = nowMs();
      if (pauseOverlay) pauseOverlay.style.display = "grid";
      if (pauseBtn) pauseBtn.textContent = "Resume";
    } else {
      const d = nowMs() - pausedAt;
      // Move start time forward so the countdown stays frozen during pause.
      gameStartAt += d;
      if (pauseOverlay) pauseOverlay.style.display = "none";
      if (pauseBtn) pauseBtn.textContent = "Pause";
    }
  }

  function restartRun() {
    resetGame();
    if (overlay) overlay.style.display = "none";
    if (pauseOverlay) pauseOverlay.style.display = "none";
    started = true;
    gameStartAt = nowMs();
    spawnAcc = 0;
    lastFrameAt = nowMs();
  }

  function fruitColor() {
    // Muted, more "fruit-like" palette (avoid neon feel).
    return pick(["#d94a4a", "#f08c2e", "#e7c74f", "#3fbf7f", "#4b83d9", "#8e63c7", "#e06a93"]);
  }

  function spawnFruit() {
    const isBomb = Math.random() < 0.08;
    // Bigger fruit to feel easier and less "pixel hunting".
    const r = isBomb ? rand(28, 38) : rand(38, 58);
    const x = rand(width * 0.1, width * 0.9);
    const y = height + r + 10;
    const vx = rand(-180, 180);
    // Throw higher so average trajectory crosses screen midline.
    const vy = rand(-1280, -880);
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    fruits.push({
      id,
      type: isBomb ? "bomb" : "fruit",
      x,
      y,
      vx,
      vy,
      r,
      color: isBomb ? "#111827" : fruitColor(),
      spin: rand(-3.8, 3.8),
      rot: rand(0, Math.PI * 2),
      sliced: false,
      generation: 0,
    });
  }

  function addParticles(x, y, color, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 520) * power;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.25, 0.55),
        size: rand(2, 5),
        color,
      });
    }
  }

  function sliceFruit(f, p0, p1) {
    if (f.sliced) return;
    f.sliced = true;

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const n = Math.hypot(dx, dy) || 1;
    const nx = dx / n;
    const ny = dy / n;

    if (f.type === "bomb") {
      beep(110, 160, 0.08);
      addParticles(f.x, f.y, "#ff4d4d", 40, 1.15);
      lives = Math.max(0, lives - 1);
      if (lives <= 0) {
        endGame("Boom! 你切到炸弹了。");
      }
      return;
    }

    const gen = f.generation || 0;
    // Higher-pitched beep for secondary slices.
    beep(780 + gen * 220, 90, 0.05);
    score += 1;
    // Fewer particles for smaller pieces.
    const pCount = Math.max(8, Math.round(26 * Math.pow(0.6, gen)));
    addParticles(f.x, f.y, f.color, pCount, 0.95);

    const nextGen = gen + 1;
    const MAX_GENERATION = 2;
    const MIN_PIECE_RADIUS = 12;
    const pr = Math.max(MIN_PIECE_RADIUS, f.r * 0.62);
    const push = 180;
    const vbase = 0.4;
    const px = -ny;
    const py = nx;

    // Only spawn sub-pieces if we haven't hit the generation limit
    // and the resulting pieces would be large enough.
    const canSplit = nextGen <= MAX_GENERATION && f.r * 0.62 >= MIN_PIECE_RADIUS;

    if (canSplit) {
      const pieceA = {
        id: `${f.id}_a`,
        parentId: f.id,
        type: "piece",
        x: f.x + px * 6,
        y: f.y + py * 6,
        vx: f.vx * vbase + px * push,
        vy: f.vy * vbase + py * push,
        r: pr,
        color: f.color,
        spin: f.spin * 1.3,
        rot: f.rot,
        sliced: false,
        generation: nextGen,
      };
      const pieceB = {
        id: `${f.id}_b`,
        parentId: f.id,
        type: "piece",
        x: f.x - px * 6,
        y: f.y - py * 6,
        vx: f.vx * vbase - px * push,
        vy: f.vy * vbase - py * push,
        r: pr,
        color: f.color,
        spin: -f.spin * 1.3,
        rot: f.rot,
        sliced: false,
        generation: nextGen,
      };
      fruits.push(pieceA, pieceB);
    }
  }

  function updateFruits(dt) {
    for (const f of fruits) {
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
    }

    // Missed fruit
    for (const f of fruits) {
      if (f.type !== "fruit") continue;
      if (f.sliced) continue;
      if (f.y > height + f.r + MISS_LINE) {
        f.sliced = true; // prevent multiple penalties
        // Rule: only bombs consume lives; missed fruit just disappears.
        addParticles(clamp(f.x, 0, width), height - 8, "rgba(255,255,255,0.55)", 8, 0.7);
      }
    }

    fruits = fruits.filter((f) => {
      if (f.y > height + f.r + 140) return false;
      if (f.x < -240 || f.x > width + 240) return false;
      if (f.type === "fruit" && f.sliced) return false;
      if (f.type === "bomb" && f.sliced) return false;
      if (f.type === "piece" && f.sliced && f.y > height + f.r + 30) return false;
      if (f.type === "piece" && !f.sliced && f.y > height + f.r + 60) return false;
      return true;
    });
  }

  function updateParticles(dt) {
    particles = particles
      .map((p) => ({
        ...p,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vx: p.vx * Math.pow(0.08, dt) + 0,
        vy: p.vy * Math.pow(0.08, dt) + GRAVITY * 0.55 * dt,
        life: p.life - dt,
      }))
      .filter((p) => p.life > 0);
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(width * 0.5, height * 0.4, 80, width * 0.5, height * 0.4, Math.max(width, height) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0.0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function drawFruitShape(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);

    if (f.type === "bomb") {
      ctx.fillStyle = "#0b1020";
      ctx.beginPath();
      ctx.arc(0, 0, f.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Fuse
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-f.r * 0.2, -f.r * 0.85);
      ctx.quadraticCurveTo(-f.r * 0.1, -f.r * 1.2, f.r * 0.35, -f.r * 1.1);
      ctx.stroke();

      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(f.r * 0.35, -f.r * 1.1, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const base = f.color;
      const light = mixHex(base, "#ffffff", 0.22);
      const shadow = mixHex(base, "#000000", 0.28);
      const g = ctx.createRadialGradient(-f.r * 0.45, -f.r * 0.45, 8, 0, 0, f.r * 1.35);
      g.addColorStop(0, "rgba(255,255,255,0.88)");
      g.addColorStop(0.07, "rgba(255,255,255,0.55)");
      g.addColorStop(0.14, light);
      g.addColorStop(0.52, base);
      g.addColorStop(1, shadow);

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, f.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life * 2.2, 0, 1);
      ctx.fillStyle = p.color.replace(")", `, ${a})`).replace("rgb", "rgba");
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Glow
    ctx.strokeStyle = "rgba(210,226,255,0.20)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Core
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDebug() {
    if (!showDebug) return;
    if (!lastLandmarks || lastLandmarks.length === 0) return;

    // drawLandmarks expects un-mirrored canvas; we draw ourselves.
    const lms = lastLandmarks;
    ctx.save();
    ctx.fillStyle = "rgba(0,255,200,0.9)";
    for (const lm of lms) {
      const xNorm = mirrorMode ? 1 - lm.x : lm.x;
      const x = xNorm * width;
      const y = lm.y * height;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function tick(dt) {
    // Spawn rate slightly adapts with time.
    const t = started ? (nowMs() - gameStartAt) / 1000 : 0;
    // More forgiving spawn pacing (fewer concurrent fruits).
    const spawnInterval = clamp(920 - t * 2.4, 520, 920);
    return spawnInterval;
  }

  let lastFrameAt = nowMs();
  let spawnAcc = 0;

  function gameLoop() {
    const t = nowMs();
    const dt = clamp((t - lastFrameAt) / 1000, 0, 0.033);
    lastFrameAt = t;

    ctx.clearRect(0, 0, width, height);

    if (started && !gameOver && !paused) {
      spawnAcc += dt * 1000;
      const interval = tick(dt);
      while (spawnAcc >= interval) {
        spawnAcc -= interval;
        spawnFruit();
        if (Math.random() < 0.16) spawnFruit();
      }

      updateFruits(dt);
      updateParticles(dt);

      const timeLeft = GAME_SECONDS - (t - gameStartAt) / 1000;
      if (timeLeft <= 0) {
        endGame("Time up!");
      }
    }

    // Slicing
    if (tipPrev && tip && started && !gameOver && !paused) {
      const dtTip = Math.max(1e-3, (tip.t - tipPrev.t) / 1000);
      const spd = dist(tip.x, tip.y, tipPrev.x, tipPrev.y) / dtTip;
      if (spd >= sensitivity) {
        // Snapshot length so newly-pushed pieces from sliceFruit are not
        // visited in the same frame (prevents instant chain-slicing).
        const len = fruits.length;
        for (let i = 0; i < len; i++) {
          const f = fruits[i];
          if (f.sliced) continue;
          const d = segmentPointDistance(tipPrev.x, tipPrev.y, tip.x, tip.y, f.x, f.y);
          // "Blade thickness" grows with speed to feel less strict.
          const speedBoost = clamp(spd / Math.max(1, sensitivity), 0.8, 2.4);
          const thick = 1.25 + (speedBoost - 1) * 0.12;
          if (d <= f.r * thick) sliceFruit(f, tipPrev, tip);
        }
      }
    }

    // Render
    for (const f of fruits) {
      if (f.type === "fruit" && f.sliced) continue;
      if (f.type === "bomb" && f.sliced) continue;
      drawFruitShape(f);
    }

    drawParticles();
    drawTrail();
    drawDebug();
    drawVignette();

    // cursor
    if (tip) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    updateHud();
    requestAnimationFrame(gameLoop);
  }

  function onResults(results) {
    const lms = results.multiHandLandmarks && results.multiHandLandmarks[0];
    lastLandmarks = lms || null;
    if (!lms) {
      tipPrev = tip;
      tip = null;
      trail = trail.filter((p) => nowMs() - p.t < 120);
      return;
    }

    const lm = lms[8]; // index finger tip
    const xNorm = mirrorMode ? 1 - lm.x : lm.x;
    const x = xNorm * width;
    const y = lm.y * height;

    const t = nowMs();
    tipPrev = tip;
    if (!tip) {
      tip = { x, y, t };
    } else {
      const s = clamp(smoothing, 0, 0.95);
      tip = {
        x: lerp(x, tip.x, s),
        y: lerp(y, tip.y, s),
        t,
      };
    }

    // Trail window: keep last ~180ms
    trail.push({ x: tip.x, y: tip.y, t });
    const cutoff = t - 180;
    while (trail.length > 2 && trail[0].t < cutoff) trail.shift();
  }

  async function start() {
    setError("");

    if (typeof Hands === "undefined" || typeof Camera === "undefined") {
      setError("MediaPipe Hands CDN 加载失败。请检查网络或稍后重试。");
      return;
    }

    try {
      // Restarting the run may sometimes leave the camera loop stale on some browsers.
      // Make restart idempotent by stopping old loops and rebuilding the Hands graph.
      try {
        if (camera && typeof camera.stop === "function") camera.stop();
      } catch {
        // ignore
      }
      try {
        if (hands && typeof hands.close === "function") hands.close();
      } catch {
        // ignore
      }

      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
        // Keep MediaPipe outputs un-mirrored; we manage mirroring ourselves
        // so that video preview and gesture coordinates always stay consistent.
        selfieMode: false,
      });
      hands.onResults(onResults);

      if (!camera) {
        camera = new Camera(video, {
          onFrame: async () => {
            if (!hands) return;
            await hands.send({ image: video });
          },
          width: 1280,
          height: 720,
        });
      }

      await camera.start();
      restartRun();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  startBtn.addEventListener("click", () => {
    start().catch((e) => setError(String(e)));
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => setPaused(!paused));
  }
  if (resumeBtn) resumeBtn.addEventListener("click", () => setPaused(false));
  if (restartBtn) restartBtn.addEventListener("click", () => start().catch((e) => setError(String(e))));

  window.addEventListener("keydown", (e) => {
    if ((e.target && /** @type {any} */ (e.target).tagName) === "INPUT") return;
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      setPaused(!paused);
    }
  });

  // Bootstrap loop
  requestAnimationFrame(gameLoop);
})();
