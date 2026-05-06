/**
 * acoustics.ts — 声学参数提取模块
 *
 * 三个核心维度：
 *   1. F0 基频（YIN 算法）
 *   2. Duration 时长（发声片段切分 + 比例化）
 *   3. Energy RMS（包络提取 + 平滑）
 *
 * 所有输出均 min-max 归一化至 [0, 1]
 */

// ===================== Types =====================

export interface AcousticResult {
  /** 归一化 F0 序列 [0,1]，unvoiced 段已插值 */
  f0Series: number[];
  /** 原始 F0 (Hz)，unvoiced = 0 */
  f0Raw: number[];
  /** 各片段相对时长比例 [0,1]，voiced/unvoiced 交替 */
  durationRatios: number[];
  /** 各片段标记：true = voiced */
  durationVoiced: boolean[];
  /** 归一化平滑能量包络 [0,1] */
  energyContour: number[];
  /** 原始 RMS 序列 */
  energyRaw: number[];
  /** 统计摘要 */
  summary: {
    f0Mean: number;    // Hz
    f0Min: number;     // Hz (voiced only)
    f0Max: number;     // Hz
    f0Range: number;   // Hz
    durationTotal: number;  // seconds
    voicedRatio: number;    // 0-1
    energyMean: number;     // normalized
    energyPeak: number;     // normalized
    silenceRatio: number;   // 0-1
    tempo: number;          // voiced segments per second
  };
}

// ===================== Config =====================

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const F0_MIN = 60;   // Hz — lowest expected pitch
const F0_MAX = 500;  // Hz — highest expected pitch
const YIN_THRESHOLD = 0.15;
const SMOOTH_WINDOW = 5;
const ENERGY_SMOOTH_WINDOW = 7;
const VOICED_ENERGY_THRESHOLD = 0.01; // RMS threshold for voiced detection

// ===================== Entry Point =====================

/**
 * 从录音 Blob 提取完整声学参数
 */
export async function analyzeAudio(blob: Blob): Promise<AcousticResult> {
  const pcm = await decodeToPCM(blob);
  const sampleRate = pcm.sampleRate;
  const samples = pcm.channelData;

  // 1. 逐帧 RMS
  const rmsFrames = computeRMSFrames(samples, FRAME_SIZE, HOP_SIZE);

  // 2. 逐帧 F0 (YIN)
  const f0Raw = computeF0Frames(samples, sampleRate, FRAME_SIZE, HOP_SIZE);

  // 3. 能量包络 → 平滑 → 归一化
  const energySmoothed = smoothArray(rmsFrames, ENERGY_SMOOTH_WINDOW);
  const energyContour = normalizeMinMax(energySmoothed);

  // 4. F0 插值 + 平滑 + 归一化
  const f0Interpolated = interpolateF0(f0Raw);
  const f0Smoothed = smoothArray(f0Interpolated, SMOOTH_WINDOW);
  const f0Series = normalizeMinMax(f0Smoothed);

  // 5. Duration 切分
  const { durationRatios, durationVoiced } = computeDurationSegments(
    f0Raw, rmsFrames, sampleRate, HOP_SIZE
  );

  // 6. Summary
  const voicedF0 = f0Raw.filter((v) => v > 0);
  const totalSeconds = samples.length / sampleRate;
  const voicedFrames = f0Raw.filter((v) => v > 0).length;
  const totalFrames = f0Raw.length;
  const voicedSegmentCount = durationVoiced.filter((v) => v).length;

  const summary: AcousticResult['summary'] = {
    f0Mean: voicedF0.length > 0 ? voicedF0.reduce((a, b) => a + b, 0) / voicedF0.length : 0,
    f0Min: voicedF0.length > 0 ? Math.min(...voicedF0) : 0,
    f0Max: voicedF0.length > 0 ? Math.max(...voicedF0) : 0,
    f0Range: voicedF0.length > 0 ? Math.max(...voicedF0) - Math.min(...voicedF0) : 0,
    durationTotal: totalSeconds,
    voicedRatio: totalFrames > 0 ? voicedFrames / totalFrames : 0,
    energyMean: energyContour.length > 0 ? energyContour.reduce((a, b) => a + b, 0) / energyContour.length : 0,
    energyPeak: energyContour.length > 0 ? Math.max(...energyContour) : 0,
    silenceRatio: rmsFrames.length > 0 ? rmsFrames.filter((r) => r < VOICED_ENERGY_THRESHOLD).length / rmsFrames.length : 0,
    tempo: totalSeconds > 0 ? voicedSegmentCount / totalSeconds : 0,
  };

  return {
    f0Series,
    f0Raw,
    durationRatios,
    durationVoiced,
    energyContour,
    energyRaw: rmsFrames,
    summary,
  };
}

