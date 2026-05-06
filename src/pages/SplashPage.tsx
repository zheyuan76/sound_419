import { useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import './SplashPage.css';

export default function SplashPage() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* 水墨粒子动画 */
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      cvs.width = window.innerWidth * dpr;
      cvs.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
      cvs.style.width = window.innerWidth + 'px';
      cvs.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);

    interface Ink { x: number; y: number; vx: number; vy: number; r: number; a: number; life: number }
    const drops: Ink[] = [];
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    // Ink colors — gold/warm tones for dark background
    const inkColors = ['201,169,110', '221,191,130', '138,122,82', '90,139,168'];

    const spawn = () => {
      if (drops.length > 80) return;
      const color = inkColors[Math.floor(Math.random() * inkColors.length)];
      drops.push({
        x: Math.random() * W(),
        y: Math.random() * H(),
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3 - 0.1,
        r: Math.random() * 30 + 10,
        a: Math.random() * 0.04 + 0.01,
        life: parseFloat(color.split(',')[0]) / 255, // abuse field for color index
      });
      // Store color as string on the object
      (drops[drops.length - 1] as Ink & { color: string }).color = color;
    };

    for (let i = 0; i < 40; i++) spawn();

    const draw = () => {
      // Semi-transparent clear for trail — dark
      ctx.fillStyle = 'rgba(12, 12, 12, 0.03)';
      ctx.fillRect(0, 0, W(), H());

      for (const d of drops) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < -50) d.x = W() + 50;
        if (d.x > W() + 50) d.x = -50;
        if (d.y < -50) d.y = H() + 50;
        if (d.y > H() + 50) d.y = -50;

        const color = (d as Ink & { color: string }).color || '44,44,44';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${d.a})`;
        ctx.fill();
      }

      if (Math.random() < 0.02) spawn();
      raf = requestAnimationFrame(draw);
    };

    // Initial clear
    ctx.fillStyle = '#0C0C0C';
    ctx.fillRect(0, 0, cvs.width / dpr, cvs.height / dpr);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="splash paper-bg">
      <canvas ref={canvasRef} className="splash-canvas" />

      {/* 装饰山水线条 */}
      <div className="splash-mountains" />

      <div className="splash-content">
        <div className="splash-stamp">语脉</div>
        <h1 className="splash-title">语脉图鉴</h1>
        <p className="splash-subtitle">SoundCalliFlow</p>
        <div className="splash-rule" />
        <p className="splash-desc">聆听方言 · 看见声音 · 探寻韵律</p>
        <button className="splash-enter" onClick={() => navigate('/select')}>
          开始体验
        </button>
      </div>

      {/* 底部装饰 */}
      <div className="splash-footer">
        <span>汉语方言语音可视化交互系统</span>
      </div>
    </div>
  );
}
