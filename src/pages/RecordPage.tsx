import { useParams, useNavigate } from 'react-router-dom';
import { useRef, useState, useCallback, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getRegionById } from '../config/regions';
import { useRecorder } from '../hooks/useRecorder';
import { saveRecord, type RecordEntry } from '../stores/db';
import { analyzeAudio, type AcousticResult } from '../utils/acoustics';
import {
  type AcousticFrame,
  buildVisualConfig,
} from '../components/GenerativeCanvas';
import PhoneticVisualizer from '../components/PhoneticVisualizer';
import './RecordPage.css';

type Phase = 'ready' | 'recording' | 'result';

export default function RecordPage() {
  const { regionId } = useParams<{ regionId: string }>();
  const navigate = useNavigate();
  const region = getRegionById(regionId || '');

  const { state: rec, start, stop, reset } = useRecorder();
  const [phase, setPhase] = useState<Phase>('ready');
  const [saved, setSaved] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [acoustics, setAcoustics] = useState<AcousticResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveFrames, setLiveFrames] = useState<AcousticFrame[]>([]);

  // Canvas refs
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const posterCanvasRef = useRef<HTMLCanvasElement>(null);

  // Animation data
  const rmsHistoryRef = useRef<number[]>([]);


  const color = region?.colorTheme || '#a78bfa';

  /* ===== Wave Canvas (real-time waveform) ===== */
  const drawWave = useCallback(() => {
    const cvs = waveCanvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const W = cvs.width;
    const H = cvs.height;
    ctx.clearRect(0, 0, W, H);

    const history = rmsHistoryRef.current;
    if (history.length < 2) return;

    // Draw a waveform-like display from RMS history
    const step = W / Math.max(history.length - 1, 1);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    for (let i = 0; i < history.length; i++) {
      const rms = Math.min(history[i] * 6, 1); // amplify for visibility
      const y = H / 2 - rms * (H / 2) * 0.9;
      ctx.lineTo(i * step, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Mirror
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    for (let i = 0; i < history.length; i++) {
      const rms = Math.min(history[i] * 6, 1);
      const y = H / 2 + rms * (H / 2) * 0.9;
      ctx.lineTo(i * step, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [color]);

  /* ===== Real-time acoustic frame callback ===== */

  const lastFrameTimeRef = useRef(0);

  /* Frame callback — receives real F0 + RMS from useRecorder */
  const onFrame = useCallback((rms: number, f0: number) => {
    rmsHistoryRef.current.push(rms);

    const now = Date.now();
    // Throttle to ~20fps for visualization frames
    if (now - lastFrameTimeRef.current < 50) {
      drawWave();
      return;
    }
    lastFrameTimeRef.current = now;

    // Energy gate: only add frames with meaningful acoustic content
    if (rms < 0.005) {
      drawWave();
      return;
    }

    // Pass raw rms to GenerativeCanvas — do NOT amplify here.
    // The canvas render already handles rms scaling internally.
    setLiveFrames((prev) => {
      const cutoff = now - 15000;
      const pruned = prev.filter((fr) => fr.timestamp > cutoff);
      return [...pruned, { f0, rms, timestamp: now }].slice(-600);
    });
    drawWave();
  }, [drawWave]);

  /* Start recording */
  const handleStart = useCallback(async () => {
    rmsHistoryRef.current = [];
    setPhase('recording');
    setSaved(false);
    setPosterUrl('');
    setLiveFrames([]);
    await start(onFrame);
  }, [start, onFrame]);

  /* Stop recording */
  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  /* Transition to result when recorder stops */
  useEffect(() => {
    if (rec.status === 'stopped' && phase === 'recording') {
      setPhase('result');
      generatePoster();
      // Run offline acoustic analysis
      if (rec.audioBlob) {
        setAnalyzing(true);
        analyzeAudio(rec.audioBlob)
          .then((result) => {
            setAcoustics(result);
            setAnalyzing(false);
          })
          .catch((err) => {
            console.warn('Acoustic analysis failed:', err);
            setAnalyzing(false);
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status]);

  /* Generate poster */
  const generatePoster = useCallback(() => {
    const cvs = posterCanvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d')!;
    const W = 800;
    const H = 1200;
    cvs.width = W;
    cvs.height = H;

    // === Layer 1: Deep dark base (RegionBackground L1) ===
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, W, H);

    // === Layer 2: Film grain noise (RegionBackground L2) ===
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#111' : '#000';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    // === Layer 3: Ghost gradient from accent color (RegionBackground L3) ===
    const ghostGrad = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.6);
    ghostGrad.addColorStop(0, color + '08');
    ghostGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = ghostGrad;
    ctx.fillRect(0, 0, W, H);

    // === Layer 4: Organic growth visualization (same algorithm as GenerativeCanvas) ===
    const posterFrames = liveFrames.length >= 2 ? liveFrames : [];
    const vizConfig = buildVisualConfig(color, region?.visualTag, region?.id);

    if (posterFrames.length >= 2) {
      const centerX = W / 2;
      const centerY = H * 0.42;

      // Segment by pause threshold (same as GenerativeCanvas)
      const PAUSE_THRESHOLD = 300;
      const segments: AcousticFrame[][] = [];
      let currentSeg: AcousticFrame[] = [];
      for (let i = 0; i < posterFrames.length; i++) {
        if (i > 0 && posterFrames[i].timestamp - posterFrames[i - 1].timestamp > PAUSE_THRESHOLD) {
          if (currentSeg.length > 0) segments.push(currentSeg);
          currentSeg = [];
        }
        currentSeg.push(posterFrames[i]);
      }
      if (currentSeg.length > 0) segments.push(currentSeg);

      segments.forEach((segment, sIdx) => {
        if (segment.length < 2) return;

        const baseAngle = (sIdx / segments.length) * Math.PI * 2;
        const angleSpread = (segment.length / posterFrames.length) * Math.PI * 2 * 0.9;

        ctx.save();
        ctx.translate(centerX, centerY);

        // Growth core
        const coreSize = 40;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreSize * 3);
        grad.addColorStop(0, `${vizConfig.accentColors[0]}55`);
        grad.addColorStop(0.5, `${vizConfig.accentColors[1]}22`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, coreSize * 3, 0, Math.PI * 2);
        ctx.fill();

        // Dense fibrous petals (90 fibers, identical to GenerativeCanvas)
        const fiberCount = 90;
        for (let f = 0; f < fiberCount; f++) {
          ctx.beginPath();
          const subAngle = baseAngle + (f / fiberCount - 0.5) * angleSpread;
          const colorIdx = f % vizConfig.accentColors.length;
          const fiberColor = vizConfig.accentColors[colorIdx];

          ctx.strokeStyle = fiberColor;
          ctx.globalAlpha = 0.12 + (f / fiberCount) * 0.4;
          ctx.lineWidth = 0.6;
          ctx.setLineDash([Math.random() * 8, Math.random() * 4]);
          ctx.moveTo(0, 0);

          segment.forEach((frame, i) => {
            const p = i / segment.length;
            const rMax = 100 + (frame.f0 * 350);
            const r = rMax * (0.15 + 0.85 * p);
            const curveOffset = Math.sin(p * 4 + f * 0.2) * 40;
            const x = Math.cos(subAngle + (curveOffset / r)) * r;
            const y = Math.sin(subAngle + (curveOffset / r)) * r;
            ctx.lineTo(x, y);

            // Energy spores (same threshold / size as GenerativeCanvas)
            if (frame.rms > 0.22 && i % 10 === 0) {
              ctx.save();
              ctx.globalAlpha = frame.rms * 0.8;
              ctx.shadowBlur = 15;
              ctx.shadowColor = fiberColor;
              ctx.fillStyle = '#fff';
              ctx.beginPath();
              ctx.arc(x, y, 2 + frame.rms * 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          });

          ctx.globalAlpha *= 1;
          ctx.stroke();
        }

        // Thematic hints
        if (vizConfig.theme === 'bamboo') {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha = 0.05;
          ctx.beginPath();
          ctx.arc(0, 0, 50, baseAngle - angleSpread / 2, baseAngle + angleSpread / 2);
          ctx.stroke();
        } else if (vizConfig.theme === 'waves' || vizConfig.theme === 'water') {
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
    }

    // === Layer 5: Heavy vignette (RegionBackground L4) ===
    const vignette = ctx.createRadialGradient(W / 2, H * 0.42, W * 0.2, W / 2, H * 0.42, W * 0.85);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // === Layer 6: Text overlays ===
    // Top: Title
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '300 48px "PingFang SC", "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText('语脉图鉴', W / 2, H * 0.08);

    // Region name
    ctx.font = '300 36px "PingFang SC", "Noto Serif SC", serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(region?.name || '', W / 2, H * 0.13);

    // Series label
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.letterSpacing = '4px';
    ctx.fillText('PHONETIC GROWTH SEQUENCE', W / 2, H * 0.16);

    // Visual tag — bottom left area
    ctx.textAlign = 'left';
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(region?.visualTag || '', 40, H - 80);

    // Series ID — bottom right
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(`SERIES. ${(region?.id || '').toUpperCase()}`, W - 40, H - 80);

    // Timestamp — bottom center
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(201,169,110,0.3)';
    ctx.font = '12px monospace';
    ctx.fillText(new Date().toLocaleString('zh-CN'), W / 2, H - 40);

    setPosterUrl(cvs.toDataURL('image/png'));
  }, [color, region, liveFrames]);

  /* Save to IndexedDB */
  const handleSave = useCallback(async () => {
    if (!rec.audioBlob || !region) return;
    const id = crypto.randomUUID();
    const record: RecordEntry = {
      id,
      region: {
        region_code: region.id,
        region_label: region.name,
        region_group: region.category,
      },
      transcript: '',
      audioBlob: rec.audioBlob,
      audioUrl: rec.audioUrl || '',
      audioFeatures: {
        avgRms: acoustics?.summary.energyMean ?? rec.rmsHistory.reduce((a, b) => a + b, 0) / (rec.rmsHistory.length || 1),
        peak: acoustics?.summary.energyPeak ?? Math.max(...rec.rmsHistory, 0),
        silenceRatio: acoustics?.summary.silenceRatio ?? rec.rmsHistory.filter((r) => r < 0.02).length / (rec.rmsHistory.length || 1),
        tempo: acoustics?.summary.tempo ?? 0,
      },
      f0Series: acoustics?.f0Series,
      durationRatios: acoustics?.durationRatios,
      energyContour: acoustics?.energyContour ?? rec.rmsHistory,
      vizFrames: liveFrames,
      posterUrl,
      privacy: 'public',
      timestamp: Date.now(),
    };
    await saveRecord(record);
    setSaved(true);
  }, [rec, region, posterUrl, acoustics, liveFrames]);

  /* Clear visualization only (keep recording state) */
  const handleClearViz = useCallback(() => {
    setLiveFrames([]);
    setAcoustics(null);
  }, []);

  /* Reset */
  const handleReset = useCallback(() => {
    reset();
    setPhase('ready');
    setSaved(false);
    setPosterUrl('');
    setAcoustics(null);
    setAnalyzing(false);
    setLiveFrames([]);
    rmsHistoryRef.current = [];
    const waveCvs = waveCanvasRef.current;
    if (waveCvs) waveCvs.getContext('2d')!.clearRect(0, 0, waveCvs.width, waveCvs.height);
  }, [reset]);

  if (!region) {
    return (
      <div className="record-page">
        <p>未找到区域信息</p>
        <button onClick={() => navigate('/select')}>返回选择</button>
      </div>
    );
  }

  return (
    <div className="record-page">
      {/* Header */}
      <div className="record-header">
        <button className="region-back" onClick={() => navigate('/select')}>
          ← 返回
        </button>
        <div className="record-region-info">
          <span className="record-region-tag" style={{ color }}>{region.visualTag}</span>
          <span className="record-region-name">{region.name}</span>
        </div>
        {(liveFrames.length > 0 || acoustics) && (
          <button className="clear-viz-btn" onClick={handleClearViz}>
            清除画面
          </button>
        )}
      </div>

      {/* Main area — PhoneticVisualizer (full bleed) */}
      <div className="record-main">
        <PhoneticVisualizer
          frames={liveFrames}
          config={buildVisualConfig(color, region.visualTag, region.id)}
          isActive={phase === 'recording'}
          regionName={region.name}
          visualTag={region.visualTag}
          regionId={region.id}
        />

        {/* Wave canvas overlay (during recording) */}
        {phase === 'recording' && (
          <canvas
            ref={waveCanvasRef}
            className="wave-canvas"
            width={Math.min(640, window.innerWidth * 0.9)}
            height={window.innerWidth <= 480 ? 70 : 120}
          />
        )}

        {/* Ready state */}
        {phase === 'ready' && (
          <div className="record-prompt">
            <p>按住下方按钮开始录音</p>
            <p className="record-hint">最长 5 秒 · 请对准麦克风说话</p>
          </div>
        )}

        {/* Recording indicator */}
        {phase === 'recording' && (
          <div className="recording-indicator">
            <div className="recording-dot" style={{ background: color }} />
            <span>录音中...</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="record-controls">
        {phase === 'ready' && (
          <button
            className="record-btn"
            style={{ borderColor: color, color }}
            onMouseDown={handleStart}
            onTouchStart={handleStart}
          >
            按住录音
          </button>
        )}
        {phase === 'recording' && (
          <button
            className="record-btn recording"
            style={{ background: color }}
            onMouseUp={handleStop}
            onTouchEnd={handleStop}
          >
            松开停止
          </button>
        )}
        {phase === 'result' && (
          <div className="result-actions">
            <button className="action-btn" onClick={handleReset}>
              再录一条
            </button>
            <button
              className="action-btn primary"
              style={{ background: color }}
              onClick={handleSave}
              disabled={saved}
            >
              {saved ? '已保存' : '保存归档'}
            </button>
            <button className="action-btn" onClick={() => navigate('/map')}>
              查看地图
            </button>
          </div>
        )}
      </div>

      {/* Result panel */}
      {phase === 'result' && (
        <div className="result-panel">
          <div className="result-left">
            {/* Poster preview */}
            <canvas ref={posterCanvasRef} className="poster-canvas" />
            {posterUrl && (
              <a className="download-link" href={posterUrl} download="soundcalliflow-poster.png">
                下载海报
              </a>
            )}
          </div>
          <div className="result-right">
            {/* Audio playback */}
            {rec.audioUrl && (
              <audio controls src={rec.audioUrl} className="audio-player" />
            )}
            {/* Acoustic features */}
            <div className="features-card">
              <h3>声学特征</h3>
              {analyzing && <p className="analyzing-hint">声学分析中...</p>}
              {acoustics ? (
                <>
                  <div className="feature-group">
                    <h4>基频 F0</h4>
                    <div className="feature-row">
                      <span>平均音高</span>
                      <span>{acoustics.summary.f0Mean.toFixed(1)} Hz</span>
                    </div>
                    <div className="feature-row">
                      <span>音域范围</span>
                      <span>{acoustics.summary.f0Min.toFixed(0)}–{acoustics.summary.f0Max.toFixed(0)} Hz</span>
                    </div>
                    <div className="feature-row">
                      <span>音高跨度</span>
                      <span>{acoustics.summary.f0Range.toFixed(1)} Hz</span>
                    </div>
                  </div>
                  <div className="feature-group">
                    <h4>时长 Duration</h4>
                    <div className="feature-row">
                      <span>总时长</span>
                      <span>{acoustics.summary.durationTotal.toFixed(2)} s</span>
                    </div>
                    <div className="feature-row">
                      <span>有声比例</span>
                      <span>{(acoustics.summary.voicedRatio * 100).toFixed(1)}%</span>
                    </div>
                    <div className="feature-row">
                      <span>语速节奏</span>
                      <span>{acoustics.summary.tempo.toFixed(1)} 段/秒</span>
                    </div>
                  </div>
                  <div className="feature-group">
                    <h4>能量 RMS</h4>
                    <div className="feature-row">
                      <span>平均能量</span>
                      <span>{acoustics.summary.energyMean.toFixed(3)}</span>
                    </div>
                    <div className="feature-row">
                      <span>峰值能量</span>
                      <span>{acoustics.summary.energyPeak.toFixed(3)}</span>
                    </div>
                    <div className="feature-row">
                      <span>静音比例</span>
                      <span>{(acoustics.summary.silenceRatio * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="feature-row">
                    <span>平均能量</span>
                    <span>{(rec.rmsHistory.reduce((a, b) => a + b, 0) / (rec.rmsHistory.length || 1)).toFixed(4)}</span>
                  </div>
                  <div className="feature-row">
                    <span>峰值能量</span>
                    <span>{Math.max(...rec.rmsHistory, 0).toFixed(4)}</span>
                  </div>
                  <div className="feature-row">
                    <span>静音比例</span>
                    <span>{((rec.rmsHistory.filter((r) => r < 0.02).length / (rec.rmsHistory.length || 1)) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="feature-row">
                    <span>时长</span>
                    <span>{(rec.duration / 1000).toFixed(1)}s</span>
                  </div>
                </>
              )}
            </div>
            {/* QR Code */}
            {posterUrl && (
              <div className="qr-section">
                <p className="qr-label">扫码保存</p>
                <QRCodeSVG
                  value={posterUrl.slice(0, 2000)}
                  size={120}
                  bgColor="transparent"
                  fgColor="#D4894A"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
