"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  FilmIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useDraggableSheet } from "@/hooks/useDraggableSheet";
import type { CanvasKeypointName } from "@/interfaces/pose";
import type { KinematicsSeries, KinematicsSeriesEntry } from "@/interfaces/kinematics";
import { formatJointName, getColorsForJoint } from "@/utils/joint";
import { readSession, writeSession, clearSession } from "@/utils/session";

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
  yMin: number,
  yMax: number,
  selRange: { start: number; end: number } | null | undefined,
  viewStart: number,
  viewEnd: number,
) {
  if (dur === 0 || W === 0 || H === 0) return;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const viewSpan = viewEnd - viewStart;
  const ySpan = yMax - yMin;
  const tx = (ms: number) => PAD.left + ((ms - viewStart) / viewSpan) * plotW;
  const ay = (a: number) => PAD.top + plotH * (1 - (Math.min(Math.max(a, yMin), yMax) - yMin) / ySpan);

  ctx.font = "9px 'DM Mono', monospace";

  // Y grid lines + labels
  const gridA = [45, 90, 135].filter(v => v > yMin && v < yMax);
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
  ctx.fillText(`${Math.round(yMin)}°`, PAD.left - 4, PAD.top + plotH + 4);
  ctx.fillText(`${Math.round(yMax)}°`, PAD.left - 4, PAD.top + 4);

  // X axis time labels + light grid (adaptive to visible span)
  const visibleSec = viewSpan / 1000;
  const step = visibleSec <= 5 ? 1 : visibleSec <= 15 ? 2 : visibleSec <= 30 ? 5 : visibleSec <= 120 ? 10 : 30;
  const stepMs = step * 1000;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "center";
  ctx.fillText(fmtTime(viewStart), PAD.left, H - 10);
  ctx.fillText(fmtTime(viewEnd), PAD.left + plotW, H - 10);
  const gridStart = Math.ceil(viewStart / stepMs) * stepMs;
  for (let t = gridStart; t < viewEnd - stepMs * 0.2; t += stepMs) {
    if (t <= viewStart) continue;
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
    ctx.fillText(fmtTime(t), x, H - 10);
  }

  // Joint angle lines (clip to plot area so out-of-view segments don't bleed)
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, plotH);
  ctx.clip();
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
  ctx.restore();

  // Selection range overlay
  if (selRange) {
    const sx = tx(Math.max(selRange.start, viewStart));
    const ex = tx(Math.min(selRange.end, viewEnd));
    if (ex > sx) {
      ctx.fillStyle = "rgba(93,173,236,0.15)";
      ctx.fillRect(sx, PAD.top, ex - sx, plotH);
      ctx.strokeStyle = "#5dadec";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      if (selRange.start >= viewStart) {
        ctx.beginPath();
        ctx.moveTo(sx, PAD.top);
        ctx.lineTo(sx, PAD.top + plotH);
        ctx.stroke();
      }
      if (selRange.end <= viewEnd) {
        ctx.beginPath();
        ctx.moveTo(ex, PAD.top);
        ctx.lineTo(ex, PAD.top + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // Cursor vertical line — only if inside the view window
  if (curMs >= viewStart && curMs <= viewEnd) {
    const cx = tx(curMs);
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
    const PILL_PX = 4;
    const PILL_PY = 3;
    const PILL_H = LINE_H + 9 + 2 + PILL_PY * 2; // two-line pill, matches AngleGraph
    const MIN_GAP = PILL_H + 2;
    const DOT_R = 3;
    const DOT_TOTAL = DOT_R * 2 + 4; // dot diameter + margin to text

    type CL = { color: string; name: string; angleStr: string; rawY: number; labelY: number };
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
        name: formatJointName(joint),
        angleStr: `${Math.round(angle)}°`,
        rawY: y,
        labelY: y,
      });
    }

    cursorLabels.sort((a, b) => a.rawY - b.rawY);
    for (let i = 1; i < cursorLabels.length; i++) {
      if (cursorLabels[i].labelY < cursorLabels[i - 1].labelY + MIN_GAP)
        cursorLabels[i].labelY = cursorLabels[i - 1].labelY + MIN_GAP;
    }
    for (let i = cursorLabels.length - 2; i >= 0; i--) {
      if (cursorLabels[i].labelY + MIN_GAP > cursorLabels[i + 1].labelY)
        cursorLabels[i].labelY = cursorLabels[i + 1].labelY - MIN_GAP;
    }

    const onRight = cx < PAD.left + plotW / 2;
    ctx.textAlign = onRight ? "left" : "right";
    const lx = onRight ? cx + 8 : cx - 8;

    for (const { color, name, angleStr, rawY, labelY } of cursorLabels) {
      const maxW = Math.max(ctx.measureText(name).width, ctx.measureText(angleStr).width);

      if (Math.abs(labelY - rawY) > 3) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 0.75;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, rawY);
        ctx.lineTo(onRight ? lx - PILL_PX : lx + PILL_PX, labelY);
        ctx.stroke();
        ctx.restore();
      }

      const pillX = onRight ? lx - PILL_PX : lx - maxW - PILL_PX - DOT_TOTAL;
      const pillY = labelY - 7 - PILL_PY;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, maxW + PILL_PX * 2 + DOT_TOTAL, PILL_H, 3);
      ctx.fill();

      const dotX = pillX + PILL_PX + DOT_R;
      const dotY = labelY - 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dotX, dotY, DOT_R, 0, Math.PI * 2);
      ctx.fill();

      const textLx = onRight ? lx + DOT_TOTAL : lx;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(name, textLx, labelY);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(angleStr, textLx, labelY + LINE_H);
    }
  }

  // X zoom scrollbar indicator — thin bar at bottom, only when zoomed in
  if (viewStart > 0 || viewEnd < dur) {
    const barY = H - 2;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(PAD.left, barY, plotW, 2);
    const sx = PAD.left + (viewStart / dur) * plotW;
    const ex = PAD.left + (viewEnd / dur) * plotW;
    ctx.fillStyle = "rgba(93,173,236,0.7)";
    ctx.fillRect(sx, barY, ex - sx, 2);
  }

  // Y pan scrollbar indicator — thin bar on left edge, only when Y view is panned
  if (yMin > 0 || yMax < 180) {
    const barX = 1;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(barX, PAD.top, 2, plotH);
    const sy = PAD.top + (1 - yMax / 180) * plotH;
    const ey = PAD.top + (1 - yMin / 180) * plotH;
    ctx.fillStyle = "rgba(93,173,236,0.7)";
    ctx.fillRect(barX, sy, 2, ey - sy);
  }

  ctx.restore();
}

