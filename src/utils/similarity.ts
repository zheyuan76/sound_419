/**
 * similarity.ts — 声学特征相似度计算
 *
 * 三种度量：
 *   1. 皮尔逊相关系数 — 用于基频/能量走势对比
 *   2. 欧氏距离 → 归一化相似度 — 用于时长比例对比
 *   3. 综合相似度 — 加权融合
 */

// ==================== Resample ====================

/** 将任意长度数组线性插值重采样到 targetLen */
export function resample(arr: number[], targetLen: number): number[] {
  if (arr.length === 0) return new Array(targetLen).fill(0);
  if (arr.length === targetLen) return [...arr];
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = (i / (targetLen - 1)) * (arr.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, arr.length - 1);
    const t = srcIdx - lo;
    result.push(arr[lo] * (1 - t) + arr[hi] * t);
  }
  return result;
}

// ==================== Pearson Correlation ====================

/** 皮尔逊相关系数 r ∈ [-1, 1]，序列需等长 */
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-10) return 0;
  return cov / denom;
}

/**
 * 基频/能量走势相似度
 * 先重采样到相同长度，再计算皮尔逊相关系数，映射到 [0, 1]
 */
export function contourSimilarity(a: number[], b: number[], sampleLen = 64): number {
  if (a.length < 2 || b.length < 2) return 0;
  const ra = resample(a, sampleLen);
  const rb = resample(b, sampleLen);
  const r = pearsonCorrelation(ra, rb);
  // 映射 [-1,1] → [0,1]
  return (r + 1) / 2;
}

// ==================== Euclidean Distance ====================

/** 归一化欧氏距离 → 相似度 [0, 1] */
export function durationSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  // 重采样到相同长度
  const len = Math.max(a.length, b.length);
  const ra = resample(a, len);
  const rb = resample(b, len);

  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const d = ra[i] - rb[i];
    sumSq += d * d;
  }
  const dist = Math.sqrt(sumSq / len); // 归一化到 [0, 1] 范围
  return Math.max(0, 1 - dist);
}

// ==================== Composite ====================

export interface SimilarityResult {
  f0: number;       // 基频走势相似度 [0,1]
  energy: number;   // 能量走势相似度 [0,1]
  duration: number; // 时长比例相似度 [0,1]
  overall: number;  // 综合相似度 [0,1]
}

/**
 * 计算两条录音之间的多维度相似度
 */
export function computeSimilarity(
  a: { f0Series?: number[]; energyContour?: number[]; durationRatios?: number[] },
  b: { f0Series?: number[]; energyContour?: number[]; durationRatios?: number[] },
): SimilarityResult {
  const f0 = contourSimilarity(a.f0Series || [], b.f0Series || []);
  const energy = contourSimilarity(a.energyContour || [], b.energyContour || []);
  const duration = durationSimilarity(a.durationRatios || [], b.durationRatios || []);
  const overall = f0 * 0.4 + energy * 0.3 + duration * 0.3;
  return { f0, energy, duration, overall };
}

// ==================== Feature Extraction ====================

/** 从 f0Series (normalized 0-1) 提取统计量用于空间定位 */
export function extractF0Stats(f0Series: number[]): { f0Mean: number; f0Range: number } {
  if (f0Series.length === 0) return { f0Mean: 0, f0Range: 0 };
  const voiced = f0Series.filter((v) => v > 0.01);
  if (voiced.length === 0) return { f0Mean: 0, f0Range: 0 };
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  const min = Math.min(...voiced);
  const max = Math.max(...voiced);
  return { f0Mean: mean, f0Range: max - min };
}
