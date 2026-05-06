import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { PROVINCE_TO_REGION, REGION_CENTERS } from '../config/chinaMap';
import { REGIONS } from '../config/regions';
import type { RecordEntry } from '../stores/db';

mapboxgl.accessToken = 'pk.eyJ1IjoicGl6ZSIsImEiOiJjbW81Z2Y2dXEwMjdnMm9zaHB4OWpvaThhIn0.m3t_72AryxtdPn1zWZfUxw';

export interface MapNode {
  regionId: string;
  count: number;
}

export interface CompareLink {
  fromId: string;   // record id — position looked up from pin placement
  toId: string;
  similarity: number; // 0-1
  color: string;
  fromLabel: string;
  toLabel: string;
}

interface Props {
  nodes: MapNode[];
  records: RecordEntry[];
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onClick: (id: string | null) => void;
  onRecordHover: (record: RecordEntry | null, screenPos: { x: number; y: number } | null) => void;
  compareLinks?: CompareLink[];
}

/** Build a Mapbox match expression: adcode → region color */
function buildColorExpression(): mapboxgl.Expression {
  const expr: (string | number | string[])[] = ['match', ['get', 'adcode']];
  for (const [adcodeStr, regionId] of Object.entries(PROVINCE_TO_REGION)) {
    const region = REGIONS.find((r) => r.id === regionId);
    if (!region) continue;
    expr.push(Number(adcodeStr));
    expr.push(region.colorTheme);
  }
  expr.push('#2a2520'); // default — deep ink
  return expr as unknown as mapboxgl.Expression;
}

/** Build height expression: hovered/selected regions get taller */
function buildHeightExpression(
  hoveredId: string | null,
  selectedId: string | null,
  countMap: Map<string, number>
): mapboxgl.Expression {
  const cases: (string | number | boolean | string[])[] = ['case'];

  if (hoveredId) {
    const adcodes = Object.entries(PROVINCE_TO_REGION)
      .filter(([, rid]) => rid === hoveredId)
      .map(([a]) => Number(a));
    if (adcodes.length > 0) {
      cases.push(['in', ['get', 'adcode'], ['literal', adcodes]] as unknown as string);
      cases.push(12000);
    }
  }

  if (selectedId && selectedId !== hoveredId) {
    const adcodes = Object.entries(PROVINCE_TO_REGION)
      .filter(([, rid]) => rid === selectedId)
      .map(([a]) => Number(a));
    if (adcodes.length > 0) {
      cases.push(['in', ['get', 'adcode'], ['literal', adcodes]] as unknown as string);
      cases.push(8000);
    }
  }

  for (const [regionId, count] of countMap) {
    if (regionId === hoveredId || regionId === selectedId) continue;
    if (count === 0) continue;
    const adcodes = Object.entries(PROVINCE_TO_REGION)
      .filter(([, rid]) => rid === regionId)
      .map(([a]) => Number(a));
    if (adcodes.length > 0) {
      cases.push(['in', ['get', 'adcode'], ['literal', adcodes]] as unknown as string);
      cases.push(4000 + count * 1000);
    }
  }

  cases.push(3000); // fallback
  return cases as unknown as mapboxgl.Expression;
}