interface SessionPanelProps {
  patientLabel: string;
  patientInput: string;
  clearConfirm: boolean;
  onPatientChange: (v: string) => void;
  onPatientSave: () => void;
  onClearRequest: () => void;
  onClearConfirm: () => void;
  onClearCancel: () => void;
  onClose: () => void;
}

function SessionPanel({
  patientLabel,
  patientInput,
  clearConfirm,
  onPatientChange,
  onPatientSave,
  onClearRequest,
  onClearConfirm,
  onClearCancel,
  onClose,
}: SessionPanelProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetHandle = useDraggableSheet(sheetRef, onClose, { allowExpand: false });

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={() => sheetHandle.close()} />
      <div
        ref={sheetRef}
        className="absolute bottom-0 inset-x-0 z-[1] rounded-t-2xl animate-slide-up touch-none"
        style={{
          background: "#111620",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div className="w-8 h-1 bg-white/30 rounded-full mx-auto mt-2 shrink-0 touch-none" />
        <div className="px-4 pt-3 pb-10">
          {patientLabel && (
            <p className="font-mono text-xs tracking-widest mb-4" style={{ color: "#5dadec" }}>
              {patientLabel}
            </p>
          )}
          {!clearConfirm ? (
            <div>
              <label
                className="font-mono text-xs tracking-widest block mb-1.5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                PACIENTE
              </label>
              <div className="flex gap-2 items-center">
                <input
                  value={patientInput}
                  onChange={(e) => onPatientChange(e.target.value)}
                  onBlur={onPatientSave}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  placeholder="Nombre del paciente..."
                  className="flex-1 rounded-md px-3 py-2.5 text-white text-sm outline-none transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    caretColor: "#5dadec",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#5dadec"; }}
                />
                {patientLabel && (
                  <button
                    onClick={onClearRequest}
                    className="shrink-0 rounded-md p-2.5 active:opacity-70 transition-opacity"
                    style={{ border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444" }}
                    aria-label="Borrar sesión"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-white text-sm text-center py-1">
                ¿Borrar y empezar de nuevo?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClearCancel}
                  className="flex-1 py-3 rounded-md text-sm active:bg-white/5"
                  style={{ color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={onClearConfirm}
                  className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
                  style={{ background: "#5dadec" }}
                >
                  Borrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  series: KinematicsSeries;
  duration: number;
  joints: CanvasKeypointName[];
  recordingNumber: number;
  mode: 'new' | 'saved';
  onSend: (series: KinematicsSeries) => void;
  onDiscard: () => void;
  onAcceptAndRecordAnother: (series: KinematicsSeries) => void;
  onBackToList?: (series: KinematicsSeries) => void;
  onOpenList?: (series: KinematicsSeries) => void;
}

export default function KinematicsReview({
  series,
  duration,
  joints,
  recordingNumber,
  mode,
  onSend,
  onDiscard,
  onAcceptAndRecordAnother,
  onBackToList,
  onOpenList,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const curMsRef = useRef(0);
  const draggingRef = useRef(false);
  const needsRepaintRef = useRef(false);

  // Zoom: view window in ms, multi-pointer tracking, pinch state, double-tap
  const viewRef = useRef({ start: 0, end: duration });
  const yViewRef = useRef({ yMin: 0, yMax: 180 });
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    initialDist: number;
    initialStart: number;
    initialEnd: number;
    initMidMs: number;
    initMidY: number;
    initYMin: number;
    initYMax: number;
  } | null>(null);
  const lastTapRef = useRef(0);

  const [workingSeries, setWorkingSeries] = useState<KinematicsSeries>(() => series);
  const workingSeriesRef = useRef<KinematicsSeries>(series);
  const [editMode, setEditMode] = useState(false);
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const selRangeRef = useRef<{ start: number; end: number } | null>(null);
  const editAnchorRef = useRef<number | null>(null);
  const [prevWorkingSeries, setPrevWorkingSeries] = useState<KinematicsSeries | null>(null);
  const [minRangeMs, setMinRangeMs] = useState(500);
  const [showSlider, setShowSlider] = useState(false);

  const [patient, setPatient] = useState("");
  const [patientInput, setPatientInput] = useState("");
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [showTranslateBanner, setShowTranslateBanner] = useState(false);
  const translateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    observer.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    readSession().then((s) => {
      if (s?.patient) setPatient(s.patient);
    });

    const ch = new BroadcastChannel("physiq-session");
    ch.onmessage = (e) => {
      if (e.data?.type === "SESSION_PATIENT") {
        setPatient(e.data.patient ?? "");
      } else if (e.data?.type === "SESSION_CLEAR") {
        setPatient("");
      }
    };
    return () => ch.close();
  }, []);

  const handlePatientSave = async () => {
    const trimmed = patientInput.trim();
    setPatient(trimmed);
    await writeSession({ patient: trimmed });
    const ch = new BroadcastChannel("physiq-session");
    ch.postMessage({ type: "SESSION_PATIENT", patient: trimmed });
    ch.close();
  };

  const handleClearSession = async () => {
    await clearSession();
    const ch = new BroadcastChannel("physiq-session");
    ch.postMessage({ type: "SESSION_CLEAR" });
    ch.close();
    setPatient("");
    setClearConfirm(false);
    setShowSessionPanel(false);
  };

  const handleOpenSessionPanel = () => {
    setPatientInput(patient);
    setClearConfirm(false);
    setShowSessionPanel(true);
  };

  const handleTranslate = () => {
    setShowTranslateBanner(true);
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    translateTimerRef.current = setTimeout(() => setShowTranslateBanner(false), 4000);
  };

  const hideTranslateBanner = () => {
    if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
    setShowTranslateBanner(false);
  };

  useEffect(() => {
    workingSeriesRef.current = workingSeries;
    needsRepaintRef.current = true;
  }, [workingSeries]);

  useEffect(() => {
    const r = selRangeRef.current;
    if (r && (r.end - r.start) < minRangeMs) {
      selRangeRef.current = null;
      setSelRange(null);
      needsRepaintRef.current = true;
    }
  }, [minRangeMs]);

  const yMax = useMemo(() => {
    let mx = 0;
    for (const j of joints) {
      const e = series[j];
      if (e) for (const v of e.a) if (v > mx) mx = v;
    }
    return mx <= 90 ? 90 : mx <= 135 ? 135 : 180;
  }, [joints, series]);

  // Reset view window when duration changes (new recording opened)
  useEffect(() => {
    viewRef.current = { start: 0, end: duration };
    needsRepaintRef.current = true;
  }, [duration]);

  // Reset Y view when the computed Y ceiling changes (different joints selected)
  useEffect(() => {
    yViewRef.current = { yMin: 0, yMax: yMax };
    needsRepaintRef.current = true;
  }, [yMax]);

  // rAF loop: resize canvas and repaint when cursor, series, or view changes
  useEffect(() => {
    let rafId: number;
    let lastCurMs = -1;
    let lastW = 0, lastH = 0;
    let lastViewStart = -1, lastViewEnd = -1;
    let lastYMin = -1, lastYMax = -1;

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

      const { start: vStart, end: vEnd } = viewRef.current;
      const { yMin: vYMin, yMax: vYMax } = yViewRef.current;
      if (
        needsRepaintRef.current ||
        Math.abs(curMsRef.current - lastCurMs) > 20 ||
        W !== lastW ||
        H !== lastH ||
        vStart !== lastViewStart ||
        vEnd !== lastViewEnd ||
        vYMin !== lastYMin ||
        vYMax !== lastYMax
      ) {
        const ctx = cv.getContext("2d");
        if (ctx) {
          paintChart(
            ctx, W, H, dpr, joints,
            workingSeriesRef.current,
            duration, curMsRef.current, vYMin, vYMax,
            selRangeRef.current,
            vStart, vEnd,
          );
        }
        lastCurMs = curMsRef.current;
        lastW = W;
        lastH = H;
        lastViewStart = vStart;
        lastViewEnd = vEnd;
        lastYMin = vYMin;
        lastYMax = vYMax;
        needsRepaintRef.current = false;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [joints, duration]);

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;
  const handleGoHome = useCallback(() => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
  }, []);

  const chartTimeFromClientX = (clientX: number): number => {
    const cv = canvasRef.current;
    if (!cv || duration === 0) return 0;
    const rect = cv.getBoundingClientRect();
    const plotW = rect.width - PAD.left - PAD.right;
    const frac = Math.min(Math.max((clientX - rect.left - PAD.left) / plotW, 0), 1);
    const { start, end } = viewRef.current;
    return start + frac * (end - start);
  };

  const handleInterpolate = () => {
    const r = selRangeRef.current;
    if (!r) return;
    setPrevWorkingSeries(workingSeriesRef.current);
    const updated = interpolateRange(workingSeriesRef.current, r.start, r.end);
    workingSeriesRef.current = updated;
    setWorkingSeries(updated);
    selRangeRef.current = null;
    setSelRange(null);
    needsRepaintRef.current = true;
  };

  const handleUndo = () => {
    if (!prevWorkingSeries) return;
    workingSeriesRef.current = prevWorkingSeries;
    setWorkingSeries(prevWorkingSeries);
    setPrevWorkingSeries(null);
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
        setPrevWorkingSeries(null);
        setShowSlider(false);
        needsRepaintRef.current = true;
      }
      return !prev;
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div ref={headerRef} className="shrink-0 bg-black/60 relative z-10">
        <div className="flex items-center justify-between px-4 py-3 [@media(max-height:500px)_and_(max-width:900px)]:py-1.5">
          <h2 className="font-display text-white text-[1.1rem] min-[480px]:text-[1.2rem] min-[769px]:text-[1.5rem] inline-flex items-center gap-1.5" style={{ letterSpacing: "-0.5px" }}>
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
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenSessionPanel}
              className="active:opacity-70 transition-opacity"
              aria-label="Sesión"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={patient ? { color: "#5dadec" } : { color: "rgba(255,255,255,0.5)" }}>
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>
              </svg>
            </button>
            <button
              onClick={handleTranslate}
              className="active:opacity-70 transition-opacity"
              style={{ color: "#5a6e8a" }}
              aria-label="View in English"
              title="Long-press or right-click → Translate to English"
            >
              🌐
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 pb-2 [@media(max-height:500px)_and_(max-width:900px)]:pb-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAcceptAndRecordAnother(workingSeries)}
              className="flex items-center gap-1.5 active:opacity-70 transition-opacity"
              style={{
                color: "#8aa4bc",
                border: "1px solid #232d45",
                background: "transparent",
                borderRadius: 8,
                padding: "5px 10px",
                fontFamily: "'DM Mono', monospace",
                fontSize: "11px",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              <span className="leading-none">←</span>
              <span>Cámara</span>
            </button>
            <span className="font-mono text-xs text-white/40">Grabación {recordingNumber}</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleEditMode}
              className="flex items-center gap-1 text-sm active:opacity-70 transition-colors"
              style={editMode ? { color: "#5dadec" } : { color: "rgba(255,255,255,0.7)" }}
            >
              <PencilSquareIcon className="h-5 w-5" />
              Editar
            </button>
            {onOpenList && (
              <button
                onClick={() => onOpenList(workingSeries)}
                className="flex items-center gap-1 text-sm text-white/70 active:opacity-70"
              >
                <FilmIcon className="h-5 w-5" />
                Lista
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Translate banner — slides from behind header */}
      {headerHeight > 0 && (
        <div
          className="absolute left-0 right-0 flex items-center gap-2 px-4 border-b border-white/10"
          style={{
            top: headerHeight,
            zIndex: 5,
            height: 40,
            background: "#111620",
            transform: showTranslateBanner ? "translateY(0)" : "translateY(-100%)",
            opacity: showTranslateBanner ? 1 : 0,
            transition: "transform 0.25s ease, opacity 0.25s ease",
          }}
        >
          <span className="text-sm">🌐</span>
          <span className="text-white/60 text-xs flex-1">
            Long-press or right-click → Translate to English
          </span>
          <button
            onClick={hideTranslateBanner}
            className="text-white/40 text-base leading-none active:opacity-70"
          >
            ✕
          </button>
        </div>
      )}

      {/* Spacer — pushes chart down in sync with the translate banner */}
      <div
        className="shrink-0"
        style={{
          height: showTranslateBanner ? 40 : 0,
          transition: "height 0.25s ease",
        }}
      />

      {/* Angle chart — fills all available space */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          style={editMode ? { cursor: "crosshair" } : undefined}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (activePointersRef.current.size === 2) {
              // Second finger down — start 2-finger pan+zoom, cancel any single-finger action
              editAnchorRef.current = null;
              draggingRef.current = false;
              const pointers = [...activePointersRef.current.values()];
              const dist = Math.abs(pointers[1].x - pointers[0].x);
              const midX = (pointers[0].x + pointers[1].x) / 2;
              const midY = (pointers[0].y + pointers[1].y) / 2;
              pinchRef.current = {
                initialDist: dist,
                initialStart: viewRef.current.start,
                initialEnd: viewRef.current.end,
                initMidMs: chartTimeFromClientX(midX),
                initMidY: midY,
                initYMin: yViewRef.current.yMin,
                initYMax: yViewRef.current.yMax,
              };
              return;
            }

            // Double-tap detection: reset zoom
            const now = Date.now();
            if (now - lastTapRef.current < 280) {
              viewRef.current = { start: 0, end: duration };
              needsRepaintRef.current = true;
              lastTapRef.current = 0;
              return;
            }
            lastTapRef.current = now;

            // Single finger: data interaction (scrub or range-select)
            if (editMode) {
              const t = chartTimeFromClientX(e.clientX);
              editAnchorRef.current = t;
              selRangeRef.current = null;
              setSelRange(null);
              needsRepaintRef.current = true;
            } else {
              draggingRef.current = true;
            }
          }}
          onPointerMove={(e) => {
            activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            // 2-finger: simultaneous X pan+zoom and Y pan
            if (pinchRef.current && activePointersRef.current.size === 2) {
              const cv = canvasRef.current;
              if (!cv) return;
              const rect = cv.getBoundingClientRect();
              const plotW = rect.width - PAD.left - PAD.right;
              const plotH = rect.height - PAD.top - PAD.bottom;
              const pointers = [...activePointersRef.current.values()];
              const currentDist = Math.abs(pointers[1].x - pointers[0].x);
              const currentMidX = (pointers[0].x + pointers[1].x) / 2;
              const currentMidY = (pointers[0].y + pointers[1].y) / 2;
              const { initialDist, initialStart, initialEnd, initMidMs, initMidY, initYMin, initYMax } = pinchRef.current;

              // X axis: pinch-zoom + pan
              const initialSpan = initialEnd - initialStart;
              const zoomFactor = currentDist / initialDist;
              const newSpan = Math.max(500, Math.min(duration, initialSpan / zoomFactor));
              const currentFrac = (currentMidX - rect.left - PAD.left) / plotW;
              let newStart = initMidMs - currentFrac * newSpan;
              let newEnd = newStart + newSpan;
              if (newStart < 0) { newStart = 0; newEnd = Math.min(duration, newSpan); }
              if (newEnd > duration) { newEnd = duration; newStart = Math.max(0, duration - newSpan); }
              viewRef.current = { start: newStart, end: newEnd };

              // Y axis: vertical pan — moving fingers up shifts range up (shows higher angles)
              const ySpan = initYMax - initYMin;
              const yDelta = (initMidY - currentMidY) * (ySpan / plotH);
              let newYMin = initYMin + yDelta;
              let newYMax = initYMax + yDelta;
              if (newYMin < 0) { newYMin = 0; newYMax = Math.min(180, ySpan); }
              if (newYMax > 180) { newYMax = 180; newYMin = Math.max(0, 180 - ySpan); }
              yViewRef.current = { yMin: newYMin, yMax: newYMax };

              needsRepaintRef.current = true;
              return;
            }

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
          onPointerUp={(e) => {
            activePointersRef.current.delete(e.pointerId);
            if (pinchRef.current) {
              if (activePointersRef.current.size < 2) pinchRef.current = null;
              return;
            }
            if (editMode) {
              const r = selRangeRef.current;
              if (r && (r.end - r.start) < minRangeMs) {
                selRangeRef.current = null;
                setSelRange(null);
                needsRepaintRef.current = true;
              }
              editAnchorRef.current = null;
            } else {
              draggingRef.current = false;
            }
          }}
          onPointerCancel={(e) => {
            activePointersRef.current.delete(e.pointerId);
            pinchRef.current = null;
            editAnchorRef.current = null;
            draggingRef.current = false;
          }}
        />

      </div>

      {/* Session panel — bottom sheet */}
      {showSessionPanel && (
        <SessionPanel
          patientLabel={patient ? `${patient.toUpperCase()} · ${new Date().toLocaleDateString("es-ES")}` : ""}
          patientInput={patientInput}
          clearConfirm={clearConfirm}
          onPatientChange={setPatientInput}
          onPatientSave={handlePatientSave}
          onClearRequest={() => setClearConfirm(true)}
          onClearConfirm={handleClearSession}
          onClearCancel={() => setClearConfirm(false)}
          onClose={() => setShowSessionPanel(false)}
        />
      )}

      {/* Action row — always same position; swaps buttons in edit mode */}
      <div className="shrink-0 flex gap-3 px-4 py-4">
        {editMode ? (
          showSlider ? (
            <>
              <div className="flex-1 flex flex-col justify-center gap-1.5">
                <div className="flex justify-between">
                  <span className="font-mono text-xs text-white/40">Mín. selección</span>
                  <span className="font-mono text-xs text-white/60">
                    {minRangeMs === 0 ? "sin mín." : `${minRangeMs} ms`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  step={100}
                  value={minRangeMs}
                  onChange={e => setMinRangeMs(Number(e.target.value))}
                  className="w-full accent-[#5dadec]"
                />
              </div>
              <button
                onClick={() => setShowSlider(false)}
                className="shrink-0 px-3 py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
              >
                <AdjustmentsHorizontalIcon className="h-5 w-5" style={{ color: "#5dadec" }} />
              </button>
            </>
          ) : (
            <>
              <button
                disabled={!selRange}
                onClick={handleCancelSelection}
                className="flex-1 py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5 disabled:opacity-30"
              >
                Cancelar
              </button>
              <button
                disabled={!selRange}
                onClick={handleInterpolate}
                className="flex-[2] py-3 rounded-md text-sm text-white font-medium active:opacity-80 disabled:opacity-30"
                style={{ background: "#5dadec" }}
              >
                Interpolar tramo
              </button>
              {prevWorkingSeries && (
                <button
                  onClick={handleUndo}
                  className="shrink-0 px-3 py-3 rounded-md text-white/60 border border-white/20 active:bg-white/5"
                >
                  <ArrowUturnLeftIcon className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => setShowSlider(true)}
                className="shrink-0 px-3 py-3 rounded-md text-white/60 border border-white/20 active:bg-white/5"
              >
                <AdjustmentsHorizontalIcon className="h-5 w-5" />
              </button>
            </>
          )
        ) : (
          <button
            onClick={() => onSend(workingSeries)}
            className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
            style={{ background: "#5dadec" }}
          >
            Guardar
          </button>
        )}
      </div>
    </div>
  );
}
