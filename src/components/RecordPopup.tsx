/**
 * RecordPopup — 地图悬浮卡片（3D 透视效果）
 * 鼠标移到录音标记上时显示，包含 SoundSphere + 音频播放 + 声学解读
 */

import { useRef, useCallback, useState, useMemo } from 'react';
import type { RecordEntry } from '../stores/db';
import { buildVisualConfig, acousticArraysToFrames } from './GenerativeCanvas';
import PhoneticVisualizer from './PhoneticVisualizer';
import { REGIONS } from '../config/regions';

interface Props {
  record: RecordEntry;
  /** 标记在屏幕上的位置 */
  screenPos: { x: number; y: number };
}

export default function RecordPopup({ record, screenPos }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const region = REGIONS.find((r) => r.id === record.region.region_code);
  const color = region?.colorTheme || '#888';

  // Compute F0 stats from stored array
  const f0Voiced = (record.f0Series || []).filter((v) => v > 0);
  const f0Mean = f0Voiced.length > 0 ? f0Voiced.reduce((a, b) => a + b, 0) / f0Voiced.length : 0;
  const f0Min = f0Voiced.length > 0 ? Math.min(...f0Voiced) : 0;
  const f0Max = f0Voiced.length > 0 ? Math.max(...f0Voiced) : 0;

  // Compute duration voiced ratio
  const durArr = record.durationRatios || [];
  const voicedCount = durArr.filter((v) => v > 0.02).length;
  const voicedRatio = durArr.length > 0 ? voicedCount / durArr.length : 0;

  // Compute energy stats
  const eArr = record.energyContour || [];
  const energyMean = eArr.length > 0 ? eArr.reduce((a, b) => a + b, 0) / eArr.length : 0;

  // Build frames for GenerativeCanvas — prefer stored vizFrames (exact live recording)
  // Must re-base timestamps to "now" so the age-based fade-out doesn't kill everything.
  const canvasFrames = useMemo(() => {
    let raw: { f0: number; rms: number; timestamp: number }[] = [];

    if (record.vizFrames && record.vizFrames.length > 0) {
      raw = record.vizFrames as typeof raw;
    } else if (record.f0Series && record.energyContour) {
      raw = acousticArraysToFrames(record.f0Series, record.energyContour);
    }

    if (raw.length === 0) return raw;

    // Re-base: shift all timestamps so the last frame is "now"
    const lastTs = raw[raw.length - 1].timestamp;
    const now = Date.now();
    const offset = now - lastTs;
    return raw.map((fr) => ({ ...fr, timestamp: fr.timestamp + offset }));
  }, [record.vizFrames, record.f0Series, record.energyContour]);

  const visualConfig = useMemo(
    () => buildVisualConfig(color, region?.visualTag, region?.id),
    [color, region?.visualTag, region?.id],
  );

  // 3D tilt on mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setTilt({ rotateX: -dy * 12, rotateY: dx * 12 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ rotateX: 0, rotateY: 0 });
  }, []);

  // Position: above the pin, centered horizontally, clamped to viewport
  const cardWidth = 300;
  const cardHeight = 400;
  let left = screenPos.x - cardWidth / 2;
  let top = screenPos.y - cardHeight - 20; // 20px above pin

  // Clamp to viewport
  if (left < 12) left = 12;
  if (left + cardWidth > window.innerWidth - 12) left = window.innerWidth - cardWidth - 12;
  if (top < 12) top = screenPos.y + 30; // flip below if no room above

  return (
    <div
      ref={cardRef}
      className="record-popup-3d"
      style={{
        left,
        top,
        width: cardWidth,
        transform: `perspective(800px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Glow edge */}
      <div className="popup-3d-glow" style={{ background: `${color}15` }} />

      {/* Header */}
      <div className="popup-3d-header">
        <span className="popup-3d-dot" style={{ background: color }} />
        <span className="popup-3d-name">{record.region.region_label}</span>
        <span className="popup-3d-time">
          {new Date(record.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* PhoneticVisualizer — full layer stack */}
      <div className="popup-3d-viz">
        <PhoneticVisualizer
          frames={canvasFrames}
          config={visualConfig}
          isActive={false}
          regionName={record.region.region_label}
          visualTag={region?.visualTag}
          regionId={record.region.region_code}
        />
      </div>

      {/* Feature bars */}
      <div className="popup-3d-features">
        <div className="popup-3d-bar-row">
          <span className="popup-3d-label">基频</span>
          <div className="popup-3d-bar-track">
            <div className="popup-3d-bar-fill" style={{
              width: `${Math.min(f0Mean / 5, 100)}%`,
              background: color,
            }} />
          </div>
          <span className="popup-3d-val">{f0Mean > 0 ? `${f0Mean.toFixed(0)} Hz` : '—'}</span>
        </div>
        <div className="popup-3d-bar-row">
          <span className="popup-3d-label">时长</span>
          <div className="popup-3d-bar-track">
            <div className="popup-3d-bar-fill" style={{
              width: `${voicedRatio * 100}%`,
              background: color,
            }} />
          </div>
          <span className="popup-3d-val">{(voicedRatio * 100).toFixed(0)}%</span>
        </div>
        <div className="popup-3d-bar-row">
          <span className="popup-3d-label">能量</span>
          <div className="popup-3d-bar-track">
            <div className="popup-3d-bar-fill" style={{
              width: `${Math.min(energyMean * 100, 100)}%`,
              background: color,
            }} />
          </div>
          <span className="popup-3d-val">{energyMean.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
