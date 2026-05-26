// Shared doc-page behaviors. Each script block guards on element presence so
// pages without the slider or particle canvas don't error.

// ──────────────── "On this page" scroll-spy ────────────────
(() => {
  const article = document.querySelector(".docs-article");
  const tocEl = document.getElementById("toc-list");
  if (!article || !tocEl) return;

  const headings = Array.from(article.querySelectorAll("h2[id], h3[id]"));
  if (headings.length === 0) {
    tocEl.parentElement.style.display = "none";
    return;
  }

  const frag = document.createDocumentFragment();
  for (const h of headings) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent.replace(/\s*\(beta\)\s*/i, "").trim();
    if (h.tagName === "H3") a.classList.add("toc-h3");
    li.appendChild(a);
    frag.appendChild(li);
  }
  tocEl.appendChild(frag);

  const links = Array.from(tocEl.querySelectorAll("a"));
  const linkById = new Map(
    links.map((a) => [a.getAttribute("href").slice(1), a]),
  );

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = linkById.get(entry.target.id);
        if (!link) continue;
        if (entry.isIntersecting) {
          links.forEach((l) => l.classList.remove("is-active"));
          link.classList.add("is-active");
        }
      }
    },
    { rootMargin: "-72px 0px -75% 0px", threshold: 0 },
  );
  headings.forEach((h) => observer.observe(h));
})();

// ──────────────── Screenshot slider (index only) ────────────────
(() => {
  const track = document.getElementById("slider-track");
  const dots = document.querySelectorAll(".slider-dot");
  if (!track || dots.length === 0) return;

  const SLIDE_COUNT = dots.length;
  const INTERVAL = 4000;
  let current = 0;
  let timer;

  function goTo(i) {
    current = i;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, j) => d.classList.toggle("active", j === current));
  }
  function next() {
    goTo((current + 1) % SLIDE_COUNT);
  }
  function startAuto() {
    clearInterval(timer);
    timer = setInterval(next, INTERVAL);
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      goTo(Number(dot.dataset.slide));
      startAuto();
    });
  });

  const wrap = track.parentElement;
  wrap.addEventListener("mouseenter", () => clearInterval(timer));
  wrap.addEventListener("mouseleave", startAuto);
  startAuto();
})();

// ──────────────── Particle background (index only) ────────────────
(() => {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const PARTICLE_COUNT = 70;
  const CONNECT_DIST = 140;
  const MOUSE_RADIUS = 180;
  const MOUSE_FORCE = 0.08;

  let w,
    h,
    particles,
    mouse = { x: -9999, y: -9999 },
    lastMouseMove = 0;
  let time = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function createParticle() {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 1.4 + 0.7,
      hue: 240 + Math.random() * 30,
      brightness: 0.25 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      waveSpeed: 0.003 + Math.random() * 0.004,
      waveAmp: 0.12 + Math.random() * 0.22,
      flash: 0,
    };
  }

  function triggerLightning() {
    const origin = particles[Math.floor(Math.random() * particles.length)];
    origin.flash = 1;
    for (const p of particles) {
      if (p === origin) continue;
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < CONNECT_DIST * 1.5) {
        p.flash = Math.max(p.flash, (1 - d / (CONNECT_DIST * 1.5)) * 0.8);
      }
    }
  }

  function init() {
    resize();
    particles = Array.from({ length: PARTICLE_COUNT }, createParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    time++;
    const idle = Date.now() - lastMouseMove > 2000;
    if (idle && Math.random() < 0.012) triggerLightning();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx + Math.sin(time * p.waveSpeed + p.phase) * p.waveAmp;
      p.y +=
        p.vy + Math.cos(time * p.waveSpeed * 0.7 + p.phase) * p.waveAmp * 0.6;
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
      p.vx *= 0.99;
      p.vy *= 0.99;

      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const cx = p.x - q.x;
        const cy = p.y - q.y;
        const cd = Math.sqrt(cx * cx + cy * cy);
        if (cd < CONNECT_DIST) {
          const alpha = (1 - cd / CONNECT_DIST) * 0.15;
          const midX = (p.x + q.x) / 2;
          const midY = (p.y + q.y) / 2;
          const mDist = Math.sqrt(
            (midX - mouse.x) ** 2 + (midY - mouse.y) ** 2,
          );
          const glow =
            mDist < MOUSE_RADIUS ? (1 - mDist / MOUSE_RADIUS) * 0.3 : 0;
          const flashGlow = Math.min(p.flash, q.flash);
          const lineAlpha = alpha + glow + flashGlow * 0.6;
          const lineLightness = 65 + flashGlow * 30;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `hsla(250, ${60 + flashGlow * 20}%, ${lineLightness}%, ${lineAlpha})`;
          ctx.lineWidth = 0.7 + flashGlow * 1.8;
          ctx.stroke();
        }
      }

      const pDist = Math.sqrt((p.x - mouse.x) ** 2 + (p.y - mouse.y) ** 2);
      const pGlow = pDist < MOUSE_RADIUS ? (1 - pDist / MOUSE_RADIUS) * 0.55 : 0;
      const pAlpha = p.brightness + pGlow + p.flash * 0.8;
      const pSize = p.r + pGlow * 1.8 + p.flash * 2.5;
      const pLight = 70 + p.flash * 25;
      if (p.flash > 0.3) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, pSize + p.flash * 7, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(250, 70%, 80%, ${p.flash * 0.13})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, pSize, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, ${55 + p.flash * 30}%, ${pLight}%, ${pAlpha})`;
      ctx.fill();
      p.flash *= 0.93;
    }
    requestAnimationFrame(draw);
  }

  document.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    lastMouseMove = Date.now();
  });
  document.addEventListener("mouseleave", () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });
  window.addEventListener("resize", resize);

  init();
  draw();
})();
