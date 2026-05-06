/**
 * GenerativeCanvas -- 有机生长可视化
 *
 * 基于声学帧序列 (f0 + rms) 生成纤维状放射生长图案，
 * 支持实时录音累积 + 存储录音回放两种数据来源。
 *
 * 渲染逻辑与原始 PhoneticVisualizer 完全一致。
 */

import { useEffect, useRef } from 'react';

// ==================== Types ====================

export interface AcousticFrame {
  f0: number;        // 归一化基频 0-1
  rms: number;       // 归一化能量 0-1
  timestamp: number; // Date.now()
}

export interface VisualConfig {
  accentColors: string[];
  theme: string; // 'earth' | 'bamboo' | 'water' | 'lion' | 'waves' | 'silver'
}

interface Props {
  frames: AcousticFrame[];
  config: VisualConfig;
  isActive: boolean;
  width?: number;
  height?: number;
}

// ==================== Theme & Color Mapping ====================

/** visualTag -> GenerativeCanvas theme */
const TAG_TO_THEME: Record<string, string> = {
  '黄土': 'earth',
  '竹林': 'bamboo',
  '流水': 'water',
  '醒狮': 'lion',
  '海浪': 'waves',
  '长鼓': 'earth',
  '呼麦': 'earth',
  '沙漠': 'earth',
  '哈达': 'silver',
  '银饰': 'silver',
  '迷雾': 'water',
};

/**
 * Hand-crafted accent color palettes per theme.
 * Each has 4-5 colors with significant hue diversity,
 * matching the original REGION_CONFIGS style.
 */
const THEME_PALETTES: Record<string, Record<string, string[]>> = {
  // region_id → [accentColor1, accentColor2, ...]
  // 北方官话区 — 赭石 · 黄土
  north_mandarin:     ['#A0503C', '#D4915A', '#6B8C42', '#C4A243', '#8B4513'],
  // 西南官话区 — 藤黄 · 竹林
  southwest_mandarin: ['#B8804A', '#7A9E4F', '#D4A853', '#5C8A52', '#C07938'],
  // 江南吴语区 — 石青 · 流水
  jiangnan_wu:        ['#5C8A99', '#3A6B7C', '#8FB8A0', '#4A9EAD', '#2C5F6E'],
  // 岭南粤语区 — 胭脂 · 醒狮
  lingnan_yue:        ['#9E5B6C', '#D4504A', '#C4A243', '#B8384B', '#E8915A'],
  // 闽台山海区 — 花青 · 海浪
  min_tai:            ['#4A7A8C', '#2E6B8A', '#6AADBD', '#3D8B7A', '#5BA4C0'],
  // 东北边陲 — 绢粉 · 长鼓
  northeast_frontier: ['#B08D84', '#9E6B5A', '#C4A090', '#7A6050', '#D4B8A0'],
  // 北部草原 — 草绿 · 呼麦
  north_grassland:    ['#6B8F5E', '#4A7A42', '#A0B858', '#8BAD6E', '#3C6830'],
  // 西域丝路 — 雌黄 · 沙漠
  western_silkroad:   ['#C4A243', '#D4B85A', '#A08030', '#E8C86A', '#8A6B20'],
  // 雪域高原 — 紫矿 · 哈达
  snow_highland:      ['#7A6B8A', '#5A4A7A', '#9E8AAE', '#B8A0C4', '#6858A0'],
  // 西南夷疆 — 铜绿 · 银饰
  southwest_frontier: ['#5A8F82', '#3A7A6A', '#8AB8A0', '#4A9E8A', '#2C6B5E'],
  // 无名之声 — 淡墨
  unknown_voice:      ['#8A7A6A', '#6E6050', '#A09080', '#B8A898', '#5A4E42'],
};

