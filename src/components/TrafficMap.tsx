import { useCallback, useEffect, useRef, useState } from "react";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";

import {
  GeoIpUnavailableError,
  getPanelState,
  type GeoIpInfo,
} from "../api/panel";
import { usePanelCapabilities } from "../api/panelCapabilities";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { isGeoIpUnavailable, lookupGeoIp } from "../lib/geoipCache";
import type { FeatureCollection, Topology, TopoFeature } from "topojson-client";
import { Card } from "./ui";
import styles from "./TrafficMap.module.css";

const TOPOLOGY = worldAtlas as unknown as Topology;
const COUNTRIES = feature(TOPOLOGY, TOPOLOGY.objects.countries) as FeatureCollection;

const MAX_ARCS = 30;
const TRAIL_POINTS = 14;
const DRAW_SECONDS = 0.9;
const FADE_SECONDS = 0.6;
const PULSE_SECONDS = 5.5;
// TODO: 在 panel 能稳定提供出口 IP 之前，最后一个回退点使用成都。
const FALLBACK_ORIGIN = { lat: 30.67, lon: 104.07 };

interface Arc {
  key: string;
  lat: number;
  lon: number;
  count: number;
  t: number;
  closing: boolean;
}

interface Cluster {
  key: string;
  lat: number;
  lon: number;
  count: number;
  arcKey: string | null;
}

interface MapColors {
  accent: string;
  text: string;
  textFaint: string;
  background: string;
}

interface Origin {
  lat: number;
  lon: number;
}

function projectX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width;
}

function projectY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height;
}

function hostFromAddress(value: string): string {
  const text = value.trim();
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    return end > 1 ? text.slice(1, end) : "";
  }
  const lastColon = text.lastIndexOf(":");
  if (lastColon > 0 && text.indexOf(":") === lastColon) {
    return text.slice(0, lastColon);
  }
  return text;
}

function isIpAddress(value: string): boolean {
  if (value === "") {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  return value.includes(":") && /^[0-9a-f:.]+$/i.test(value);
}

function readColors(): MapColors {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim();
  return {
    accent: value("--accent"),
    text: value("--text"),
    textFaint: value("--text-faint"),
    background: value("--bg"),
  };
}

function traceGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: TopoFeature["geometry"],
  width: number,
  height: number,
  closePaths: boolean,
): void {
  if (geometry === null) {
    return;
  }
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][]);
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 2) {
        continue;
      }
      let previousX: number | null = null;
      for (let index = 0; index < ring.length; index += 1) {
        const [lon, lat] = ring[index];
        const x = projectX(lon, width);
        const y = projectY(lat, height);
        if (
          index === 0 ||
          (previousX !== null && Math.abs(x - previousX) > width / 2)
        ) {
          // A ring crossing the antimeridian must not draw a line across the map.
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        previousX = x;
      }
      if (closePaths) {
        ctx.closePath();
      }
    }
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

class TrafficMapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private origin: Origin | null = null;
  private readonly arcs = new Map<string, Arc>();
  private readonly clusters = new Map<string, Cluster>();
  private readonly tracked = new Map<string, string>();
  private colors = readColors();
  private visible = true;
  private reducedMotion = false;
  private running = false;
  private raf = 0;
  private last = 0;
  private phase = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("Canvas 2D is unavailable");
    }
    this.ctx = ctx;
    this.base = document.createElement("canvas");
    const baseCtx = this.base.getContext("2d");
    if (baseCtx === null) {
      throw new Error("Canvas 2D is unavailable");
    }
    this.baseCtx = baseCtx;
  }

  setSize(width: number, height: number, dpr: number): void {
    if (this.disposed) {
      return;
    }
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextDpr = Math.max(1, dpr);
    if (
      nextWidth === this.width &&
      nextHeight === this.height &&
      nextDpr === this.dpr
    ) {
      return;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.dpr = nextDpr;
    this.canvas.width = Math.round(nextWidth * nextDpr);
    this.canvas.height = Math.round(nextHeight * nextDpr);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.renderBase();
    this.requestDraw();
  }

  refreshColors(): void {
    this.colors = readColors();
    this.renderBase();
    this.requestDraw();
  }

  setOrigin(lat: number, lon: number): void {
    this.origin = { lat, lon };
    this.requestDraw();
  }

  setVisible(value: boolean): void {
    if (this.visible === value) {
      return;
    }
    this.visible = value;
    if (!value) {
      this.stop();
      return;
    }
    this.requestDraw();
  }

  setReducedMotion(value: boolean): void {
    if (this.reducedMotion === value) {
      return;
    }
    this.reducedMotion = value;
    if (value) {
      this.stop();
      for (const [key, arc] of this.arcs) {
        if (arc.closing) {
          this.arcs.delete(key);
          const cluster = this.clusters.get(key);
          if (cluster !== undefined && cluster.count === 0) {
            this.clusters.delete(key);
          }
        } else {
          arc.t = 1;
        }
      }
    }
    this.requestDraw();
  }

  addConnection(id: string, lat: number, lon: number): void {
    if (this.disposed || this.tracked.has(id)) {
      return;
    }
    const clusterLat = Math.round(lat);
    const clusterLon = Math.round(lon);
    const key = `${clusterLat},${clusterLon}`;
    let cluster = this.clusters.get(key);
    if (cluster === undefined) {
      cluster = { key, lat: clusterLat, lon: clusterLon, count: 0, arcKey: null };
      this.clusters.set(key, cluster);
    }
    cluster.count += 1;
    this.tracked.set(id, key);

    const existing =
      cluster.arcKey !== null ? this.arcs.get(cluster.arcKey) : undefined;
    if (existing !== undefined) {
      existing.count = cluster.count;
      existing.closing = false;
      if (existing.t > 1) {
        existing.t = 1;
      }
      if (this.reducedMotion) {
        existing.t = 1;
      }
    } else {
      while (this.arcs.size >= MAX_ARCS) {
        const oldestKey = this.arcs.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        this.arcs.delete(oldestKey);
        const oldCluster = this.clusters.get(oldestKey);
        if (oldCluster !== undefined) {
          oldCluster.arcKey = null;
        }
      }
      const arc: Arc = {
        key,
        lat: clusterLat,
        lon: clusterLon,
        count: cluster.count,
        t: this.reducedMotion ? 1 : 0,
        closing: false,
      };
      this.arcs.set(key, arc);
      cluster.arcKey = key;
    }
    this.requestDraw();
  }

  removeConnection(id: string): void {
    const key = this.tracked.get(id);
    if (key === undefined) {
      return;
    }
    this.tracked.delete(id);
    const cluster = this.clusters.get(key);
    if (cluster === undefined) {
      return;
    }
    cluster.count = Math.max(0, cluster.count - 1);
    const arc = cluster.arcKey !== null ? this.arcs.get(cluster.arcKey) : undefined;
    if (arc !== undefined) {
      arc.count = cluster.count;
    }
    if (cluster.count === 0) {
      this.clusters.delete(key);
      if (arc !== undefined) {
        if (this.reducedMotion) {
          this.arcs.delete(arc.key);
        } else {
          arc.closing = true;
          arc.t = Math.max(arc.t, 1);
        }
      }
    }
    this.requestDraw();
  }

  destroy(): void {
    this.disposed = true;
    this.stop();
    this.arcs.clear();
    this.clusters.clear();
    this.tracked.clear();
  }

  private stop(): void {
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.running = false;
  }

  private requestDraw(): void {
    if (this.disposed || !this.visible || this.width === 0) {
      return;
    }
    if (this.reducedMotion || this.arcs.size === 0) {
      this.paint();
      return;
    }
    if (this.running) {
      return;
    }
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (!this.running || this.disposed) {
      return;
    }
    const delta = Math.min(Math.max((now - this.last) / 1000, 0), 0.1);
    this.last = now;
    this.step(delta);
    this.paint();
    if (this.arcs.size > 0 && this.visible && !this.reducedMotion) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
      this.raf = 0;
    }
  };

  private step(delta: number): void {
    this.phase = (this.phase + delta / PULSE_SECONDS) % 1;
    for (const [key, arc] of this.arcs) {
      if (arc.closing) {
        arc.t = Math.min(arc.t + delta / FADE_SECONDS, 1.6);
        if (arc.t >= 1.6) {
          this.arcs.delete(key);
          const cluster = this.clusters.get(key);
          if (cluster !== undefined && cluster.count === 0) {
            this.clusters.delete(key);
          }
        }
      } else if (arc.t < 1) {
        arc.t = Math.min(arc.t + delta / DRAW_SECONDS, 1);
      }
    }
  }

  private renderBase(): void {
    if (this.width === 0 || this.height === 0 || !this.colors.textFaint) {
      return;
    }
    const ctx = this.baseCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = this.colors.textFaint;
    ctx.globalAlpha = 0.1;
    for (const country of COUNTRIES.features) {
      if (country.geometry === null) {
        continue;
      }
      ctx.beginPath();
      traceGeometry(ctx, country.geometry, this.width, this.height, true);
      ctx.fill("evenodd");
    }

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = this.colors.textFaint;
    ctx.lineWidth = 0.5;
    for (const country of COUNTRIES.features) {
      if (country.geometry === null) {
        continue;
      }
      ctx.beginPath();
      traceGeometry(ctx, country.geometry, this.width, this.height, false);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private paint(): void {
    if (
      this.disposed ||
      !this.visible ||
      this.width === 0 ||
      this.height === 0
    ) {
      return;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const colors = this.colors;
    if (!colors.accent || !colors.textFaint) {
      return;
    }
    const origin = this.origin;
    if (origin === null) {
      return;
    }
    const originX = projectX(origin.lon, this.width);
    const originY = projectY(origin.lat, this.height);

    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    for (const arc of this.arcs.values()) {
      if (arc.t >= 1.6) {
        continue;
      }
      const targetX = projectX(arc.lon, this.width);
      const targetY = projectY(arc.lat, this.height);
      const midX = (originX + targetX) / 2;
      const midY = (originY + targetY) / 2;
      const dx = targetX - originX;
      const dy = targetY - originY;
      const distance = Math.hypot(dx, dy);
      const lift = Math.min(90, distance * 0.35);
      let perpX = distance > 0 ? -dy / distance : 0;
      let perpY = distance > 0 ? dx / distance : 0;
      if (perpY > 0) {
        perpX = -perpX;
        perpY = -perpY;
      }
      const controlX = midX + perpX * lift;
      const controlY = midY + perpY * lift;
      const alpha =
        arc.t > 1 ? Math.max(0, 1 - (arc.t - 1) / FADE_SECONDS) : 1;
      const lineWidth = 1 + Math.min(arc.count, 8) * 0.22;

      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.quadraticCurveTo(controlX, controlY, targetX, targetY);
      ctx.globalAlpha = alpha * 0.32;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      const head =
        arc.t < 1 ? arc.t : arc.closing ? 1 : this.phase;
      if (!arc.closing || arc.t <= 1) {
        for (let point = 0; point < TRAIL_POINTS; point += 1) {
          const t = head - point * 0.018;
          if (t < 0) {
            break;
          }
          const u = 1 - t;
          const x = u * u * originX + 2 * u * t * controlX + t * t * targetX;
          const y = u * u * originY + 2 * u * t * controlY + t * t * targetY;
          const strength = 1 - point / TRAIL_POINTS;
          ctx.globalAlpha = alpha * strength * 0.85;
          ctx.fillStyle = colors.accent;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * strength + 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        const u = 1 - head;
        const headX = u * u * originX + 2 * u * head * controlX + head * head * targetX;
        const headY = u * u * originY + 2 * u * head * controlY + head * head * targetY;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 8;
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.arc(headX, headY, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(targetX, targetY, 2, 0, Math.PI * 2);
      ctx.fill();

      if (arc.count > 1) {
        const label = `×${arc.count}`;
        const badgeWidth = 20 + label.length * 5;
        const badgeHeight = 14;
        const badgeX = Math.min(
          this.width - badgeWidth - 2,
          Math.max(2, targetX + 7),
        );
        const badgeY = Math.max(2, targetY - 26);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors.accent;
        roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 7);
        ctx.fill();
        ctx.fillStyle = colors.background || colors.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          label,
          badgeX + badgeWidth / 2,
          badgeY + badgeHeight / 2 + 0.5,
        );
      }
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(originX, originY, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(originX, originY, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.text || colors.textFaint;
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const labelRight = originX + 44 < this.width;
    ctx.textAlign = labelRight ? "left" : "right";
    ctx.fillText("本机", labelRight ? originX + 11 : originX - 11, originY + 1);
  }
}

export function TrafficMap() {
  const api = useApi();
  const capabilities = usePanelCapabilities();
  const geoipUnsupported =
    capabilities.detected && !capabilities.supports("geoip");
  const connections = useStream(api.connections);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TrafficMapRenderer | null>(null);
  const mounted = useRef(true);
  const activeIds = useRef<Set<string>>(new Set());
  const requested = useRef<Map<string, string>>(new Map());
  const resolved = useRef<Set<string>>(new Set());
  const noGeo = useRef<Set<string>>(new Set());
  const originRef = useRef<Origin | null>(null);
  const originSourceRef = useRef<"egress" | "source" | "fallback" | null>(null);
  const firstSourceRef = useRef<string | null>(null);
  const egressDone = useRef(false);
  const sourceTried = useRef(false);
  const [activeCount, setActiveCount] = useState(0);
  const [databaseMissing, setDatabaseMissing] = useState(() =>
    isGeoIpUnavailable(),
  );

  const handleGeoError = useCallback((error: unknown) => {
    if (!mounted.current) {
      return;
    }
    if (error instanceof GeoIpUnavailableError || isGeoIpUnavailable()) {
      setDatabaseMissing(true);
    }
  }, []);

  const applyOrigin = useCallback(
    (info: GeoIpInfo, source: "egress" | "source" | "fallback") => {
      originRef.current = { lat: info.lat, lon: info.lon };
      originSourceRef.current = source;
      engineRef.current?.setOrigin(info.lat, info.lon);
    },
    [],
  );

  const setFallbackOrigin = useCallback(() => {
    if (originRef.current !== null) {
      return;
    }
    applyOrigin(FALLBACK_ORIGIN, "fallback");
  }, [applyOrigin]);

  const trySourceOrigin = useCallback(() => {
    if (
      !egressDone.current ||
      sourceTried.current ||
      originSourceRef.current === "egress"
    ) {
      return;
    }
    const source = firstSourceRef.current;
    if (source === null) {
      return;
    }
    sourceTried.current = true;
    void lookupGeoIp(source)
      .then((info) => {
        if (info !== null && mounted.current && originSourceRef.current !== "egress") {
          applyOrigin(info, "source");
        }
      })
      .catch(handleGeoError);
  }, [applyOrigin, handleGeoError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) {
      return;
    }
    let renderer: TrafficMapRenderer;
    try {
      renderer = new TrafficMapRenderer(canvas);
    } catch {
      return;
    }
    engineRef.current = renderer;
    if (originRef.current !== null) {
      renderer.setOrigin(originRef.current.lat, originRef.current.lon);
    }

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      renderer.setSize(
        rect.width,
        rect.height,
        Math.min(window.devicePixelRatio || 1, 2),
      );
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(wrap);

    const onVisibility = () => renderer.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    renderer.setVisible(!document.hidden);

    const themeObserver = new MutationObserver(() => renderer.refreshColors());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const onReducedMotion = () =>
      renderer.setReducedMotion(reducedMotionQuery.matches);
    onReducedMotion();
    reducedMotionQuery.addEventListener("change", onReducedMotion);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
      reducedMotionQuery.removeEventListener("change", onReducedMotion);
      renderer.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (geoipUnsupported) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let egress = "";
      try {
        const state = await getPanelState();
        egress = state.egress_ip?.trim() ?? "";
      } catch {
        // 面板状态不可用时继续走 sourceIp / fallback。
      }
      if (cancelled || !mounted.current) {
        return;
      }
      if (egress !== "") {
        try {
          const info = await lookupGeoIp(egress);
          if (!cancelled && info !== null) {
            applyOrigin(info, "egress");
          }
        } catch (error) {
          handleGeoError(error);
        }
      }
      egressDone.current = true;
      if (!cancelled && originRef.current === null) {
        setFallbackOrigin();
      }
      if (!cancelled) {
        trySourceOrigin();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyOrigin, geoipUnsupported, handleGeoError, setFallbackOrigin, trySourceOrigin]);

  useEffect(() => {
    const renderer = engineRef.current;
    if (renderer === null) {
      return;
    }
    if (geoipUnsupported) {
      setActiveCount(0);
      return;
    }
    const rows = connections.data.rows;
    const nextActive = new Set<string>();
    let firstSource: string | null = null;

    for (const [id, row] of rows) {
      if (row.closedAt !== null) {
        continue;
      }
      nextActive.add(id);
      if (firstSource === null) {
        const source = hostFromAddress(row.connection.source);
        if (isIpAddress(source)) {
          firstSource = source;
        }
      }
      const destination = hostFromAddress(row.connection.destination);
      if (!isIpAddress(destination)) {
        continue;
      }
      if (
        resolved.current.has(id) ||
        requested.current.has(id) ||
        noGeo.current.has(id)
      ) {
        continue;
      }
      requested.current.set(id, destination);
      void lookupGeoIp(destination)
        .then((info) => {
          requested.current.delete(id);
          if (!mounted.current || !activeIds.current.has(id)) {
            return;
          }
          if (info === null) {
            noGeo.current.add(id);
            return;
          }
          renderer.addConnection(id, info.lat, info.lon);
          resolved.current.add(id);
        })
        .catch((error: unknown) => {
          requested.current.delete(id);
          handleGeoError(error);
        });
    }

    for (const id of activeIds.current) {
      if (!nextActive.has(id)) {
        if (resolved.current.has(id)) {
          renderer.removeConnection(id);
          resolved.current.delete(id);
        }
        requested.current.delete(id);
        noGeo.current.delete(id);
      }
    }
    activeIds.current = nextActive;
    firstSourceRef.current = firstSource;
    setActiveCount((current) =>
      current === nextActive.size ? current : nextActive.size,
    );
    trySourceOrigin();
  }, [connections.data.rows, geoipUnsupported, handleGeoError, trySourceOrigin]);

  const emptyLabel =
    geoipUnsupported
      ? ""
      : !connections.data.loaded
      ? connections.phase === "error"
        ? "连接流不可用"
        : "正在加载连接…"
      : activeCount === 0
        ? "暂无活跃连接"
        : "";

  return (
    <Card
      wide
      icon="language"
      title="全球连接"
      actions={<span className={styles.legend}>{activeCount} 条活跃</span>}
    >
      {databaseMissing && (
        <div className={styles.dbWarning}>
          missing GeoIP database, see README
        </div>
      )}
      {geoipUnsupported && (
        <div className={styles.dbWarning}>
          当前 sing-box-panel 不支持 GeoIP 查询；升级到 0.1.0-8 后显示全球连接。
        </div>
      )}
      <div className={styles.wrap} ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="全球连接实时流量地图"
        />
        {emptyLabel !== "" && (
          <div className={styles.overlay}>
            <span className={styles.empty}>{emptyLabel}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