// ===================== Audio Decode =====================

interface PCMData {
  channelData: Float32Array;
  sampleRate: number;
}

async function decodeToPCM(blob: Blob): Promise<PCMData> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  // Use first channel, resample internally handled by browser
  const channelData = audioBuffer.getChannelData(0);
  return { channelData, sampleRate: audioBuffer.sampleRate };
}

// ===================== RMS Frames =====================

function computeRMSFrames(
  samples: Float32Array,
  frameSize: number,
  hopSize: number
): number[] {
  const frames: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let i = start; i < start + frameSize; i++) {
      sum += samples[i] * samples[i];
    }
    frames.push(Math.sqrt(sum / frameSize));
  }
  return frames;
}

// ===================== F0 — YIN Algorithm =====================

function computeF0Frames(
  samples: Float32Array,
  sampleRate: number,
  frameSize: number,
  hopSize: number
): number[] {
  const tauMin = Math.floor(sampleRate / F0_MAX);
  const tauMax = Math.min(Math.floor(sampleRate / F0_MIN), frameSize);
  const frames: number[] = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const f0 = yinFrame(samples, start, frameSize, sampleRate, tauMin, tauMax);
    frames.push(f0);
  }

  return frames;
}

/**
 * YIN pitch detection for a single frame
 * Returns F0 in Hz, or 0 if unvoiced
 */
function yinFrame(
  samples: Float32Array,
  offset: number,
  frameSize: number,
  sampleRate: number,
  tauMin: number,
  tauMax: number
): number {
  const halfFrame = Math.floor(frameSize / 2);
  const maxTau = Math.min(tauMax, halfFrame);

  // Step 1 & 2: Difference function
  const diff = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let j = 0; j < halfFrame; j++) {
      const d = samples[offset + j] - samples[offset + j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 3: Cumulative mean normalized difference (CMND)
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? diff[tau] * tau / runningSum : 1;
  }

  // Step 4: Absolute threshold — find first tau below threshold
  let bestTau = -1;
  for (let tau = tauMin; tau <= maxTau; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      // Step 5: Parabolic interpolation around the dip
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 1) return 0; // unvoiced

  // Parabolic interpolation for sub-sample accuracy
  const refined = parabolicInterp(cmnd, bestTau, maxTau);
  const f0 = sampleRate / refined;

  // Sanity check
  if (f0 < F0_MIN || f0 > F0_MAX) return 0;
  return f0;
}

function parabolicInterp(arr: Float32Array, idx: number, maxIdx: number): number {
  if (idx <= 0 || idx >= maxIdx) return idx;
  const s0 = arr[idx - 1];
  const s1 = arr[idx];
  const s2 = arr[idx + 1];
  const denom = 2 * (2 * s1 - s2 - s0);
  if (Math.abs(denom) < 1e-10) return idx;
  return idx + (s0 - s2) / denom;
}

// ===================== F0 Interpolation =====================

/**
 * 线性插值填补 unvoiced (0) 段
 * 保留 unvoiced 段首尾不外推，仅在有值区间内插值
 */
