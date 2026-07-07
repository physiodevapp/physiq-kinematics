"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { CanvasKeypointName } from "@/interfaces/pose";
import type { KinematicsSeries, KinematicsSeriesEntry } from "@/interfaces/kinematics";
import { formatJointName, getColorsForJoint } from "@/utils/joint";

const PAD = { top: 16, right: 8, bottom: 28, left: 36 };

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${(s % 60).toString().padStart(2, "0")}` : `${s}s`;
}

function angleAt(entry: KinematicsSeriesEntry, ms: number): number | null {
  const { t, a } = entry;
  if (t.length === 0) return null;
  let lo = 0, hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < ms) lo = mid + 1; else hi = mid;
  }
  if (lo > 0) {
    const f = (ms - t[lo - 1]) / (t[lo] - t[lo - 1]);
    return a[lo - 1] + f * (a[lo] - a[lo - 1]);
  }
  return a[0];
}

function interpolateRange(
  series: KinematicsSeries,
  startMs: number,
  endMs: number,
): KinematicsSeries {
  const result: KinematicsSeries = {};
  for (const joint of Object.keys(series)) {
    const entry = series[joint];
    const { t, a } = entry;
    const newA = [...a];
    const vStart = angleAt(entry, startMs) ?? a[0];
    const vEnd = angleAt(entry, endMs) ?? a[a.length - 1];
    const span = endMs - startMs;
    for (let i = 0; i < t.length; i++) {
      if (t[i] > startMs && t[i] < endMs && span > 0) {
        newA[i] = Math.round(vStart + ((t[i] - startMs) / span) * (vEnd - vStart));
      }
    }
    result[joint] = { t, a: newA };
  }
  return result;
}

function paintChart(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, dpr: number,
  joints: CanvasKeypointName[],
  series: KinematicsSeries,
  dur: number,
  curMs: number,
  yMax: number,
  selRange?: { start: number; end: number } | null,
) {
  if (dur === 0 || W === 0 || H === 0) return;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const tx = (ms: number) => PAD.left + (ms / dur) * plotW;
  const ay = (a: number) => PAD.top + plotH * (1 - Math.min(Math.max(a, 0), yMax) / yMax);

  ctx.font = "9px 'DM Mono', monospace";

  // Y grid lines + labels
  const gridA = yMax === 90 ? [45] : yMax === 135 ? [45, 90] : [45, 90, 135];
  for (const deg of gridA) {
    const y = ay(deg);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "right";
    ctx.fillText(`${deg}°`, PAD.left - 4, y + 3);
  }
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "right";
  ctx.fillText("0°", PAD.left - 4, PAD.top + plotH + 4);
  ctx.fillText(`${yMax}°`, PAD.left - 4, PAD.top + 4);

  // X axis time labels + light grid
  const totalSec = dur / 1000;
  const step = totalSec <= 30 ? 10 : totalSec <= 120 ? 30 : 60;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "center";
  ctx.fillText(fmtTime(0), PAD.left, H - 4);
  ctx.fillText(fmtTime(dur), PAD.left + plotW, H - 4);
  for (let t = step * 1000; t < dur - step * 400; t += step * 1000) {
    const x = tx(t);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(fmtTime(t), x, H - 4);
  }

  // Joint angle lines
  for (const joint of joints) {
    const e = series[joint];
    if (!e || e.t.length < 2) continue;
    ctx.strokeStyle = getColorsForJoint(joint).borderColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < e.t.length; i++) {
      const x = tx(e.t[i]);
      const y = ay(e.a[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Selection range overlay
  if (selRange) {
    const sx = tx(Math.max(selRange.start, 0));
    const ex = tx(Math.min(selRange.end, dur));
    ctx.fillStyle = "rgba(93,173,236,0.15)";
    ctx.fillRect(sx, PAD.top, ex - sx, plotH);
    ctx.strokeStyle = "#5dadec";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, PAD.top);
    ctx.lineTo(sx, PAD.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, PAD.top);
    ctx.lineTo(ex, PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Cursor vertical line
  const cx = tx(Math.min(Math.max(curMs, 0), dur));
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, PAD.top);
  ctx.lineTo(cx, PAD.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dots + labels at cursor position
  const LINE_H = 11;
  type CL = { color: string; text: string; y: number };
  const cursorLabels: CL[] = [];
  for (const joint of joints) {
    const e = series[joint];
    if (!e) continue;
    const angle = angleAt(e, curMs);
    if (angle === null) continue;
    const y = ay(angle);
    ctx.fillStyle = getColorsForJoint(joint).borderColor;
    ctx.beginPath();
    ctx.arc(cx, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    cursorLabels.push({
      color: getColorsForJoint(joint).borderColor,
      text: `${formatJointName(joint)} ${Math.round(angle)}°`,
      y,
    });
  }

  cursorLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < cursorLabels.length; i++) {
    if (cursorLabels[i].y < cursorLabels[i - 1].y + LINE_H)
      cursorLabels[i].y = cursorLabels[i - 1].y + LINE_H;
  }

  const onRight = cx < PAD.left + plotW / 2;
  ctx.textAlign = onRight ? "left" : "right";
  const lx = onRight ? cx + 5 : cx - 5;
  for (const { color, text, y } of cursorLabels) {
    const textWidth = ctx.measureText(text).width;
    const boxX = onRight ? lx - 2 : lx - textWidth - 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(boxX, y - 7, textWidth + 4, 10);
    ctx.fillStyle = color;
    ctx.fillText(text, lx, y + 3);
  }

  ctx.restore();
}

interface Props {
  series: KinematicsSeries;
  duration: number;
  joints: CanvasKeypointName[];
  recordingNumber: number;
  onSend: (series: KinematicsSeries) => void;
  onDiscard: () => void;
  onAcceptAndRecordAnother: (series: KinematicsSeries) => void;
}

export default function KinematicsReview({
  series,
  duration,
  joints,
  recordingNumber,
  onSend,
  onDiscard,
  onAcceptAndRecordAnother,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const curMsRef = useRef(0);
  const draggingRef = useRef(false);
  const needsRepaintRef = useRef(false);

  const [workingSeries, setWorkingSeries] = useState<KinematicsSeries>(() => series);
  const workingSeriesRef = useRef<KinematicsSeries>(series);
  const [editMode, setEditMode] = useState(false);
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const selRangeRef = useRef<{ start: number; end: number } | null>(null);
  const editAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    workingSeriesRef.current = workingSeries;
    needsRepaintRef.current = true;
  }, [workingSeries]);

  const yMax = useMemo(() => {
    let mx = 0;
    for (const j of joints) {
      const e = series[j];
      if (e) for (const v of e.a) if (v > mx) mx = v;
    }
    return mx <= 90 ? 90 : mx <= 135 ? 135 : 180;
  }, [joints, series]);

  // rAF loop: resize canvas and repaint when cursor or series changes
  useEffect(() => {
    let rafId: number;
    let lastCurMs = -1;
    let lastW = 0, lastH = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      const cv = canvasRef.current;
      if (!cv) return;
      const W = cv.offsetWidth, H = cv.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(W * dpr);
      const targetH = Math.round(H * dpr);
      if (cv.width !== targetW || cv.height !== targetH) {
        cv.width = targetW;
        cv.height = targetH;
      }

      if (
        needsRepaintRef.current ||
        Math.abs(curMsRef.current - lastCurMs) > 20 ||
        W !== lastW ||
        H !== lastH
      ) {
        const ctx = cv.getContext("2d");
        if (ctx) {
          paintChart(
            ctx, W, H, dpr, joints,
            workingSeriesRef.current,
            duration, curMsRef.current, yMax,
            selRangeRef.current,
          );
        }
        lastCurMs = curMsRef.current;
        lastW = W;
        lastH = H;
        needsRepaintRef.current = false;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [joints, duration, yMax]);

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;
  const handleGoHome = useCallback(() => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
  }, []);

  const chartTimeFromClientX = (clientX: number): number => {
    const cv = canvasRef.current;
    if (!cv || duration === 0) return 0;
    const rect = cv.getBoundingClientRect();
    const plotW = rect.width - PAD.left - PAD.right;
    return Math.min(Math.max((clientX - rect.left - PAD.left) / plotW, 0), 1) * duration;
  };

  const handleInterpolate = () => {
    const r = selRangeRef.current;
    if (!r) return;
    const updated = interpolateRange(workingSeriesRef.current, r.start, r.end);
    workingSeriesRef.current = updated;
    setWorkingSeries(updated);
    selRangeRef.current = null;
    setSelRange(null);
    needsRepaintRef.current = true;
  };

  const handleCancelSelection = () => {
    selRangeRef.current = null;
    setSelRange(null);
    needsRepaintRef.current = true;
  };

  const toggleEditMode = () => {
    setEditMode(prev => {
      if (prev) {
        selRangeRef.current = null;
        setSelRange(null);
        needsRepaintRef.current = true;
      }
      return !prev;
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-black/60">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-display text-white text-base inline-flex items-center gap-1.5">
            {isInIframe && (
              <span
                className="animate-hub-back-hint transition-opacity duration-150 hover:opacity-100 cursor-pointer"
                style={{ opacity: 0.55 }}
                onClick={handleGoHome}
              >‹</span>
            )}
            <span
              className={isInIframe ? "cursor-pointer transition-opacity duration-150 hover:opacity-75" : ""}
              onClick={isInIframe ? handleGoHome : undefined}
            >Physi<span style={{ background: "linear-gradient(135deg,#4f9cf9,#38d9a9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Q</span></span>
            <span className="opacity-50 font-normal">—</span>
            <span style={{ color: "#5dadec" }}>Kinematics</span>
          </h2>
          <button onClick={onDiscard} className="p-1 -mr-1">
            <XMarkIcon className="h-5 w-5 text-white/50" />
          </button>
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="font-mono text-xs text-white/40">Grabación {recordingNumber}</span>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleEditMode}
              className="flex items-center gap-1 text-xs active:opacity-70 transition-colors"
              style={editMode ? { color: "#5dadec" } : { color: "rgba(255,255,255,0.7)" }}
            >
              <PencilSquareIcon className="h-4 w-4" />
              Editar
            </button>
            <button
              onClick={() => onAcceptAndRecordAnother(workingSeries)}
              className="flex items-center gap-1 text-xs text-white/70 active:opacity-70"
            >
              <CameraIcon className="h-4 w-4" />
              Cámara
            </button>
          </div>
        </div>
      </div>

      {/* Angle chart — fills all available space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          style={editMode ? { cursor: "crosshair" } : undefined}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            if (editMode) {
              const t = chartTimeFromClientX(e.clientX);
              editAnchorRef.current = t;
              selRangeRef.current = null;
              setSelRange(null);
              needsRepaintRef.current = true;
            } else {
              draggingRef.current = true;
              const t = chartTimeFromClientX(e.clientX);
              curMsRef.current = t;
              needsRepaintRef.current = true;
            }
          }}
          onPointerMove={(e) => {
            if (editMode) {
              if (editAnchorRef.current === null) return;
              const t = chartTimeFromClientX(e.clientX);
              const anchor = editAnchorRef.current;
              const r = { start: Math.min(anchor, t), end: Math.max(anchor, t) };
              selRangeRef.current = r;
              setSelRange(r);
              needsRepaintRef.current = true;
            } else {
              if (!draggingRef.current) return;
              curMsRef.current = chartTimeFromClientX(e.clientX);
              needsRepaintRef.current = true;
            }
          }}
          onPointerUp={() => {
            if (editMode) {
              const r = selRangeRef.current;
              if (r && (r.end - r.start) < 500) {
                selRangeRef.current = null;
                setSelRange(null);
                needsRepaintRef.current = true;
              }
              editAnchorRef.current = null;
            } else {
              draggingRef.current = false;
            }
          }}
          onPointerCancel={() => {
            editAnchorRef.current = null;
            draggingRef.current = false;
          }}
        />
      </div>

      {/* Edit action bar */}
      {editMode && (
        <div className="shrink-0 flex gap-3 px-4 pt-2">
          <button
            onClick={handleCancelSelection}
            className="flex-1 py-2 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
          >
            Cancelar selección
          </button>
          <button
            disabled={!selRange}
            onClick={handleInterpolate}
            className="flex-1 py-2 rounded-md text-sm text-white font-medium active:opacity-80 disabled:opacity-30"
            style={{ background: "#5dadec" }}
          >
            Interpolar tramo
          </button>
        </div>
      )}

      {/* Action buttons */}
      {!editMode && <div className="shrink-0 flex gap-3 px-4 py-4">
        <button
          onClick={onDiscard}
          className="flex-1 py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
        >
          Descartar
        </button>
        <button
          onClick={() => onSend(workingSeries)}
          className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
          style={{ background: "#5dadec" }}
        >
          Enviar al informe
        </button>
      </div>}
    </div>
  );
}
