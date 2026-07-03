"use client";

import { useEffect, useRef, type RefObject } from "react";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
import { formatJointName, getColorsForJoint } from "@/utils/joint";

const MAX_POINTS = 300;
const GRID_ANGLES = [45, 90, 135];
const PAD = { top: 12, right: 76, bottom: 20, left: 34 };
const EASE = "0.3s cubic-bezier(0.32,0.72,0,1)";

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

  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.textAlign = "right";
  ctx.fillText("0°", PAD.left - 4, PAD.top + plotH + 4);
  ctx.fillText("180°", PAD.left - 4, PAD.top + 4);

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
      const x = PAD.left + plotW - (total - 1 - i) * xStep;
      const y = PAD.top + plotH * (1 - clamp(buf[i]) / 180);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

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
  onClose: () => void;
  onExpandChange?: (expanded: boolean) => void;
}

export default function AngleGraph({
  jointDataRef,
  selectedJoints,
  isFrozen,
  onClose,
  onExpandChange,
}: AngleGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<Map<string, number[]>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastDrawRef = useRef(0);
  const isFrozenRef = useRef(isFrozen);
  const selectedJointsRef = useRef(selectedJoints);
  const onCloseRef = useRef(onClose);
  const onExpandChangeRef = useRef(onExpandChange);

  useEffect(() => { isFrozenRef.current = isFrozen; }, [isFrozen]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onExpandChangeRef.current = onExpandChange; }, [onExpandChange]);

  useEffect(() => {
    selectedJointsRef.current = selectedJoints;
    for (const key of bufferRef.current.keys()) {
      if (!selectedJoints.includes(key as CanvasKeypointName)) {
        bufferRef.current.delete(key);
      }
    }
  }, [selectedJoints]);

  // Multi-snap drag: compact (45vh) ↔ expanded (90vh) ↔ dismissed
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    // CSS animation fill (animate-slide-up, fill-mode: both) sits above inline styles in the
    // cascade and would override every transform set by the drag handler.  Remove the class once
    // the entrance animation finishes so inline style.transform takes full control.
    const onAnimEnd = () => sheet.classList.remove("animate-slide-up");
    sheet.addEventListener("animationend", onAnimEnd, { once: true });

    let snap: "compact" | "expanded" = "compact";
    let startY = 0, startTime = 0, dragging = false, delta = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

    const expand = () => {
      snap = "expanded";
      sheet.style.transition = `height ${EASE}`;
      sheet.style.height = "90vh";
      sheet.style.transform = "";
      timer = setTimeout(() => { sheet.style.transition = ""; }, 310);
      onExpandChangeRef.current?.(true);
    };

    const collapse = () => {
      snap = "compact";
      sheet.style.transition = `transform ${EASE}, height ${EASE}`;
      sheet.style.transform = "translateY(0)";
      sheet.style.height = "45vh";
      timer = setTimeout(() => {
        sheet.style.transition = "none";
        sheet.style.transform = "";
        void sheet.offsetHeight; // force reflow before re-enabling transition
        sheet.style.transition = "";
      }, 310);
      onExpandChangeRef.current?.(false);
    };

    const dismiss = () => {
      sheet.style.transition = `transform ${EASE}`;
      sheet.style.transform = "translateY(110%)";
      timer = setTimeout(() => {
        // The component unmounts right after this, so don't reset transform/transition —
        // doing so snapped the sheet back into view for a frame before React removed the
        // node, producing a visible flicker of the (still-expanded-height) panel.
        onExpandChangeRef.current?.(false);
        onCloseRef.current();
      }, 300);
    };

    const snapBack = () => {
      sheet.style.transition = `transform ${EASE}`;
      sheet.style.transform = "translateY(0)";
      timer = setTimeout(() => {
        sheet.style.transition = "none";
        sheet.style.transform = "";
        void sheet.offsetHeight; // force reflow before re-enabling transition
        sheet.style.transition = "";
      }, 310);
    };

    const onTouchStart = (e: TouchEvent) => {
      const rect = sheet.getBoundingClientRect();
      if (e.touches[0].clientY - rect.top > 72) return;
      clearTimer();
      startY = e.touches[0].clientY;
      // startTime is set on first move, not here — otherwise a pause between
      // touchstart and the actual swipe inflates elapsed time, understating
      // velocity and causing a quick flick to snap back instead of dismissing.
      startTime = 0;
      delta = 0;
      dragging = true;
      sheet.style.transition = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging) return;
      delta = e.touches[0].clientY - startY;
      if (startTime === 0 && delta !== 0) startTime = Date.now();
      // Only translate downward; upward drag shows no interim visual (snap on release)
      sheet.style.transform = delta > 0 ? `translateY(${delta}px)` : "translateY(0)";
    };

    const onRelease = () => {
      if (!dragging) return;
      dragging = false;
      const velocity = startTime > 0 ? delta / (Date.now() - startTime) : 0; // px/ms, signed

      if (snap === "compact") {
        if (delta < -40 || velocity < -0.3) {
          expand();
        } else if (delta > 80 || velocity > 0.3) {
          dismiss();
        } else {
          snapBack();
        }
      } else {
        // expanded
        if (delta > 150 || velocity > 0.5) {
          dismiss();
        } else if (delta > 60 || velocity > 0.3) {
          collapse();
        } else {
          snapBack();
        }
      }
    };

    const onTouchCancel = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transform = "";
      sheet.style.transition = "";
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: true });
    sheet.addEventListener("touchend", onRelease, { passive: true });
    sheet.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      sheet.removeEventListener("animationend", onAnimEnd);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onRelease);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      clearTimer();
    };
  }, []);

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
        }
      }

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
    <div
      ref={sheetRef}
      className="absolute bottom-0 inset-x-0 z-20 bg-black/90 rounded-t-2xl animate-slide-up flex flex-col touch-none"
      style={{ height: "45vh" }}
    >
      <div className="w-8 h-1 bg-white/30 rounded-full mx-auto mt-2 shrink-0 touch-none" />
      <canvas ref={canvasRef} className="w-full flex-1 min-h-0" />
    </div>
  );
}
