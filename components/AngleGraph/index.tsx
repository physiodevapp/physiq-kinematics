"use client";

import { useEffect, useRef, type RefObject } from "react";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
import { formatJointName, getColorsForJoint } from "@/utils/joint";

const MAX_POINTS = 300;
const GRID_ANGLES = [45, 90, 135];
const PAD = { top: 12, right: 76, bottom: 20, left: 34 };

function drawGraph(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  selectedJoints: CanvasKeypointName[],
  buffer: Map<string, number[]>,
  jointData: JointDataMap
) {
  ctx.save();
  ctx.scale(dpr, dpr);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xStep = plotW / (MAX_POINTS - 1);

  ctx.clearRect(0, 0, W, H);
  ctx.font = "9px 'DM Mono', monospace";

  // Horizontal grid lines + Y labels
  for (const deg of GRID_ANGLES) {
    const y = PAD.top + plotH * (1 - deg / 180);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.textAlign = "right";
    ctx.fillText(`${deg}°`, PAD.left - 4, y + 3);
  }

  // 0° / 180° edge labels
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.textAlign = "right";
  ctx.fillText("0°", PAD.left - 4, PAD.top + plotH + 4);
  ctx.fillText("180°", PAD.left - 4, PAD.top + 4);

  // Joint lines
  for (const joint of selectedJoints) {
    const buf = buffer.get(joint);
    if (!buf || buf.length === 0) continue;

    const color = getColorsForJoint(joint).borderColor;
    const total = buf.length;
    const currentAngle = buf[total - 1];
    const clamp = (v: number) => Math.min(Math.max(v, 0), 180);
    const currentY = PAD.top + plotH * (1 - clamp(currentAngle) / 180);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    for (let i = 0; i < total; i++) {
      // Newest sample always at right edge; older samples step left by xStep each
      const x = PAD.left + plotW - (total - 1 - i) * xStep;
      const y = PAD.top + plotH * (1 - clamp(buf[i]) / 180);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Right-edge label: joint name + current angle
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(formatJointName(joint), W - PAD.right + 5, currentY - 2);
    ctx.fillText(`${Math.round(currentAngle)}°`, W - PAD.right + 5, currentY + 9);
  }
  ctx.restore();
}

interface AngleGraphProps {
  jointDataRef: RefObject<JointDataMap>;
  selectedJoints: CanvasKeypointName[];
  isFrozen: boolean;
}

export default function AngleGraph({ jointDataRef, selectedJoints, isFrozen }: AngleGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<Map<string, number[]>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastDrawRef = useRef(0);
  const isFrozenRef = useRef(isFrozen);
  const selectedJointsRef = useRef(selectedJoints);

  useEffect(() => {
    isFrozenRef.current = isFrozen;
  }, [isFrozen]);

  useEffect(() => {
    selectedJointsRef.current = selectedJoints;
    // Drop buffers for joints that were deselected
    for (const key of bufferRef.current.keys()) {
      if (!selectedJoints.includes(key as CanvasKeypointName)) {
        bufferRef.current.delete(key);
      }
    }
  }, [selectedJoints]);

  useEffect(() => {
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);

      const cv = canvasRef.current;
      if (!cv || cv.offsetWidth === 0) return;

      // Sync canvas physical pixels to CSS size × devicePixelRatio for crisp rendering
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(cv.offsetWidth * dpr);
      const targetH = Math.round(cv.offsetHeight * dpr);
      if (cv.width !== targetW || cv.height !== targetH) {
        cv.width = targetW;
        cv.height = targetH;
      }

      // Accumulate one sample per frame while not frozen
      if (!isFrozenRef.current) {
        for (const joint of selectedJointsRef.current) {
          const angle = jointDataRef.current?.[joint]?.angle;
          if (angle === undefined || isNaN(angle)) continue;
          const buf = bufferRef.current.get(joint) ?? [];
          buf.push(angle);
          if (buf.length > MAX_POINTS) buf.shift();
          bufferRef.current.set(joint, buf);
        }
      }

      // Throttle drawing to ~10 fps
      if (now - lastDrawRef.current < 100) return;
      lastDrawRef.current = now;

      const ctx = cv.getContext("2d");
      if (!ctx) return;

      drawGraph(ctx, cv.offsetWidth, cv.offsetHeight, dpr, selectedJointsRef.current, bufferRef.current, jointDataRef.current ?? {});
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [jointDataRef]);

  return (
    <div className="absolute bottom-0 inset-x-0 z-20 bg-black/90 rounded-t-2xl animate-slide-up">
      <div className="w-8 h-1 bg-white/30 rounded-full mx-auto mt-2" />
      <canvas ref={canvasRef} className="w-full" style={{ height: "calc(45vh - 12px)" }} />
    </div>
  );
}
