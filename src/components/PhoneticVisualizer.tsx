/**
 * PhoneticVisualizer — 完整可视化展示容器
 *
 * 分层结构：
 *   L1: RegionBackground  — 深底 + 噪点 + 幽灵色调 + 暗角
 *   L2: GenerativeCanvas  — 有机纤维生长
 *   L3: 文字元数据        — 区域名称 + 标签
 *   L4: 暗角光晕          — CSS inset shadow
 */

import type { AcousticFrame, VisualConfig } from './GenerativeCanvas';
import GenerativeCanvas from './GenerativeCanvas';
import RegionBackground from './RegionBackground';

interface Props {
  frames: AcousticFrame[];
  config: VisualConfig;
  isActive: boolean;
  /** 区域显示名称 */
  regionName?: string;
  /** 纹理标签（如"黄土"） */
  visualTag?: string;
  /** 区域 ID */
  regionId?: string;
}

export default function PhoneticVisualizer({
  frames,
  config,
  isActive,
  regionName,
  visualTag,
  regionId,
}: Props) {
  return (
    <div className="phonetic-visualizer">
      {/* Layer 1: Region atmosphere background */}
      <RegionBackground config={config} />

      {/* Layer 2-4: Generative organic growth */}
      <GenerativeCanvas
        frames={frames}
        config={config}
        isActive={isActive}
      />

      {/* Layer: Metadata overlay */}
      <div className="viz-meta viz-meta-top">
        {regionName && <h2 className="viz-region-name">{regionName}</h2>}
        <p className="viz-series-label">PHONETIC GROWTH SEQUENCE</p>
      </div>

      <div className="viz-meta viz-meta-bottom-left">
        {visualTag && (
          <span className="viz-tag">{visualTag}</span>
        )}
      </div>

      <div className="viz-meta viz-meta-bottom-right">
        {regionId && (
          <span className="viz-series-id">
            SERIES. {regionId.toUpperCase()}
          </span>
        )}
      </div>

      {/* Layer: Vignette glow */}
      <div className="viz-vignette" />
    </div>
  );
}
