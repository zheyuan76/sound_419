/**
 * RegionBackground — 区域氛围底层
 *
 * 四层绘制：
 *   1. 纯黑底
 *   2. 颗粒噪点（胶片质感）
 *   3. 主题色幽灵渐变（极微弱色调暗示）
 *   4. 重度暗角（聚焦中心）
 */

import { useEffect, useRef } from 'react';
import type { VisualConfig } from './GenerativeCanvas';

interface Props {
  config: VisualConfig;
}

export default function RegionBackground({ config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      const h = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      const dw = canvas.offsetWidth;
      const dh = canvas.offsetHeight;

      // 1. Deep dark base
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, dw, dh);

      // 2. Subtle grain noise
      ctx.globalAlpha = 0.05;
      for (let i = 0; i < 3000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#111' : '#000';
        ctx.fillRect(Math.random() * dw, Math.random() * dh, 1.5, 1.5);
      }

      // 3. Thematic ghost gradient
      const centerX = dw / 2;
      const centerY = dh / 2;
      const spotGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, dw * 0.6);
      spotGrad.addColorStop(0, `${config.accentColors[0]}08`);
      spotGrad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 1;
      ctx.fillStyle = spotGrad;
      ctx.fillRect(0, 0, dw, dh);

      // 4. Heavy vignette
      const vignette = ctx.createRadialGradient(centerX, centerY, dw * 0.2, centerX, centerY, dw * 0.9);
      vignette.addColorStop(0, 'transparent');
      vignette.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, dw, dh);
    };

    render();
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, [config]);

  return (
    <canvas
      ref={canvasRef}
      className="region-bg-canvas"
    />
  );
}
