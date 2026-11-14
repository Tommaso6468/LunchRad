/**
 * A short confetti burst over the page for the final result. A canvas on top
 * of everything, ignored by screen readers and pointer events, removed after
 * the animation. Skipped completely with prefers-reduced-motion.
 * Randomness comes from crypto.getRandomValues (Math.random is banned here).
 */
const COLORS = ['#d7263d', '#e7a928', '#123029', '#ffe08a', '#2f8f6b', '#ffffff'];
const PIECES = 140;
const DURATION_MS = 2600;

function randoms(count: number): Float64Array {
  const raw = new Uint32Array(count);
  crypto.getRandomValues(raw);
  return Float64Array.from(raw, (v) => v / 0x1_0000_0000);
}

export function confettiBurst(): void {
  if (typeof document === 'undefined') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  // An open modal <dialog> sits in the top layer, above any z-index: draw inside it.
  (document.querySelector('dialog[open]') ?? document.body).append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const r = randoms(PIECES * 7);
  const pieces = Array.from({ length: PIECES }, (_, i) => {
    const o = i * 7;
    const angle = -Math.PI / 2 + ((r[o] ?? 0.5) - 0.5) * 1.6;
    const speed = 7 + (r[o + 1] ?? 0.5) * 9;
    return {
      x: width * (0.2 + (r[o + 2] ?? 0.5) * 0.6),
      y: height * 0.75,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + (r[o + 3] ?? 0.5) * 6,
      spin: ((r[o + 4] ?? 0.5) - 0.5) * 0.4,
      turn: (r[o + 5] ?? 0) * Math.PI,
      color: COLORS[Math.floor((r[o + 6] ?? 0) * COLORS.length)] ?? '#d7263d',
    };
  });

  const started = performance.now();
  const frame = (now: number) => {
    const t = now - started;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = t > DURATION_MS - 600 ? Math.max(0, (DURATION_MS - t) / 600) : 1;
    for (const p of pieces) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.turn += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