export default function ChinaMapBox({ nodes, records, hoveredId, selectedId, onHover, onClick, onRecordHover, compareLinks }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const arcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arcRafRef = useRef(0);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const recordMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const compareLinksRef = useRef<CompareLink[]>([]);
  // Single source of truth: record id → [lng, lat] as placed on the map
  const recordPosRef = useRef<Map<string, [number, number]>>(new Map());
  const countMap = new Map(nodes.map((n) => [n.regionId, n.count]));

  /* ===== Init map ===== */
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [105, 35],
      zoom: 3.5,
      pitch: 45,
      bearing: -5,
      antialias: true,
      projection: 'globe',
    });

    mapRef.current = map;

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(12, 11, 9)',
        'high-color': 'rgb(25, 22, 18)',
        'horizon-blend': 0.06,
        'space-color': 'rgb(6, 5, 4)',
        'star-intensity': 0.1,
      });
    });

    map.on('load', () => {
      // ====== 水墨化底图图层 ======
      const inkifyBasemap = () => {
        const style = map.getStyle();
        if (!style?.layers) return;

        for (const layer of style.layers) {
          const id = layer.id;
          const type = layer.type;

          if (type === 'background') {
            map.setPaintProperty(id, 'background-color', '#080706');
            continue;
          }

          if (id.includes('water')) {
            if (type === 'fill') {
              map.setPaintProperty(id, 'fill-color', '#090a0c');
              map.setPaintProperty(id, 'fill-opacity', 0.95);
            }
            if (type === 'line') {
              map.setPaintProperty(id, 'line-color', '#111214');
            }
            continue;
          }

          if (id.includes('land') || id.includes('landcover') || id.includes('landuse')) {
            if (type === 'fill') {
              map.setPaintProperty(id, 'fill-color', '#0c0b09');
              map.setPaintProperty(id, 'fill-opacity', 0.7);
            }
            continue;
          }

          if (id.includes('building')) {
            map.setLayoutProperty(id, 'visibility', 'none');
            continue;
          }

          if (id.includes('road') || id.includes('bridge') || id.includes('tunnel')) {
            map.setLayoutProperty(id, 'visibility', 'none');
            continue;
          }

          if (id.includes('boundary') || id.includes('admin')) {
            if (type === 'line') {
              map.setPaintProperty(id, 'line-color', '#2a2518');
              map.setPaintProperty(id, 'line-opacity', 0.15);
            }
            continue;
          }

          if (type === 'symbol') {
            map.setLayoutProperty(id, 'visibility', 'none');
            continue;
          }
        }
      };

      inkifyBasemap();

      map.addSource('china-provinces', {
        type: 'geojson',
        data: '/china.json',
      });

      map.addLayer({
        id: 'provinces-extrusion',
        type: 'fill-extrusion',
        source: 'china-provinces',
        paint: {
          'fill-extrusion-color': buildColorExpression(),
          'fill-extrusion-height': 3000,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.2,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'provinces-glow',
        type: 'fill',
        source: 'china-provinces',
        paint: {
          'fill-color': buildColorExpression(),
          'fill-opacity': 0.03,
        },
      });

      map.addLayer({
        id: 'provinces-border',
        type: 'line',
        source: 'china-provinces',
        paint: {
          'line-color': 'rgba(212, 137, 74, 0.12)',
          'line-width': 0.8,
          'line-blur': 0.5,
        },
      });

      map.addLayer({
        id: 'provinces-border-glow',
        type: 'line',
        source: 'china-provinces',
        paint: {
          'line-color': 'rgba(212, 137, 74, 0.04)',
          'line-width': 3,
          'line-blur': 3,
        },
      });

      map.on('mousemove', 'provinces-extrusion', (e) => {
        if (!e.features?.length) return;
        const adcode = e.features[0].properties?.adcode;
        const regionId = PROVINCE_TO_REGION[adcode] || null;
        onHover(regionId);
        map.getCanvas().style.cursor = regionId ? 'pointer' : 'grab';
      });

      map.on('mouseleave', 'provinces-extrusion', () => {
        onHover(null);
        map.getCanvas().style.cursor = 'grab';
      });

      map.on('click', 'provinces-extrusion', (e) => {
        if (!e.features?.length) return;
        const adcode = e.features[0].properties?.adcode;
        const regionId = PROVINCE_TO_REGION[adcode] || null;
        onClick(regionId);
      });

      addMarkers(map);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      recordMarkersRef.current.forEach((m) => m.remove());
      recordMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== Update extrusion height on hover/select/count change ===== */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getLayer('provinces-extrusion')) return;

    map.setPaintProperty(
      'provinces-extrusion',
      'fill-extrusion-height',
      buildHeightExpression(hoveredId, selectedId, countMap),
    );

    const opacityExpr: unknown[] = ['case'];
    if (hoveredId) {
      const adcodes = Object.entries(PROVINCE_TO_REGION)
        .filter(([, rid]) => rid === hoveredId)
        .map(([a]) => Number(a));
      if (adcodes.length) {
        opacityExpr.push(['in', ['get', 'adcode'], ['literal', adcodes]]);
        opacityExpr.push(0.35);
      }
    }
    if (selectedId && selectedId !== hoveredId) {
      const adcodes = Object.entries(PROVINCE_TO_REGION)
        .filter(([, rid]) => rid === selectedId)
        .map(([a]) => Number(a));
      if (adcodes.length) {
        opacityExpr.push(['in', ['get', 'adcode'], ['literal', adcodes]]);
        opacityExpr.push(0.3);
      }
    }
    opacityExpr.push(0.18);
    map.setPaintProperty('provinces-extrusion', 'fill-extrusion-opacity', opacityExpr as mapboxgl.Expression);

  }, [hoveredId, selectedId, countMap]);

  /* ===== Update markers ===== */
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement();
      const count = countMap.get(id) || 0;
      const region = REGIONS.find((r) => r.id === id);
      if (!region) return;

      const badge = el.querySelector('.marker-count') as HTMLElement;
      if (badge) badge.textContent = count > 0 ? `${count}` : '';

      const dot = el.querySelector('.marker-dot') as HTMLElement;
      if (dot) {
        const size = 8 + count * 3;
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
      }

      el.classList.toggle('active', id === selectedId);
      el.classList.toggle('hovered', id === hoveredId);
    });
  }, [nodes, hoveredId, selectedId, countMap]);

  /* ===== Fly to region on select ===== */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const center = REGION_CENTERS[selectedId];
    if (!center) return;
    map.flyTo({
      center: center,
      zoom: 5,
      pitch: 50,
      duration: 1200,
    });
  }, [selectedId]);

  /* ===== Record pin markers — also stores positions for arc rendering ===== */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old record markers
    recordMarkersRef.current.forEach((m) => m.remove());
    recordMarkersRef.current = [];
    recordPosRef.current.clear();

    // Stable hash from record id → deterministic offset per pin
    const hashCode = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return h;
    };

    const regionIdx: Record<string, number> = {};

    for (const rec of records) {
      const regionId = rec.region.region_code;
      const center = REGION_CENTERS[regionId];
      if (!center) continue;
      const region = REGIONS.find((r) => r.id === regionId);
      if (!region) continue;

      const idx = regionIdx[regionId] || 0;
      regionIdx[regionId] = idx + 1;
      const hash = hashCode(rec.id);
      const angle = (hash & 0xffff) / 0xffff * Math.PI * 2;
      const radius = 0.3 + idx * 0.15;
      const lng = center[0] + Math.cos(angle) * radius;
      const lat = center[1] + Math.sin(angle) * radius;

      // Store position — this is the SINGLE source of truth
      recordPosRef.current.set(rec.id, [lng, lat]);

      const el = document.createElement('div');
      el.className = 'record-pin';
      el.innerHTML = `
        <div class="record-pin-glow" style="background:${region.colorTheme}"></div>
        <div class="record-pin-dot" style="background:${region.colorTheme};box-shadow:0 0 12px ${region.colorTheme}90, 0 0 4px ${region.colorTheme}60"></div>
        <div class="record-pin-ring" style="border-color:${region.colorTheme}"></div>
      `;

      el.addEventListener('mouseenter', (e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        onRecordHover(rec, { x: rect.left + rect.width / 2, y: rect.top });
      });
      el.addEventListener('mouseleave', () => {
        onRecordHover(null, null);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);

      recordMarkersRef.current.push(marker);
    }
  }, [records, onRecordHover]);

  /* ===== Compare mode: 3D arc overlay canvas ===== */
  useEffect(() => {
    compareLinksRef.current = compareLinks || [];
  }, [compareLinks]);

  useEffect(() => {
    const map = mapRef.current;
    const wrapper = containerRef.current?.parentElement;
    if (!map || !wrapper) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'arc-overlay-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    wrapper.appendChild(canvas);
    arcCanvasRef.current = canvas;

    const drawArcs = () => {
      const links = compareLinksRef.current;
      const posMap = recordPosRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      if (!links || links.length === 0) return;

      const now = Date.now();

      links.forEach((link, linkIdx) => {
        // Look up ACTUAL pin positions from the stored ref
        const fromLngLat = posMap.get(link.fromId);
        const toLngLat = posMap.get(link.toId);
        if (!fromLngLat || !toLngLat) return;

        const p0 = map.project(fromLngLat);
        const p1 = map.project(toLngLat);

        // Screen distance → arc height
        const screenDx = p1.x - p0.x;
        const screenDy = p1.y - p0.y;
        const screenDist = Math.sqrt(screenDx * screenDx + screenDy * screenDy);
        const arcHeight = screenDist * 0.4 + 30;

        const sim = link.similarity;
        const lineWidth = 0.8 + sim * 1.8;
        const baseAlpha = 0.35 + sim * 0.45;

        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        const cpX = midX;
        const cpY = midY - arcHeight;

        const ARC_SEGMENTS = 40;
        const arcPts: { x: number; y: number; t: number }[] = [];
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
          const t = i / ARC_SEGMENTS;
          const t1 = 1 - t;
          const x = t1 * t1 * p0.x + 2 * t1 * t * cpX + t * t * p1.x;
          const y = t1 * t1 * p0.y + 2 * t1 * t * cpY + t * t * p1.y;
          arcPts.push({ x, y, t });
        }

        // === Layer 1: Ground shadow ===
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
          const t = i / ARC_SEGMENTS;
          const t1 = 1 - t;
          const sx = t1 * p0.x + t * p1.x;
          const sy = t1 * p0.y + t * p1.y;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = link.color;
        ctx.globalAlpha = 0.04 + sim * 0.04;
        ctx.lineWidth = lineWidth * 2.5;
        ctx.filter = 'blur(4px)';
        ctx.stroke();
        ctx.filter = 'none';
        ctx.restore();

        // === Layer 2: Outer glow ===
        ctx.save();
        ctx.beginPath();
        arcPts.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = link.color;
        ctx.globalAlpha = baseAlpha * 0.25;
        ctx.lineWidth = lineWidth * 4;
        ctx.shadowColor = link.color;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();

        // === Layer 3: Main dashed arc line ===
        ctx.save();
        const dashLen = 10;
        const gapLen = 6;
        let drawn = 0;
        let drawing = true;
        ctx.beginPath();
        let started = false;
        for (let i = 1; i < arcPts.length; i++) {
          const prev = arcPts[i - 1];
          const curr = arcPts[i];
          const segDx = curr.x - prev.x;
          const segDy = curr.y - prev.y;
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy);

          if (drawing) {
            if (!started) { ctx.moveTo(prev.x, prev.y); started = true; }
            ctx.lineTo(curr.x, curr.y);
          }

          drawn += segLen;
          const threshold = drawing ? dashLen : gapLen;
          if (drawn >= threshold) {
            if (drawing) {
              ctx.strokeStyle = link.color;
              ctx.globalAlpha = baseAlpha;
              ctx.lineWidth = lineWidth;
              ctx.stroke();
              ctx.beginPath();
              started = false;
            }
            drawn = 0;
            drawing = !drawing;
          }
        }
        if (started) {
          ctx.strokeStyle = link.color;
          ctx.globalAlpha = baseAlpha;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }
        ctx.restore();

        // === Layer 4: Endpoint glow nodes ===
        [p0, p1].forEach((pt) => {
          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 10 + sim * 6);
          grad.addColorStop(0, link.color + '70');
          grad.addColorStop(0.4, link.color + '25');
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 10 + sim * 6, 0, Math.PI * 2);
          ctx.fill();
        });

        // === Layer 5: Animated flowing particle ===
        const period = 2500 + linkIdx * 300;
        const phase = ((now + linkIdx * 500) % period) / period;
        const particleIdx = Math.floor(phase * ARC_SEGMENTS);
        if (particleIdx < arcPts.length) {
          const pp = arcPts[particleIdx];
          const pGrad = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, 4 + sim * 3);
          pGrad.addColorStop(0, '#ffffff');
          pGrad.addColorStop(0.3, link.color);
          pGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = pGrad;
          ctx.globalAlpha = 0.85 + sim * 0.15;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 4 + sim * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // === Layer 6: Similarity percentage label ===
        const apexPt = arcPts[Math.floor(ARC_SEGMENTS / 2)];
        const labelText = `${(sim * 100).toFixed(0)}%`;
        ctx.save();
        ctx.font = 'bold 13px "Noto Serif SC", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(labelText).width + 12;
        const th = 20;
        const lx = apexPt.x;
        const ly = apexPt.y - 12;
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.beginPath();
        ctx.roundRect(lx - tw / 2, ly - th / 2, tw, th, 4);
        ctx.fill();
        ctx.strokeStyle = link.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, lx, ly);
        ctx.restore();
      });
    };

    const loop = () => {
      drawArcs();
      arcRafRef.current = requestAnimationFrame(loop);
    };

    map.on('move', drawArcs);
    map.on('resize', drawArcs);
    arcRafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(arcRafRef.current);
      map.off('move', drawArcs);
      map.off('resize', drawArcs);
      canvas.remove();
      arcCanvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== Add custom markers ===== */
  const addMarkers = useCallback((map: mapboxgl.Map) => {
    for (const region of REGIONS) {
      const center = REGION_CENTERS[region.id];
      if (!center) continue;

      const el = document.createElement('div');
      el.className = 'map-marker ink-marker';
      el.innerHTML = `
        <div class="marker-ink-ring" style="border-color:${region.colorTheme}"></div>
        <div class="marker-glow" style="background:${region.colorTheme}"></div>
        <div class="marker-dot" style="background:${region.colorTheme};box-shadow:0 0 8px ${region.colorTheme}30"></div>
        <div class="marker-label">${region.name}</div>
        <div class="marker-count" style="color:${region.colorTheme}"></div>
      `;

      el.addEventListener('mouseenter', () => onHover(region.id));
      el.addEventListener('mouseleave', () => onHover(null));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(region.id);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(center)
        .addTo(map);

      markersRef.current.set(region.id, marker);
    }
  }, [onHover, onClick]);

  return (
    <div className="mapbox-wrapper">
      <div ref={containerRef} className="mapbox-container" />
      <div className="mapbox-ink-vignette" />
    </div>
  );
}