function interpolateF0(f0: number[]): number[] {
  const result = [...f0];
  const n = result.length;

  // Find first and last voiced frames
  let firstVoiced = -1;
  let lastVoiced = -1;
  for (let i = 0; i < n; i++) {
    if (result[i] > 0) {
      if (firstVoiced < 0) firstVoiced = i;
      lastVoiced = i;
    }
  }

  if (firstVoiced < 0) return result; // all unvoiced

  // Fill gaps between voiced segments with linear interpolation
  let prevVoicedIdx = firstVoiced;
  for (let i = firstVoiced + 1; i <= lastVoiced; i++) {
    if (result[i] > 0) {
      // Interpolate gap if any
      if (i - prevVoicedIdx > 1) {
        const startVal = result[prevVoicedIdx];
        const endVal = result[i];
        const gap = i - prevVoicedIdx;
        for (let j = 1; j < gap; j++) {
          result[prevVoicedIdx + j] = startVal + (endVal - startVal) * (j / gap);
        }
      }
      prevVoicedIdx = i;
    }
  }

  // Extend edges with nearest voiced value
  for (let i = 0; i < firstVoiced; i++) result[i] = result[firstVoiced];
  for (let i = lastVoiced + 1; i < n; i++) result[i] = result[lastVoiced];

  return result;
}

// ===================== Duration Segments =====================

/**
 * 基于 F0 + RMS 联合判据切分 voiced/unvoiced 段
 * 输出各段相对时长比例
 */
function computeDurationSegments(
  f0: number[],
  rms: number[],
  sampleRate: number,
  hopSize: number
): { durationRatios: number[]; durationVoiced: boolean[] } {
  const n = Math.min(f0.length, rms.length);
  if (n === 0) return { durationRatios: [], durationVoiced: [] };

  // Frame-level voiced/unvoiced decision
  const voiced: boolean[] = [];
  for (let i = 0; i < n; i++) {
    voiced.push(f0[i] > 0 && rms[i] > VOICED_ENERGY_THRESHOLD);
  }

  // Group consecutive frames into segments
  const segments: { voiced: boolean; frameCount: number }[] = [];
  let currentVoiced = voiced[0];
  let count = 1;
  for (let i = 1; i < n; i++) {
    if (voiced[i] === currentVoiced) {
      count++;
    } else {
      segments.push({ voiced: currentVoiced, frameCount: count });
      currentVoiced = voiced[i];
      count = 1;
    }
  }
  segments.push({ voiced: currentVoiced, frameCount: count });

  // Merge very short segments (< 3 frames) into neighbors
  const merged: typeof segments = [];
  for (const seg of segments) {
    if (merged.length > 0 && seg.frameCount < 3) {
      merged[merged.length - 1].frameCount += seg.frameCount;
    } else {
      merged.push({ ...seg });
    }
  }

  // Convert to duration ratios
  const totalFrames = merged.reduce((sum, s) => sum + s.frameCount, 0);
  const frameDuration = hopSize / sampleRate;
  const totalDuration = totalFrames * frameDuration;

  const durationRatios = merged.map(
    (s) => (s.frameCount * frameDuration) / totalDuration
  );
  const durationVoiced = merged.map((s) => s.voiced);

  return { durationRatios, durationVoiced };
}

// ===================== Utils =====================

/** 滑动窗口均值平滑 */
function smoothArray(arr: number[], windowSize: number): number[] {
  if (arr.length === 0) return [];
  const half = Math.floor(windowSize / 2);
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
}

/** Min-Max 归一化至 [0, 1] */
function normalizeMinMax(arr: number[]): number[] {
  if (arr.length === 0) return [];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;
  if (range < 1e-10) return arr.map(() => 0.5);
  return arr.map((v) => (v - min) / range);
}

/**
 * 跨样本归一化：使用全局极值
 * 适用于比较场景
 */
export function normalizeWithGlobalRange(
  arr: number[],
  globalMin: number,
  globalMax: number
): number[] {
  const range = globalMax - globalMin;
  if (range < 1e-10) return arr.map(() => 0.5);
  return arr.map((v) => Math.max(0, Math.min(1, (v - globalMin) / range)));
}