/** Build VisualConfig from region color + visualTag + regionId */
export function buildVisualConfig(colorTheme: string, visualTag?: string, regionId?: string): VisualConfig {
  const theme = TAG_TO_THEME[visualTag || ''] || 'earth';

  // Use hand-crafted palette if region is known
  if (regionId && THEME_PALETTES[regionId]) {
    return { accentColors: THEME_PALETTES[regionId], theme };
  }

  // Fallback: derive from hex with bold hue shifts
  const hex = colorTheme.startsWith('#') && colorTheme.length >= 7
    ? colorTheme.slice(0, 7)
    : '#8a7a6a';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  const rgb = (rr: number, gg: number, bb: number) => `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;

  return {
    accentColors: [
      hex,
      rgb(r + 70, g + 30, b - 30),
      rgb(r - 40, g + 50, b + 40),
      rgb(r + 30, g + 60, b - 10),
      rgb(r * 0.6, g * 0.5, b * 0.4),
    ],
    theme,
  };
}

// ==================== Data Converters ====================

/**
 * Convert stored AcousticResult arrays into AcousticFrame[]
 * for replaying saved recordings in the generative canvas.
 */
export function acousticArraysToFrames(
  f0Series: number[],
  energyContour: number[],
): AcousticFrame[] {
  const len = Math.max(f0Series.length, energyContour.length);
  if (len === 0) return [];
  const frames: AcousticFrame[] = [];
  const now = Date.now();
  for (let i = 0; i < len; i++) {
    frames.push({
      f0: i < f0Series.length ? f0Series[i] : 0,
      rms: i < energyContour.length ? energyContour[i] : 0,
      timestamp: now - (len - i) * 30,
    });
  }
  return frames;
}

// ==================== Component ====================

export default function GenerativeCanvas({
  frames,
  config,
  isActive,
  width = 640,
  height = 480,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkleBufferRef = useRef<{
    x: number; y: number; life: number; size: number;
    color: string; velX: number; velY: number;
  }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let frameId: number;

    const render = () => {
      const dw = canvas.offsetWidth;
      const dh = canvas.offsetHeight;
      if (dw === 0 || dh === 0) {
        frameId = requestAnimationFrame(render);
        return;
      }

      const w = canvas.width = dw * window.devicePixelRatio;
      const h = canvas.height = dh * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      const centerX = dw / 2;
      const centerY = dh / 2;

      ctx.clearRect(0, 0, dw, dh);

      if (frames.length < 2) {
        frameId = requestAnimationFrame(render);
        return;
      }

      const segments: AcousticFrame[][] = [];
      let currentSegment: AcousticFrame[] = [];
      const PAUSE_THRESHOLD = 300;
      for (let i = 0; i < frames.length; i++) {
        if (i > 0 && frames[i].timestamp - frames[i - 1].timestamp > PAUSE_THRESHOLD) {
          if (currentSegment.length > 0) segments.push(currentSegment);
          currentSegment = [];
        }
        currentSegment.push(frames[i]);
      }
      if (currentSegment.length > 0) segments.push(currentSegment);

      // --- THEMATIC ORGANIC GROWTH GENERATOR ---
      const now = Date.now();
      segments.forEach((segment, sIdx) => {
        if (segment.length < 2) return;

        const lastFrameTime = segment[segment.length - 1].timestamp;
        const age = now - lastFrameTime;
        const segmentAlpha = Math.max(0, 1 - age / 12000);
        if (segmentAlpha <= 0) return;

        // Radial distribution
        const baseAngle = (sIdx / segments.length) * Math.PI * 2 + (now * 0.00005);
        const angleSpread = (segment.length / frames.length) * Math.PI * 2 * 0.9;

        ctx.save();
        ctx.translate(centerX, centerY);

        // --- 1. GROWTH CORE (Layered Emissive Blobs) ---
        const coreSize = 40 + Math.sin(Date.now() * 0.004) * 12;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreSize * 3);
        grad.addColorStop(0, `${config.accentColors[0]}55`);
        grad.addColorStop(0.5, `${config.accentColors[1]}22`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, coreSize * 3, 0, Math.PI * 2);
        ctx.fill();

        // --- 2. DENSE FIBROUS PETALS (The "Colony" Look) ---
        const fiberCount = 90;
        for (let f = 0; f < fiberCount; f++) {
          ctx.beginPath();
          const subAngle = baseAngle + (f / fiberCount - 0.5) * angleSpread;

          // Color variation based on fiber index for richness
          const colorIdx = f % config.accentColors.length;
          const fiberColor = config.accentColors[colorIdx];

          ctx.strokeStyle = fiberColor;
          ctx.globalAlpha = 0.12 + (f / fiberCount) * 0.4;
          ctx.lineWidth = 0.6;
          ctx.setLineDash([Math.random() * 8, Math.random() * 4]);

          ctx.moveTo(0, 0);

          segment.forEach((frame, i) => {
            const p = i / segment.length;
            const rMax = 100 + (frame.f0 * 350);
            const r = rMax * (0.15 + 0.85 * p);

            const curveOffset = Math.sin(p * 4 + f * 0.2 + Date.now() * 0.002) * 40;
            const x = Math.cos(subAngle + (curveOffset / r)) * r;
            const y = Math.sin(subAngle + (curveOffset / r)) * r;

            ctx.lineTo(x, y);

            // Energy "Spores" — white glow nodes
            if (frame.rms > 0.22 && i % 10 === 0) {
              ctx.save();
              ctx.globalAlpha = frame.rms * 0.8 * segmentAlpha;
              ctx.shadowBlur = 15;
              ctx.shadowColor = fiberColor;
              ctx.fillStyle = '#fff';
              ctx.beginPath();
              ctx.arc(x, y, 2 + frame.rms * 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          });

          ctx.globalAlpha *= segmentAlpha;
          ctx.stroke();
        }

        // --- 3. THEMATIC HINTS ---
        if (config.theme === 'bamboo') {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha = 0.05;
          ctx.beginPath();
          ctx.arc(0, 0, 50, baseAngle - angleSpread / 2, baseAngle + angleSpread / 2);
          ctx.stroke();
        } else if (config.theme === 'waves' || config.theme === 'water') {
          ctx.strokeStyle = '#00BFFF';
          ctx.globalAlpha = 0.02;
          for (let j = 0; j < 5; j++) {
            ctx.beginPath();
            ctx.arc(0, 0, 100 + j * 20, baseAngle - angleSpread / 2, baseAngle + angleSpread / 2);
            ctx.stroke();
          }
        }

        ctx.restore();
      });

      // --- 4. GLOBAL ATMOSPHERE ---
      if (isActive && Math.random() > 0.7) {
        sparkleBufferRef.current.push({
          x: centerX + (Math.random() - 0.5) * 150,
          y: centerY + (Math.random() - 0.5) * 150,
          life: 1.0,
          size: 2 + Math.random() * 3,
          color: config.accentColors[Math.floor(Math.random() * config.accentColors.length)],
          velX: (Math.random() - 0.5) * 2,
          velY: (Math.random() - 0.5) * 2,
        });
      }

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      sparkleBufferRef.current = sparkleBufferRef.current.filter((s) => {
        s.life -= 0.015;
        s.x += s.velX;
        s.y += s.velY;
        ctx.globalAlpha = s.life * 0.6;
        ctx.fillStyle = s.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        return s.life > 0;
      });
      ctx.restore();

      // Subtle noise/grain
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, dw, dh);

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [frames, config, isActive]);

  return (
    <canvas
      ref={canvasRef}
      className="generative-canvas"
      style={{ width, height }}
    />
  );
}
