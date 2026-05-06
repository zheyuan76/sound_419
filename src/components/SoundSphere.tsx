/**
 * SoundSphere — 声学粒子球可视化
 *
 * 三通道映射：
 *   F0     → 纵向空间（y 偏移）
 *   Duration → 水平展开 + 疏密间距
 *   Energy  → 粒子大小 / 亮度 / 不透明度 / 发散距离
 *
 * 区域视觉语境：
 *   色彩主题 → 粒子色调
 *   纹理标记 → 背景纹理（底层）
 */

import { useEffect, useRef, useCallback } from 'react';
import type { AcousticResult } from '../utils/acoustics';

interface Props {
  /** 声学分析结果 */
  acoustics: AcousticResult | null;
  /** 区域主色（hex） */
  color: string;
  /** 区域纹理标记 */
  textureTag?: string;
  /** Canvas 宽 */
  width?: number;
  /** Canvas 高 */
  height?: number;
  /** 是否正在录音（实时 RMS 驱动） */
  isRecording?: boolean;
  /** 实时 RMS 值 (0-1) */
  liveRms?: number;
}

// ==================== Config ====================

const PARTICLE_COUNT = 600;
const SPHERE_RADIUS = 140;
const ROTATION_SPEED = 0.0008;
const BREATHE_SPEED = 0.002;
const NOISE_SCALE = 0.003;
const BASE_PARTICLE_SIZE = 2.2;

// ==================== Helpers ====================

/** Simple pseudo-random seeded noise (value noise) */
function hashNoise(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth noise with interpolation */
function smoothNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  // Smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  const n000 = hashNoise(ix, iy, iz);
  const n100 = hashNoise(ix + 1, iy, iz);
  const n010 = hashNoise(ix, iy + 1, iz);
  const n110 = hashNoise(ix + 1, iy + 1, iz);
  const n001 = hashNoise(ix, iy, iz + 1);
  const n101 = hashNoise(ix + 1, iy, iz + 1);
  const n011 = hashNoise(ix, iy + 1, iz + 1);
  const n111 = hashNoise(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + sx * (n100 - n000);
  const nx10 = n010 + sx * (n110 - n010);
  const nx01 = n001 + sx * (n101 - n001);
  const nx11 = n011 + sx * (n111 - n011);

  const nxy0 = nx00 + sy * (nx10 - nx00);
  const nxy1 = nx01 + sy * (nx11 - nx01);

  return nxy0 + sz * (nxy1 - nxy0);
}

/** Parse hex color to {r,g,b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  if (cleaned.length < 6) return { r: 160, g: 80, b: 60 };
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

/** Sample value from normalized array by fractional index */
function sampleArray(arr: number[], t: number): number {
  if (arr.length === 0) return 0.5;
  const idx = t * (arr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, arr.length - 1);
  const frac = idx - lo;
  return arr[lo] + frac * (arr[hi] - arr[lo]);
}

// ==================== Particle ====================

interface Particle {
  // Spherical coordinates (base)
  theta: number;  // azimuth [0, 2π]
  phi: number;    // polar [0, π]
  // Acoustic mapping index [0, 1]
  t: number;
  // Per-particle variation
  radiusOffset: number;
  phaseOffset: number;
  sizeJitter: number;
}

function createParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  // Fibonacci sphere distribution for even spacing
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);  // normalized time position
    const y = 1 - (2 * i) / (count - 1);  // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const phi = Math.acos(y);

    particles.push({
      theta,
      phi,
      t,
      radiusOffset: (Math.random() - 0.5) * 0.3,
      phaseOffset: Math.random() * Math.PI * 2,
      sizeJitter: 0.6 + Math.random() * 0.8,
    });
  }
  return particles;
}

// ==================== Texture Generators ====================

type TextureFn = (ctx: CanvasRenderingContext2D, W: number, H: number, color: { r: number; g: number; b: number }, time: number) => void;

