import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REGION_GROUPS, getRegionsByCategory, type RegionCard } from '../config/regions';
import './RegionSelectPage.css';

export default function RegionSelectPage() {
  const navigate = useNavigate();
  const [activeGroup, setActiveGroup] = useState(0);
  const [activeCard, setActiveCard] = useState(0);
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);

  const group = REGION_GROUPS[activeGroup];
  const regions = getRegionsByCategory(group.key);

  const handleGroupChange = (idx: number) => {
    setActiveGroup(idx);
    setActiveCard(0);
    setExpandedRegion(null);
  };

  const handleCardClick = (region: RegionCard, idx: number) => {
    if (activeCard === idx && expandedRegion === region.id) {
      navigate(`/record/${region.id}`);
    } else {
      setActiveCard(idx);
      setExpandedRegion(region.id);
    }
  };

  return (
    <div className="region-page paper-bg">
      <button className="region-back" onClick={() => navigate('/')}>← 返回</button>

      {/* 分类标签 */}
      <div className="group-tabs">
        {REGION_GROUPS.map((g, i) => (
          <button
            key={g.key}
            className={`group-tab ${i === activeGroup ? 'active' : ''}`}
            onClick={() => handleGroupChange(i)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <h1 className="region-title">方言选择区</h1>

      {/* 竖向长条卡片轮播 */}
      <div className="carousel-container">
        <div className="carousel">
          {regions.map((region, idx) => {
            const offset = idx - activeCard;
            const absOffset = Math.abs(offset);
            const isActive = idx === activeCard;

            return (
              <div
                key={region.id}
                className={`carousel-card ${isActive ? 'active' : ''}`}
                style={{
                  transform: `translateX(${offset * 160}px) scale(${isActive ? 1 : 0.85})`,
                  zIndex: regions.length - absOffset,
                  opacity: absOffset > 2 ? 0 : 1 - absOffset * 0.2,
                }}
                onClick={() => handleCardClick(region, idx)}
              >
                {/* 区域色渐变底 */}
                <div className="card-gradient" style={{
                  background: `linear-gradient(180deg, ${region.colorTheme}15 0%, ${region.colorTheme}08 50%, transparent 100%)`
                }} />

                {/* 顶部小圆点 */}
                <div className="card-dot" style={{ background: region.colorTheme }} />

                {/* 竖排区域名 */}
                <div className="card-name-vertical">
                  {region.name.replace('区', '').split('').map((ch, i) => (
                    <span key={i}>{ch}</span>
                  ))}
                </div>

                {/* 分隔线 */}
                <div className="card-vline" style={{ background: region.colorTheme }} />

                {/* 纹理标签 */}
                <div className="card-tag" style={{ color: region.colorTheme }}>
                  {region.visualTag}
                </div>

                {/* ID */}
                <div className="card-id">{region.id}</div>
              </div>
            );
          })}
        </div>

        {regions.length > 1 && (
          <>
            <button
              className="carousel-arrow left"
              disabled={activeCard === 0}
              onClick={() => { setActiveCard((c) => Math.max(0, c - 1)); setExpandedRegion(null); }}
            >‹</button>
            <button
              className="carousel-arrow right"
              disabled={activeCard === regions.length - 1}
              onClick={() => { setActiveCard((c) => Math.min(regions.length - 1, c + 1)); setExpandedRegion(null); }}
            >›</button>
          </>
        )}
      </div>

      {/* 展开详情 */}
      {expandedRegion && (() => {
        const r = regions.find((r) => r.id === expandedRegion)!;
        return (
          <div className="region-detail">
            <div className="dialect-list">
              {r.dialects.map((d) => (
                <button
                  key={d.id}
                  className="dialect-chip"
                  style={{ borderColor: r.colorTheme, color: r.colorTheme }}
                  onClick={() => navigate(`/record/${r.id}`)}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <button
              className="region-enter-btn"
              style={{ background: r.colorTheme }}
              onClick={() => navigate(`/record/${r.id}`)}
            >
              进入录音
            </button>
          </div>
        );
      })()}
    </div>
  );
}
