"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
import { formatJointName, getColorsForJoint } from "@/utils/joint";
import { useDraggableSheet, type DraggableSheetHandle } from "@/hooks/useDraggableSheet";
import { StopIcon, VideoCameraIcon } from "@heroicons/react/24/outline";

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const MAX_POINTS = 300;
const PAD = { top: 12, right: 4, bottom: 20, left: 34 };

function drawGraph(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  selectedJoints: CanvasKeypointName[],
  buffer: Map<string, number[]>,
  jointData: JointDataMap,
  yMax: number
) {
  ctx.save();
  ctx.scale(dpr, dpr);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xStep = plotW / (MAX_POINTS - 1);
  const clamp = (v: number) => Math.min(Math.max(v, 0), yMax);

  ctx.clearRect(0, 0, W, H);
  ctx.font = "9px 'DM Mono', monospace";

  const gridAngles = yMax === 90 ? [45] : yMax === 135 ? [45, 90] : [45, 90, 135];
  for (const deg of gridAngles) {
    const y = PAD.top + plotH * (1 - deg / yMax);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "right";
    ctx.fillText(`${deg}°`, PAD.left - 4, y + 3);
  }

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "right";
  ctx.fillText("0°", PAD.left - 4, PAD.top + plotH + 4);
  ctx.fillText(`${yMax}°`, PAD.left - 4, PAD.top + 4);

  const LINE_H = 11;
  const LABEL_H = 28; // min baseline gap between label groups (accommodates 2-line pill height)
  type LabelEntry = { joint: CanvasKeypointName; color: string; currentAngle: number; y: number };
  const labels: LabelEntry[] = [];

  for (const joint of selectedJoints) {
    const buf = buffer.get(joint);
    if (!buf || buf.length === 0) continue;
    const currentAngle = buf[buf.length - 1];
    labels.push({
      joint,
      color: getColorsForJoint(joint).borderColor,
      currentAngle,
      y: PAD.top + plotH * (1 - clamp(currentAngle) / yMax),
    });
  }

  labels.sort((a, b) => a.y - b.y);

  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + LABEL_H)
      labels[i].y = labels[i - 1].y + LABEL_H;
  }
  for (let i = labels.length - 2; i >= 0; i--) {
    if (labels[i].y + LABEL_H > labels[i + 1].y)
      labels[i].y = labels[i + 1].y - LABEL_H;
  }

  for (const joint of selectedJoints) {
    const buf = buffer.get(joint);
    if (!buf || buf.length === 0) continue;
    const total = buf.length;

    ctx.strokeStyle = getColorsForJoint(joint).borderColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    for (let i = 0; i < total; i++) {
      const x = PAD.left + plotW - (total - 1 - i) * xStep;
      const y = PAD.top + plotH * (1 - clamp(buf[i]) / yMax);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const PILL_PX = 4;
  const PILL_PY = 3;
  ctx.textAlign = "right";
  const labelX = W - PAD.right - 2;
  for (const { color, currentAngle, joint, y } of labels) {
    const name = formatJointName(joint);
    const angleStr = `${Math.round(currentAngle)}°`;
    const maxW = Math.max(ctx.measureText(name).width, ctx.measureText(angleStr).width);
    const pillTop = y - 7 - PILL_PY;
    const pillH = LINE_H + 9 + 2 + PILL_PY * 2; // two lines + top/bottom padding
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(labelX - maxW - PILL_PX, pillTop, maxW + PILL_PX * 2, pillH, 3);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(name, labelX, y);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(angleStr, labelX, y + LINE_H);
  }

  ctx.restore();
}

interface AngleGraphProps {
  jointDataRef: RefObject<JointDataMap>;
  selectedJoints: CanvasKeypointName[];
  isFrozen: boolean;
  onClose: () => void;
  isRecording: boolean;
  recordingDuration: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

const AngleGraph = forwardRef<DraggableSheetHandle, AngleGraphProps>(function AngleGraph({
  jointDataRef,
  selectedJoints,
  isFrozen,
  onClose,
  isRecording,
  recordingDuration,
  onStartRecording,
  onStopRecording,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<Map<string, number[]>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastDrawRef = useRef(0);
  const isFrozenRef = useRef(isFrozen);
  const selectedJointsRef = useRef(selectedJoints);
  const scaleMaxRef = useRef(90);

  useEffect(() => { isFrozenRef.current = isFrozen; }, [isFrozen]);

  useEffect(() => {
    selectedJointsRef.current = selectedJoints;
    for (const key of bufferRef.current.keys()) {
      if (!selectedJoints.includes(key as CanvasKeypointName)) {
        bufferRef.current.delete(key);
      }
    }
  }, [selectedJoints]);

  const sheetHandle = useDraggableSheet(sheetRef, onClose);
  useImperativeHandle(ref, () => sheetHandle, [sheetHandle]);

  useEffect(() => {
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);

      const cv = canvasRef.current;
      if (!cv || cv.offsetWidth === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(cv.offsetWidth * dpr);
      const targetH = Math.round(cv.offsetHeight * dpr);
      if (cv.width !== targetW || cv.height !== targetH) {
        cv.width = targetW;
        cv.height = targetH;
      }

      if (!isFrozenRef.current) {
        for (const joint of selectedJointsRef.current) {
          const angle = jointDataRef.current?.[joint]?.angle;
          if (angle === undefined || isNaN(angle)) continue;
          const buf = bufferRef.current.get(joint) ?? [];
          buf.push(angle);
          if (buf.length > MAX_POINTS) buf.shift();
          bufferRef.current.set(joint, buf);
          const step = angle <= 90 ? 90 : angle <= 135 ? 135 : 180;
          if (step > scaleMaxRef.current) scaleMaxRef.current = step;
        }
      }

      if (now - lastDrawRef.current < 100) return;
      lastDrawRef.current = now;

      const ctx = cv.getContext("2d");
      if (!ctx) return;

      drawGraph(ctx, cv.offsetWidth, cv.offsetHeight, dpr, selectedJointsRef.current, bufferRef.current, jointDataRef.current ?? {}, scaleMaxRef.current);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [jointDataRef]);

  return (
    <div
      ref={sheetRef}
      className="absolute bottom-0 inset-x-0 z-20 bg-black/90 rounded-t-2xl animate-slide-up flex flex-col touch-none"
      style={{ height: "45vh" }}
    >
      <div className="w-8 h-1 bg-white/30 rounded-full mx-auto mt-2 shrink-0 touch-none" />

      {/* Record / stop button row */}
      <div className="shrink-0 flex items-center justify-end px-3 py-1 touch-none">
        <button
          disabled={(selectedJoints.length === 0 || isFrozen) && !isRecording}
          onClick={isRecording ? onStopRecording : onStartRecording}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all duration-150 ${
            selectedJoints.length === 0 && !isRecording
              ? "opacity-25 cursor-not-allowed text-white"
              : isRecording
              ? "text-red-400 animate-pulse"
              : "text-white/70 active:opacity-70"
          }`}
        >
          {isRecording ? (
            <>
              <StopIcon className="h-5 w-5 text-red-500" />
              <span className="font-mono">{fmtDuration(recordingDuration)}</span>
            </>
          ) : (
            <>
              <VideoCameraIcon className="h-5 w-5" />
              Grabar
            </>
          )}
        </button>
      </div>

      {/* pb-12 reserves room below the canvas for the fixed orthogonal-reference/grid
          icons (bottom-2, ~2.5rem tall), which float over the sheet's bottom-right
          corner. Padding lives on this wrapper, not the canvas itself — canvas is a
          replaced element, so padding directly on it would scale its raster content
          into a smaller box instead of just reserving blank space below it. */}
      <div className="w-full flex-1 min-h-0 pb-12">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
});

export default AngleGraph;
