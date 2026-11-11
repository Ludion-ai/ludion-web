// part.js — canvas の動き。CLAUDE.md「動きの決まり」のとおりに作った見本
const LINES = 5;
const STILL = 1200; // reduced motion で描く時刻（いつも同じ絵になる）

export function mount(root) {
  const canvas = root.querySelector('.stage');
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(root);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let onScreen = true;

  const draw = (time) => {
    const ratio = canvas.width / canvas.clientWidth || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // 色は JS に書かず、根の --_* から読む
    ctx.fillStyle = style.getPropertyValue('--_bg').trim();
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = style.getPropertyValue('--_accent').trim();
    ctx.lineWidth = 2;
    for (let line = 0; line < LINES; line += 1) {
      ctx.globalAlpha = 1 - line / (LINES + 1);
      ctx.beginPath();
      for (let x = 0; x <= width; x += 6) {
        const y = height / 2 + Math.sin(x / 48 + time / 900 + line * 0.7) * (height / 3 - line * 8);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const loop = (time) => {
    draw(time);
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  // 動かしてよいときだけ動かす。reduced motion では1枚だけ描いて止める
  const sync = () => {
    stop();
    if (reduce.matches) draw(STILL);
    else if (onScreen && !document.hidden) frame = requestAnimationFrame(loop);
  };
  // devicePixelRatio は2まで
  const resize = () => {
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    sync();
  };

  const resizer = new ResizeObserver(resize);
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  resizer.observe(canvas);
  watcher.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', sync);
  resize();

  return () => {
    stop();
    resizer.disconnect();
    watcher.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reduce.removeEventListener('change', sync);
  };
}
