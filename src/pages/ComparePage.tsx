/**
 * ComparePage — 差异对比机制（三层递进）
 *
 * Layer 1: 并排对比 — 统一时间轴 + 维度切换
 * Layer 2: 特征关联 — 相似度网络图
 * Layer 3: 空间定位 — 二维散点图
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAllRecords, type RecordEntry } from '../stores/db';
import { REGIONS } from '../config/regions';
import {
  resample,
  computeSimilarity,
  extractF0Stats,
  type SimilarityResult,
} from '../utils/similarity';
import './ComparePage.css';

type Layer = 'side-by-side' | 'similarity' | 'spatial';
type Dimension = 'f0' | 'energy' | 'duration';

const DIMENSION_LABELS: Record<Dimension, string> = {
  f0: '声调 F0',
  energy: '能量 RMS',
  duration: '节奏 Duration',
};

const LAYER_LABELS: Record<Layer, { title: string; sub: string }> = {
  'side-by-side': { title: '并排对比', sub: '具体哪里不同' },
  similarity: { title: '特征关联', sub: '我和谁更像' },
  spatial: { title: '空间定位', sub: '我在哪个位置' },
};

// ==================== Helper: get region color ====================
function regionColor(code: string): string {
  return REGIONS.find((r) => r.id === code)?.colorTheme || '#888';
}
function regionName(code: string): string {
  return REGIONS.find((r) => r.id === code)?.name || code;
}

// ==================== Component ====================

export default function ComparePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus'); // optional: pre-selected "my" record

  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [layer, setLayer] = useState<Layer>('side-by-side');
  const [dimension, setDimension] = useState<Dimension>('f0');
  const [myRecordId, setMyRecordId] = useState<string | null>(focusId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load records
  useEffect(() => {
    getAllRecords().then((recs) => {
      const valid = recs.filter((r) => r.f0Series && r.f0Series.length > 0);
      setRecords(valid);
      // Auto-select latest record as "mine" if not set
      if (!focusId && valid.length > 0) {
        const latest = valid.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
        setMyRecordId(latest.id);
      }
      // Auto-select up to 5 records for comparison
      const ids = new Set(valid.slice(0, 6).map((r) => r.id));
      setSelectedIds(ids);
    });
  }, [focusId]);

  const myRecord = useMemo(() => records.find((r) => r.id === myRecordId), [records, myRecordId]);
  const compareRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id)),
    [records, selectedIds],
  );

  const toggleRecord = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="compare-page">
      {/* Header */}
      <div className="compare-header">
        <button className="compare-back" onClick={() => navigate('/map')}>← 声音地图</button>
        <h1 className="compare-title">差异对比</h1>
      </div>

      {/* Layer tabs */}
      <div className="compare-tabs">
        {(['side-by-side', 'similarity', 'spatial'] as Layer[]).map((l) => (
          <button
            key={l}
            className={`compare-tab ${layer === l ? 'active' : ''}`}
            onClick={() => setLayer(l)}
          >
            <span className="tab-title">{LAYER_LABELS[l].title}</span>
            <span className="tab-sub">{LAYER_LABELS[l].sub}</span>
          </button>
        ))}
      </div>

      {/* Sample selector */}
      <div className="compare-selector">
        <span className="selector-label">样本选择</span>
        <div className="selector-chips">
          {records.map((r) => (
            <button
              key={r.id}
              className={`selector-chip ${selectedIds.has(r.id) ? 'selected' : ''} ${r.id === myRecordId ? 'mine' : ''}`}
              style={{ borderColor: regionColor(r.region.region_code) }}
              onClick={() => toggleRecord(r.id)}
              onDoubleClick={() => setMyRecordId(r.id)}
              title={r.id === myRecordId ? '当前基准（双击切换）' : '单击选择/取消，双击设为基准'}
            >
              <span className="chip-dot" style={{ background: regionColor(r.region.region_code) }} />
              <span className="chip-name">{r.region.region_label}</span>
              <span className="chip-time">
                {new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {r.id === myRecordId && <span className="chip-badge">基准</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Main visualization area */}
      <div className="compare-main">
        {layer === 'side-by-side' && (
          <SideBySideLayer
            records={compareRecords}
            myRecordId={myRecordId}
            dimension={dimension}
            onDimensionChange={setDimension}
          />
        )}
        {layer === 'similarity' && myRecord && (
          <SimilarityLayer
            myRecord={myRecord}
            others={compareRecords.filter((r) => r.id !== myRecordId)}
            dimension={dimension}
            onDimensionChange={setDimension}
          />
        )}
        {layer === 'spatial' && (
          <SpatialLayer
            records={compareRecords}
            myRecordId={myRecordId}
          />
        )}
      </div>
    </div>
  );
}

// ==================== Layer 1: Side-by-Side ====================

function SideBySideLayer({
  records,
  myRecordId,
  dimension,
  onDimensionChange,
}: {
  records: RecordEntry[];
  myRecordId: string | null;
  dimension: Dimension;
  onDimensionChange: (d: Dimension) => void;
}) {
  const SAMPLE_LEN = 100;

  const getData = useCallback(
    (rec: RecordEntry): number[] => {
      switch (dimension) {
        case 'f0': return resample(rec.f0Series || [], SAMPLE_LEN);
        case 'energy': return resample(rec.energyContour || [], SAMPLE_LEN);
        case 'duration': return resample(rec.durationRatios || [], SAMPLE_LEN);
      }
    },
    [dimension],
  );

  return (
    <div className="layer-sidebyside">
      {/* Dimension switch */}
      <div className="dimension-switch">
        {(['f0', 'energy', 'duration'] as Dimension[]).map((d) => (
          <button
            key={d}
            className={`dim-btn ${dimension === d ? 'active' : ''}`}
            onClick={() => onDimensionChange(d)}
          >
            {DIMENSION_LABELS[d]}
          </button>
        ))}
      </div>

      {/* Contour cards */}
      <div className="sidebyside-grid">
        {records.map((rec) => (
          <ContourCard
            key={rec.id}
            record={rec}
            data={getData(rec)}
            isMine={rec.id === myRecordId}
            dimension={dimension}
            sampleLen={SAMPLE_LEN}
          />
        ))}
      </div>
    </div>
  );
}

function ContourCard({
  record,
  data,
  isMine,
  dimension,
  sampleLen,
}: {
  record: RecordEntry;
  data: number[];
  isMine: boolean;
  dimension: Dimension;
  sampleLen: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const color = regionColor(record.region.region_code);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.offsetWidth;
    const h = cvs.offsetHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const maxVal = Math.max(...data, 0.01);
    const pad = 8;
    const drawW = w - pad * 2;
    const drawH = h - pad * 2;

    // Fill area
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    for (let i = 0; i < data.length; i++) {
      const x = pad + (i / (data.length - 1)) * drawW;
      const y = h - pad - (data[i] / maxVal) * drawH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad + drawW, h - pad);
    ctx.closePath();
    ctx.fillStyle = color + '18';
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = pad + (i / (data.length - 1)) * drawW;
      const y = h - pad - (data[i] / maxVal) * drawH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glow
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [data, color]);

  return (
    <div className={`contour-card ${isMine ? 'is-mine' : ''}`}>
      <div className="contour-card-header">
        <span className="contour-dot" style={{ background: color }} />
        <span className="contour-region">{record.region.region_label}</span>
        {isMine && <span className="contour-badge">基准</span>}
        <span className="contour-time">
          {new Date(record.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <canvas ref={canvasRef} className="contour-canvas" />
      <div className="contour-axis-label">{DIMENSION_LABELS[dimension]}</div>
    </div>
  );
}

// ==================== Layer 2: Similarity Network ====================

function SimilarityLayer({
  myRecord,
  others,
  dimension,
  onDimensionChange,
}: {
  myRecord: RecordEntry;
  others: RecordEntry[];
  dimension: Dimension;
  onDimensionChange: (d: Dimension) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Compute similarities
  const similarities = useMemo(() => {
    return others.map((other) => ({
      record: other,
      sim: computeSimilarity(myRecord, other),
    }));
  }, [myRecord, others]);

  // Draw network
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.offsetWidth;
    const h = cvs.offsetHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.35;
    const myColor = regionColor(myRecord.region.region_code);

    // Draw connections
    similarities.forEach(({ record: other, sim }, idx) => {
      const angle = (idx / similarities.length) * Math.PI * 2 - Math.PI / 2;
      const simVal = sim[dimension];
      const dist = radius * (1.1 - simVal * 0.8); // higher sim = closer
      const ox = cx + Math.cos(angle) * dist;
      const oy = cy + Math.sin(angle) * dist;
      const otherColor = regionColor(other.region.region_code);

      // Connection line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ox, oy);
      ctx.strokeStyle = otherColor;
      ctx.globalAlpha = 0.15 + simVal * 0.6;
      ctx.lineWidth = 1 + simVal * 4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Similarity label on line
      const mx = (cx + ox) / 2;
      const my = (cy + oy) / 2;
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText(`${(simVal * 100).toFixed(0)}%`, mx, my - 4);

      // Other node
      const nodeRadius = 16 + simVal * 12;
      // Glow
      const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, nodeRadius * 2);
      glow.addColorStop(0, otherColor + '30');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ox, oy, nodeRadius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Node circle
      ctx.beginPath();
      ctx.arc(ox, oy, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#0c0c0c';
      ctx.fill();
      ctx.strokeStyle = otherColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node label
      ctx.fillStyle = otherColor;
      ctx.font = '11px "PingFang SC", serif';
      ctx.textAlign = 'center';
      ctx.fillText(regionName(other.region.region_code), ox, oy + nodeRadius + 14);
    });

    // Center node (my record)
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
    coreGlow.addColorStop(0, myColor + '40');
    coreGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#0c0c0c';
    ctx.fill();
    ctx.strokeStyle = myColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#D4894A';
    ctx.font = 'bold 11px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText('我', cx, cy + 4);

    ctx.fillStyle = myColor;
    ctx.font = '11px "PingFang SC", serif';
    ctx.fillText(regionName(myRecord.region.region_code), cx, cy + 38);
  }, [similarities, dimension, myRecord]);

  return (
    <div className="layer-similarity">
      <div className="dimension-switch">
        {(['f0', 'energy', 'duration'] as Dimension[]).map((d) => (
          <button
            key={d}
            className={`dim-btn ${dimension === d ? 'active' : ''}`}
            onClick={() => onDimensionChange(d)}
          >
            {DIMENSION_LABELS[d]}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} className="similarity-canvas" />
      <div className="similarity-legend">
        <span>连线越粗、距离越近 = 相似度越高</span>
      </div>
    </div>
  );
}

// ==================== Layer 3: Spatial Positioning ====================

function SpatialLayer({
  records,
  myRecordId,
}: {
  records: RecordEntry[];
  myRecordId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Extract features for all records
  const points = useMemo(() => {
    return records.map((r) => {
      const stats = extractF0Stats(r.f0Series || []);
      return { record: r, ...stats };
    });
  }, [records]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.offsetWidth;
    const h = cvs.offsetHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (points.length === 0) return;

    const pad = 60;
    const drawW = w - pad * 2;
    const drawH = h - pad * 2;

    // Compute data ranges
    const f0Means = points.map((p) => p.f0Mean);
    const f0Ranges = points.map((p) => p.f0Range);
    const xMin = Math.min(...f0Means) - 0.05;
    const xMax = Math.max(...f0Means) + 0.05;
    const yMin = Math.min(...f0Ranges) - 0.05;
    const yMax = Math.max(...f0Ranges) + 0.05;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const toX = (v: number) => pad + ((v - xMin) / xSpan) * drawW;
    const toY = (v: number) => h - pad - ((v - yMin) / ySpan) * drawH;

    // Grid lines
    ctx.strokeStyle = 'rgba(201,169,110,0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = pad + (i / 4) * drawW;
      const y = pad + (i / 4) * drawH;
      ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = 'rgba(201,169,110,0.4)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('基频均值 (音高) →', w / 2, h - 12);
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('基频变化幅度 (声调起伏) →', 0, 0);
    ctx.restore();

    // Draw points
    points.forEach(({ record, f0Mean, f0Range }) => {
      const x = toX(f0Mean);
      const y = toY(f0Range);
      const color = regionColor(record.region.region_code);
      const isMine = record.id === myRecordId;
      const nodeR = isMine ? 14 : 10;

      // Glow
      const glow = ctx.createRadialGradient(x, y, 0, x, y, nodeR * 3);
      glow.addColorStop(0, color + (isMine ? '50' : '25'));
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, nodeR * 3, 0, Math.PI * 2);
      ctx.fill();

      // Node
      ctx.beginPath();
      ctx.arc(x, y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = isMine ? color : '#0c0c0c';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isMine ? 3 : 1.5;
      ctx.stroke();

      // Label
      if (isMine) {
        ctx.fillStyle = '#D4894A';
        ctx.font = 'bold 10px "PingFang SC", serif';
        ctx.textAlign = 'center';
        ctx.fillText('我', x, y + 3.5);
      }

      // Region label below
      ctx.fillStyle = color;
      ctx.font = '10px "PingFang SC", serif';
      ctx.textAlign = 'center';
      ctx.fillText(regionName(record.region.region_code), x, y + nodeR + 13);
    });
  }, [points, myRecordId]);

  return (
    <div className="layer-spatial">
      <canvas ref={canvasRef} className="spatial-canvas" />
      <div className="spatial-legend">
        <span>X: 音高水平 &nbsp;|&nbsp; Y: 声调起伏 &nbsp;|&nbsp; 实心节点 = 我的录音</span>
      </div>
    </div>
  );
}
