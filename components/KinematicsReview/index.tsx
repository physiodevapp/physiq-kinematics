"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { CanvasKeypointName } from "@/interfaces/pose";
import type { KinematicsSeries, KinematicsSeriesEntry } from "@/interfaces/kinematics";
import { formatJointName, getColorsForJoint } from "@/utils/joint";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

const PAD = { top: 16, right: 8, bottom: 28, left: 36 };

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MIN_SCORE = 0.3;

// Upper-body skeleton connections (landmark indices)
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

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

function paintChart(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, dpr: number,
  joints: CanvasKeypointName[],
  series: KinematicsSeries,
  dur: number,
  curMs: number,
  yMax: number,
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

  // Collision-avoid label stacking
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

function drawSkeleton(
  canvas: HTMLCanvasElement,
  landmarks: { x: number; y: number; visibility?: number }[],
  videoW: number,
  videoH: number,
  mirror: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cW = canvas.offsetWidth;
  const cH = canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cW * dpr);
  canvas.height = Math.round(cH * dpr);

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cW, cH);

  // Compute letterbox rect
  const scale = Math.min(cW / videoW, cH / videoH);
  const rW = videoW * scale;
  const rH = videoH * scale;
  const offX = (cW - rW) / 2;
  const offY = (cH - rH) / 2;

  const toX = (nx: number) => {
    const x = mirror ? (1 - nx) : nx;
    return offX + x * rW;
  };
  const toY = (ny: number) => offY + ny * rH;

  // Draw connections
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  for (const [a, b] of POSE_CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    if (!lmA || !lmB) continue;
    if ((lmA.visibility ?? 1) < MIN_SCORE || (lmB.visibility ?? 1) < MIN_SCORE) continue;
    ctx.beginPath();
    ctx.moveTo(toX(lmA.x), toY(lmA.y));
    ctx.lineTo(toX(lmB.x), toY(lmB.y));
    ctx.stroke();
  }

  // Draw keypoints
  for (const lm of landmarks) {
    if ((lm.visibility ?? 1) < MIN_SCORE) continue;
    ctx.beginPath();
    ctx.arc(toX(lm.x), toY(lm.y), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(93,173,236,0.9)";
    ctx.fill();
  }

  ctx.restore();
}

interface Props {
  videoBlob: Blob;
  series: KinematicsSeries;
  duration: number;
  joints: CanvasKeypointName[];
  facingMode: string;
  recordingNumber: number;
  onSend: () => void;
  onDiscard: () => void;
  onAcceptAndRecordAnother: () => void;
}

