import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllRecords, deleteRecord, type RecordEntry } from '../stores/db';
import { REGIONS } from '../config/regions';
import ChinaMapBox, { type MapNode, type CompareLink } from '../components/ChinaMapBox';
import RecordPopup from '../components/RecordPopup';
import { computeSimilarity } from '../utils/similarity';
import './SonicMapPage.css';

type CompareDim = 'f0' | 'energy' | 'duration' | 'overall';

const DIM_LABELS: Record<CompareDim, string> = {
  f0: '声调 F0',
  energy: '能量 RMS',
  duration: '节奏',
  overall: '综合',
};

export default function SonicMapPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredRecord, setHoveredRecord] = useState<RecordEntry | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Compare mode ---
  const [compareMode, setCompareMode] = useState(false);
  const [compareDim, setCompareDim] = useState<CompareDim>('overall');
  const [focusRecordId, setFocusRecordId] = useState<string | null>(null);

  useEffect(() => {
    getAllRecords().then((recs) => {
      // Rebuild blob URLs — stored audioUrl is session-scoped and invalid after reload
      const hydrated = recs.map((r) => ({
        ...r,
        audioUrl: r.audioBlob ? URL.createObjectURL(r.audioBlob) : r.audioUrl,
      }));
      setRecords(hydrated);
    });
    return () => {
      // Revoke blob URLs on unmount to free memory
      setRecords((prev) => {
        prev.forEach((r) => {
          if (r.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(r.audioUrl);
        });
        return [];
      });
    };
  }, []);

  const grouped = useMemo(() => {
    return records.reduce<Record<string, RecordEntry[]>>((acc, r) => {
      const key = r.region.region_code;
      if (!acc[key]) acc[key] = [];
      acc[key].push(r);
      return acc;
    }, {});
  }, [records]);

  const mapNodes: MapNode[] = useMemo(() => {
    return REGIONS.map((r) => ({
      regionId: r.id,
      count: grouped[r.id]?.length || 0,
    }));
  }, [grouped]);

  // --- Compare links: compute similarity between records ---
  // Positions are resolved by ChinaMapBox from its own pin placement (single source of truth)
  const compareLinks: CompareLink[] = useMemo(() => {
    if (!compareMode || records.length < 2) return [];

    // Determine focus record (latest if not set)
    const focus = records.find((r) => r.id === focusRecordId)
      || records.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));

    const links: CompareLink[] = [];
    const focusRegion = REGIONS.find((r) => r.id === focus.region.region_code);

    for (const other of records) {
      if (other.id === focus.id) continue;

      const sim = computeSimilarity(focus, other);
      const dimVal = compareDim === 'overall' ? sim.overall : sim[compareDim];

      if (dimVal <= 0) continue;

      const otherRegion = REGIONS.find((r) => r.id === other.region.region_code);
      links.push({
        fromId: focus.id,
        toId: other.id,
        similarity: dimVal,
        color: otherRegion?.colorTheme || '#888',
        fromLabel: focusRegion?.name || '',
        toLabel: otherRegion?.name || '',
      });
    }

    return links;
  }, [compareMode, records, focusRecordId, compareDim]);

  const handleRecordHover = useCallback((record: RecordEntry | null, pos: { x: number; y: number } | null) => {
    setHoveredRecord(record);
    setHoverPos(pos);
    // Auto-play audio on hover
    if (record?.audioUrl) {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(record.audioUrl);
      audio.volume = 0.5;
      audio.play().catch(() => {});
      audioRef.current = audio;
    } else if (!record) {
      audioRef.current?.pause();
      audioRef.current = null;
    }
  }, []);

  const selectedRecords = selectedId ? (grouped[selectedId] || []) : [];
  const selectedRegion = selectedId ? REGIONS.find((r) => r.id === selectedId) : null;

  const handleHover = useCallback((id: string | null) => {
    setHoveredId(id);
  }, []);

  const handleClick = useCallback((id: string | null) => {
    setSelectedId((prev) => {
      const next = id && prev === id ? null : id;
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (recordId: string) => {
    await deleteRecord(recordId);
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
  }, []);

  return (
    <div className="map-page">
      {/* Header */}
      <div className="map-header">
        <button className="map-back" onClick={() => navigate('/select')}>
          ← 返回
        </button>
        <h1 className="map-title">声音地图</h1>
        <div className="map-stats">
          <span className="stat-badge">{records.length} 条录音</span>
          <span className="stat-badge">{Object.keys(grouped).length} 个区域</span>
          {records.length >= 2 && (
            <button
              className={`stat-badge compare-entry ${compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode((v) => !v)}
            >
              {compareMode ? '退出对比' : '差异对比'}
            </button>
          )}
        </div>
      </div>

      <div className="map-body">
        {/* Mapbox */}
        <div className="map-3d-container">
          <ChinaMapBox
            nodes={mapNodes}
            records={records}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={handleHover}
            onClick={handleClick}
            onRecordHover={handleRecordHover}
            compareLinks={compareLinks}
          />

          {/* Compare mode floating panel */}
          {compareMode && (
            <div className="compare-float-panel">
              <div className="cfp-header">
                <span className="cfp-title">差异对比</span>
                <button className="cfp-close" onClick={() => setCompareMode(false)}>×</button>
              </div>

              {/* Dimension switch */}
              <div className="cfp-dims">
                {(['overall', 'f0', 'energy', 'duration'] as CompareDim[]).map((d) => (
                  <button
                    key={d}
                    className={`cfp-dim ${compareDim === d ? 'active' : ''}`}
                    onClick={() => setCompareDim(d)}
                  >
                    {DIM_LABELS[d]}
                  </button>
                ))}
              </div>

              {/* Focus record selector */}
              <div className="cfp-focus">
                <span className="cfp-label">基准录音</span>
                <div className="cfp-focus-list">
                  {records.map((r) => {
                    const reg = REGIONS.find((rg) => rg.id === r.region.region_code);
                    const isFocus = r.id === (focusRecordId || records.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)).id);
                    return (
                      <button
                        key={r.id}
                        className={`cfp-focus-chip ${isFocus ? 'active' : ''}`}
                        style={{ borderColor: reg?.colorTheme }}
                        onClick={() => setFocusRecordId(r.id)}
                      >
                        <span className="cfp-chip-dot" style={{ background: reg?.colorTheme }} />
                        <span>{r.region.region_label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="cfp-legend">
                <div className="cfp-legend-row">
                  <span className="cfp-legend-line thick" />
                  <span>高相似度</span>
                </div>
                <div className="cfp-legend-row">
                  <span className="cfp-legend-line thin" />
                  <span>低相似度</span>
                </div>
              </div>

              {/* Link to detailed comparison */}
              <button
                className="cfp-detail-btn"
                onClick={() => navigate('/compare')}
              >
                查看详细对比 →
              </button>
            </div>
          )}

          {/* Hint */}
          <div className="map-hint">
            {compareMode
              ? '连线粗细 = 相似度 · 切换维度观察不同声学特征'
              : '拖拽旋转 · 滚轮缩放 · 悬停录音标记查看详情'}
          </div>
        </div>

        {/* Side panel */}
        {selectedRegion && (
          <div className="map-side-panel">
            <div className="panel-header">
              <div className="panel-color-bar" style={{ background: selectedRegion.colorTheme }} />
              <div>
                <h2 className="panel-region-name">{selectedRegion.name}</h2>
                <p className="panel-region-tag" style={{ color: selectedRegion.colorTheme }}>
                  {selectedRegion.visualTag} · {selectedRegion.id}
                </p>
              </div>
              <button className="panel-close" onClick={() => setSelectedId(null)}>×</button>
            </div>

            <div className="panel-section">
              <h3 className="panel-section-title">
                录音记录 ({selectedRecords.length})
              </h3>
              {selectedRecords.length === 0 ? (
                <div className="panel-empty">
                  <p>该区域暂无录音</p>
                  <button
                    className="panel-record-btn"
                    style={{ borderColor: selectedRegion.colorTheme, color: selectedRegion.colorTheme }}
                    onClick={() => navigate(`/record/${selectedRegion.id}`)}
                  >
                    去录音
                  </button>
                </div>
              ) : (
                <div className="panel-record-list">
                  {selectedRecords.map((rec) => (
                    <div key={rec.id} className="panel-record-item">
                      {rec.posterUrl && (
                        <img src={rec.posterUrl} className="panel-poster-thumb" alt="" />
                      )}
                      <div className="panel-record-info">
                        <p className="panel-record-time">
                          {new Date(rec.timestamp).toLocaleString('zh-CN')}
                        </p>
                        <p className="panel-record-feature">
                          基频 {(() => { const v = (rec.f0Series || []).filter(x => x > 0); return v.length > 0 ? `${(v.reduce((a,b) => a+b,0)/v.length).toFixed(0)} Hz` : '—'; })()} · 
                          时长 {(() => { const d = rec.durationRatios || []; return d.length > 0 ? `${(d.filter(x => x > 0.02).length / d.length * 100).toFixed(0)}%` : '—'; })()} · 
                          能量 {(() => { const e = rec.energyContour || []; return e.length > 0 ? (e.reduce((a,b) => a+b,0)/e.length).toFixed(3) : '—'; })()}
                        </p>
                        {rec.audioUrl && (
                          <audio controls src={rec.audioUrl} className="panel-audio" />
                        )}
                      </div>
                      <button
                        className="panel-delete-btn"
                        onClick={() => handleDelete(rec.id)}
                        title="删除此录音"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              className="panel-goto-record"
              style={{ background: selectedRegion.colorTheme }}
              onClick={() => navigate(`/record/${selectedRegion.id}`)}
            >
              录制新声音
            </button>
          </div>
        )}
      </div>

      {/* Bottom timeline */}
      {records.length > 0 && (
        <div className="map-timeline">
          <span className="timeline-label">最近录音</span>
          <div className="timeline-scroll">
            {records.slice(-20).reverse().map((r) => {
              const reg = REGIONS.find((reg) => reg.id === r.region.region_code);
              return (
                <div
                  key={r.id}
                  className={`timeline-item ${selectedId === r.region.region_code ? 'active' : ''}`}
                  style={{ borderColor: reg?.colorTheme }}
                  onClick={() => handleClick(r.region.region_code)}
                >
                  <span className="timeline-dot" style={{ background: reg?.colorTheme }} />
                  <span className="timeline-region">{r.region.region_label}</span>
                  <span className="timeline-time">
                    {new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hover popup — 3D card */}
      {hoveredRecord && hoverPos && (
        <RecordPopup record={hoveredRecord} screenPos={hoverPos} />
      )}
    </div>
  );
}