const TEXTURE_GENERATORS: Record<string, TextureFn> = {
  '黄土': (ctx, W, H, col, time) => {
    // Granular dots — earthy texture
    for (let i = 0; i < 120; i++) {
      const x = (hashNoise(i * 3.7, time * 0.01, 0) * W);
      const y = (hashNoise(i * 5.3, time * 0.01, 1) * H);
      const r = 1 + hashNoise(i, 0, 2) * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.04)`;
      ctx.fill();
    }
  },
  '竹林': (ctx, W, H, col) => {
    // Vertical thin lines — bamboo
    for (let i = 0; i < 15; i++) {
      const x = (i / 15) * W + hashNoise(i, 0, 0) * 30;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + hashNoise(i, 1, 0) * 8, H);
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.03)`;
      ctx.lineWidth = 1 + hashNoise(i, 2, 0) * 1.5;
      ctx.stroke();
    }
  },
  '流水': (ctx, W, H, col, time) => {
    // Horizontal wavy lines — water flow
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      const baseY = (i / 10) * H;
      for (let x = 0; x < W; x += 4) {
        const y = baseY + Math.sin(x * 0.02 + time * 0.001 + i) * 8;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.025)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },
  '醒狮': (ctx, W, H, col) => {
    // Scattered small circles — festive dots
    for (let i = 0; i < 40; i++) {
      const x = hashNoise(i * 2.1, 0, 3) * W;
      const y = hashNoise(i * 3.3, 0, 4) * H;
      const r = 2 + hashNoise(i, 0, 5) * 4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.035)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  },
  '海浪': (ctx, W, H, col, time) => {
    // Layered wave arcs — ocean
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const baseY = H * 0.3 + i * 30;
      for (let x = 0; x < W; x += 3) {
        const y = baseY + Math.sin(x * 0.015 + i * 0.8 + time * 0.0008) * (12 + i * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.03)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  },
  '长鼓': (ctx, W, H, col) => {
    // Concentric ellipses — drum rings
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, i * 30, i * 20, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.025)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  },
  '呼麦': (ctx, W, H, col, time) => {
    // Horizontal drifting lines — throat singing harmonics
    for (let i = 0; i < 12; i++) {
      const y = (i / 12) * H;
      ctx.beginPath();
      for (let x = 0; x < W; x += 3) {
        const dy = Math.sin(x * 0.008 + i * 1.5 + time * 0.0005) * 15
          + Math.sin(x * 0.02 + i * 3) * 5;
        if (x === 0) ctx.moveTo(x, y + dy);
        else ctx.lineTo(x, y + dy);
      }
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.02)`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  },
  '沙漠': (ctx, W, H, col) => {
    // Diagonal drifting dots — sand particles
    for (let i = 0; i < 200; i++) {
      const x = hashNoise(i * 1.3, 0, 6) * W;
      const y = hashNoise(i * 2.7, 0, 7) * H;
      ctx.fillStyle = `rgba(${col.r}, ${col.g}, ${col.b}, ${0.02 + hashNoise(i, 0, 8) * 0.03})`;
      ctx.fillRect(x, y, 1, 1);
    }
  },
  '哈达': (ctx, W, H, col) => {
    // Flowing silk-like curves — khata scarf
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const startY = hashNoise(i, 0, 9) * H;
      ctx.moveTo(0, startY);
      ctx.bezierCurveTo(
        W * 0.3, startY + (hashNoise(i, 1, 9) - 0.5) * 80,
        W * 0.7, startY + (hashNoise(i, 2, 9) - 0.5) * 80,
        W, startY + (hashNoise(i, 3, 9) - 0.5) * 40
      );
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.025)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  },
  '银饰': (ctx, W, H, col) => {
    // Small geometric shapes — silver ornaments
    for (let i = 0; i < 30; i++) {
      const x = hashNoise(i * 2, 0, 10) * W;
      const y = hashNoise(i * 3, 0, 11) * H;
      const size = 3 + hashNoise(i, 0, 12) * 5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(hashNoise(i, 0, 13) * Math.PI);
      ctx.strokeStyle = `rgba(${col.r}, ${col.g}, ${col.b}, 0.03)`;
      ctx.lineWidth = 0.6;
      // Diamond
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  },
  '迷雾': (ctx, W, H, _col, time) => {
    // Soft radial gradients — fog
    for (let i = 0; i < 5; i++) {
      const x = hashNoise(i * 4, time * 0.0001, 14) * W;
      const y = hashNoise(i * 5, time * 0.0001, 15) * H;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 80);
      grad.addColorStop(0, `rgba(200, 200, 200, 0.03)`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  },
};

// ==================== Component ====================

export default function SoundSphere({
  acoustics,
  color,
  textureTag,
  width = 480,
  height = 480,
  isRecording = false,
  liveRms = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const timeRef = useRef(0);
  const liveRmsRef = useRef(0);

  liveRmsRef.current = liveRms;

  // Init particles once
  useEffect(() => {
    particlesRef.current = createParticles(PARTICLE_COUNT);
  }, []);

  const render = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const W = cvs.width;
    const H = cvs.height;
    const cx = W / 2;
    const cy = H / 2;
    const time = timeRef.current;
    const rgb = hexToRgb(color);

    // Clear
    ctx.clearRect(0, 0, W, H);

    // ===== Layer 0: Background texture (region visual context) =====
    const textureFn = TEXTURE_GENERATORS[textureTag || ''] || null;
    if (textureFn) {
      textureFn(ctx, W, H, rgb, time);
    }

    // ===== Layer 1: Sphere glow (ambient) =====
    const glowRadius = SPHERE_RADIUS * 1.6;
    const glow = ctx.createRadialGradient(cx, cy, SPHERE_RADIUS * 0.3, cx, cy, glowRadius);
    glow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
    glow.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.03)`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // ===== Layer 2: Particles =====
    const particles = particlesRef.current;
    const rotation = time * ROTATION_SPEED;
    const breathe = Math.sin(time * BREATHE_SPEED) * 0.08;

    // Prepare acoustic data samplers
    const hasAcoustics = acoustics && acoustics.f0Series.length > 0;
    const f0 = acoustics?.f0Series || [];
    const energy = acoustics?.energyContour || [];
    const durRatios = acoustics?.durationRatios || [];
    const durVoiced = acoustics?.durationVoiced || [];

    // Build cumulative duration positions for horizontal mapping
    let durCumulative: number[] = [];
    if (durRatios.length > 0) {
      let cum = 0;
      durCumulative = durRatios.map((r) => {
        cum += r;
        return cum;
      });
    }

    // Sort by depth (painter's algorithm)
    const projected: {
      x: number; y: number; z: number; size: number; alpha: number; p: Particle;
    }[] = [];

    for (const p of particles) {
      // === Acoustic mapping ===
      let f0Val = 0.5;       // default: center
      let energyVal = 0.5;   // default: medium
      let durationSpread = 1; // default: uniform

      if (hasAcoustics) {
        f0Val = sampleArray(f0, p.t);
        energyVal = sampleArray(energy, p.t);

        // Duration: voiced segments are denser, unvoiced are sparser
        if (durVoiced.length > 0 && durCumulative.length > 0) {
          // Find which segment this particle belongs to
          let segIdx = 0;
          for (let s = 0; s < durCumulative.length; s++) {
            if (p.t <= durCumulative[s]) { segIdx = s; break; }
          }
          const isVoiced = segIdx < durVoiced.length ? durVoiced[segIdx] : true;
          const segDuration = durRatios[segIdx] || 0.1;
          durationSpread = isVoiced ? (0.8 + segDuration * 2) : (1.5 + segDuration);
        }
      } else if (isRecording) {
        // Live recording mode: use live RMS for energy
        energyVal = Math.min(liveRmsRef.current * 6, 1);
        f0Val = 0.5 + (Math.sin(time * 0.003 + p.phaseOffset) * 0.2);
        durationSpread = 1 + energyVal * 0.5;
      }

      // === 3D sphere coordinates with acoustic modulation ===
      const theta = p.theta + rotation;
      // F0 → vertical displacement: shift phi based on pitch
      const f0Offset = (f0Val - 0.5) * 0.6;  // ±0.3 range
      const phi = p.phi + f0Offset;

      // Base radius with breathing and energy modulation
      const energyRadius = SPHERE_RADIUS * (0.85 + energyVal * 0.35);
      const baseR = energyRadius * (1 + breathe + p.radiusOffset);

      // Duration → horizontal spread modulation
      const spreadR = baseR * durationSpread;

      // Add organic noise displacement
      const noiseVal = smoothNoise(
        p.theta * 2 + time * NOISE_SCALE,
        p.phi * 2,
        time * NOISE_SCALE * 0.5
      );
      const noiseDisplacement = (noiseVal - 0.5) * 30 * (0.5 + energyVal * 0.5);

      const finalR = spreadR + noiseDisplacement;

      // Spherical to Cartesian
      const sinPhi = Math.sin(phi);
      const x3d = finalR * sinPhi * Math.cos(theta);
      const y3d = finalR * Math.cos(phi);  // Y = up (F0 encoded here)
      const z3d = finalR * sinPhi * Math.sin(theta);

      // Simple perspective projection
      const perspective = 600;
      const scale = perspective / (perspective + z3d);
      const screenX = cx + x3d * scale;
      const screenY = cy + y3d * scale * 0.85; // slight vertical compression

      // Energy → particle size
      const baseSize = BASE_PARTICLE_SIZE * p.sizeJitter;
      const energySize = baseSize * (0.5 + energyVal * 1.5);
      const size = energySize * scale;

      // Energy → opacity + depth-based fade
      const depthAlpha = 0.15 + (scale - 0.5) * 1.2;
      const energyAlpha = 0.2 + energyVal * 0.65;
      const alpha = Math.max(0.05, Math.min(0.9, depthAlpha * energyAlpha));

      projected.push({ x: screenX, y: screenY, z: z3d, size, alpha, p });
    }

    // Sort back to front
    projected.sort((a, b) => b.z - a.z);

    // Draw particles
    for (const { x, y, size, alpha } of projected) {
      if (size < 0.3) continue;

      // Core dot
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`;
      ctx.fill();

      // Soft glow for brighter particles
      if (alpha > 0.4 && size > 1.5) {
        const pg = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        pg.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(alpha * 0.3).toFixed(3)})`);
        pg.addColorStop(1, 'transparent');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ===== Layer 3: Center highlight =====
    const centerGlow = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy, SPHERE_RADIUS * 0.5);
    centerGlow.addColorStop(0, `rgba(255, 255, 255, 0.06)`);
    centerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = centerGlow;
    ctx.beginPath();
    ctx.arc(cx, cy - 10, SPHERE_RADIUS * 0.5, 0, Math.PI * 2);
    ctx.fill();

    timeRef.current += 16; // ~60fps timestep
    rafRef.current = requestAnimationFrame(render);
  }, [acoustics, color, textureTag, isRecording]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      className="sound-sphere-canvas"
      width={width}
      height={height}
      style={{ width: width / 2, height: height / 2 }}
    />
  );
}