export default function KinematicsReview({
  videoBlob,
  series,
  duration,
  joints,
  facingMode,
  recordingNumber,
  onSend,
  onDiscard,
  onAcceptAndRecordAnother,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const curMsRef = useRef(0);
  const draggingRef = useRef(false);
  const detectorRef = useRef<PoseLandmarker | null>(null);

  const yMax = useMemo(() => {
    let mx = 0;
    for (const j of joints) {
      const e = series[j];
      if (e) for (const v of e.a) if (v > mx) mx = v;
    }
    return mx <= 90 ? 90 : mx <= 135 ? 135 : 180;
  }, [joints, series]);

  const hasVideo = videoBlob.size > 0;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const mirror = facingMode === "user";

  useEffect(() => {
    if (!hasVideo) return;
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob, hasVideo]);

  // Build local IMAGE/CPU detector for skeleton overlay
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
          runningMode: "IMAGE",
          numPoses: 1,
          minPoseDetectionConfidence: MIN_SCORE,
          minPosePresenceConfidence: MIN_SCORE,
          minTrackingConfidence: MIN_SCORE,
        });
        if (!cancelled) detectorRef.current = lm;
        else lm.close();
      } catch {
        // skeleton overlay unavailable; non-critical
      }
    })();
    return () => {
      cancelled = true;
      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, []);

  // Skeleton detection on pause/seeked-while-paused/loadeddata; clear on play
  useEffect(() => {
    const video = videoRef.current;
    const skCanvas = skeletonCanvasRef.current;
    if (!video || !skCanvas) return;

    const detect = () => {
      const det = detectorRef.current;
      if (!det || !video.videoWidth) return;
      try {
        const result = det.detect(video);
        if (result.landmarks.length > 0) {
          drawSkeleton(skCanvas, result.landmarks[0], video.videoWidth, video.videoHeight, mirror);
        } else {
          const ctx = skCanvas.getContext("2d");
          ctx?.clearRect(0, 0, skCanvas.width, skCanvas.height);
        }
      } catch {
        // ignore individual frame failures
      }
    };

    const clearSkeleton = () => {
      const ctx = skCanvas.getContext("2d");
      ctx?.clearRect(0, 0, skCanvas.width, skCanvas.height);
    };

    const onSeeked = () => { if (video.paused) detect(); };

    video.addEventListener("pause", detect);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", detect);
    video.addEventListener("play", clearSkeleton);

    return () => {
      video.removeEventListener("pause", detect);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", detect);
      video.removeEventListener("play", clearSkeleton);
    };
  }, [mirror]);

  // rAF loop: sync cursor from video playback and redraw when needed
  useEffect(() => {
    let rafId: number;
    let lastCurMs = -1;
    let lastW = 0, lastH = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      if (!draggingRef.current && videoRef.current) {
        const t = videoRef.current.currentTime * 1000;
        if (Math.abs(t - curMsRef.current) > 30) curMsRef.current = t;
      }

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
        Math.abs(curMsRef.current - lastCurMs) > 20 ||
        W !== lastW ||
        H !== lastH
      ) {
        const ctx = cv.getContext("2d");
        if (ctx) paintChart(ctx, W, H, dpr, joints, series, duration, curMsRef.current, yMax);
        lastCurMs = curMsRef.current;
        lastW = W;
        lastH = H;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [joints, series, duration, yMax]);

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;
  const handleGoHome = () => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
  };

  const scrub = (clientX: number) => {
    const cv = canvasRef.current;
    if (!cv || duration === 0) return;
    const rect = cv.getBoundingClientRect();
    const plotW = rect.width - PAD.left - PAD.right;
    const frac = Math.min(Math.max((clientX - rect.left - PAD.left) / plotW, 0), 1);
    curMsRef.current = frac * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = curMsRef.current / 1000;
    }
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
          <button
            onClick={onAcceptAndRecordAnother}
            className="flex items-center gap-1 text-xs text-white/70 active:opacity-70"
          >
            <CameraIcon className="h-4 w-4" />
            Cámara
          </button>
        </div>
      </div>

      {/* Video + skeleton overlay */}
      {hasVideo && videoUrl && (
        <div className="shrink-0 bg-black overflow-hidden relative" style={{ flex: "5 5 0", minHeight: 0 }}>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className={`w-full h-full object-contain${mirror ? " video-mirrored" : ""}`}
            style={mirror ? { transform: "scaleX(-1)" } : undefined}
          />
          <canvas
            ref={skeletonCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={mirror ? { transform: "scaleX(-1)" } : undefined}
          />
        </div>
      )}

      {/* Angle chart */}
      <div
        className="overflow-hidden"
        style={{ flex: hasVideo ? "3 3 0" : "1 1 0", minHeight: 0 }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            draggingRef.current = true;
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            scrub(e.clientX);
          }}
          onPointerUp={() => { draggingRef.current = false; }}
          onPointerCancel={() => { draggingRef.current = false; }}
        />
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex gap-3 px-4 py-4">
        <button
          onClick={onDiscard}
          className="flex-1 py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
        >
          Descartar
        </button>
        <button
          onClick={onSend}
          className="flex-1 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
          style={{ background: "#5dadec" }}
        >
          Enviar al informe
        </button>
      </div>
    </div>
  );
}
