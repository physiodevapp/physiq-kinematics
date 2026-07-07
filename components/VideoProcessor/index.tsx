"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { CanvasKeypointName, JointDataMap, Keypoint } from "@/interfaces/pose";
import type { KinematicsSeries } from "@/interfaces/kinematics";
import { usePoseDetector } from "@/providers/PoseDetector";
import { OrthogonalReference } from "@/providers/Settings";
import {
  excludedKeypoints,
  updateMultipleJoints,
  inferPoseOrientation,
  adjustOrientationForMirror,
  PoseOrientation,
} from "@/utils/pose";
import { jointConfigMap, formatJointName } from "@/utils/joint";
import { XMarkIcon } from "@heroicons/react/24/outline";

const PROCESS_FPS = 6;

const OUTLIER_WINDOW = 5;
const OUTLIER_THRESHOLD = 20;

function cleanOutliers(series: KinematicsSeries): KinematicsSeries {
  const cleaned: KinematicsSeries = {};
  for (const joint of Object.keys(series)) {
    const { t, a } = series[joint];
    if (a.length < 3) { cleaned[joint] = { t, a }; continue; }
    const c: (number | null)[] = [...a];
    for (let i = 0; i < a.length; i++) {
      const lo = Math.max(0, i - OUTLIER_WINDOW);
      const hi = Math.min(a.length - 1, i + OUTLIER_WINDOW);
      const win = a.slice(lo, hi + 1).slice().sort((x, y) => x - y);
      const median = win[Math.floor(win.length / 2)];
      if (Math.abs(a[i] - median) > OUTLIER_THRESHOLD) c[i] = null;
    }
    const clean: number[] = [];
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== null) { clean.push(c[i] as number); continue; }
      let prev = i - 1; while (prev >= 0 && c[prev] === null) prev--;
      let next = i + 1; while (next < c.length && c[next] === null) next++;
      if (prev < 0 && next >= c.length) clean.push(0);
      else if (prev < 0) clean.push(c[next] as number);
      else if (next >= c.length) clean.push(c[prev] as number);
      else {
        const f = (i - prev) / (next - prev);
        clean.push(Math.round((c[prev] as number) + f * ((c[next] as number) - (c[prev] as number))));
      }
    }
    cleaned[joint] = { t, a: clean };
  }
  return cleaned;
}

interface VideoProcessorProps {
  file: File;
  isMirrored: boolean;
  selectedJoints: CanvasKeypointName[];
  poseOrientation: PoseOrientation | null;
  orthogonalReference: OrthogonalReference;
  angularHistorySize: number;
  startTime?: number;
  endTime?: number;
  onComplete: (data: {
    videoBlob: Blob;
    series: KinematicsSeries;
    duration: number;
    joints: CanvasKeypointName[];
  }) => void;
  onCancel: () => void;
}

export default function VideoProcessor({
  file,
  isMirrored,
  selectedJoints,
  poseOrientation,
  orthogonalReference,
  angularHistorySize,
  startTime: trimStart,
  endTime: trimEnd,
  onComplete,
  onCancel,
}: VideoProcessorProps) {
  const { basePath } = useRouter();
  const { detector, minPoseScore, isDetectorReady } = usePoseDetector();

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<
    "waiting" | "processing" | "done" | "error"
  >("waiting");
  const [errorMsg, setErrorMsg] = useState("");
  const [videoReady, setVideoReady] = useState(false);

  const cancelledRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const jointDataRef = useRef<JointDataMap>({});
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const worker = new Worker(`${basePath}/workers/jointWorker.js`);
    workerRef.current = worker;

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.preload = "auto";
    video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    videoRef.current = video;

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const handleLoaded = () => {
      if (cancelledRef.current) return;
      if (!isFinite(video.duration) || video.duration <= 0) {
        setStatus("error");
        setErrorMsg("No se pudo determinar la duración del vídeo.");
        return;
      }
      setVideoReady(true);
    };

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });

    video.addEventListener(
      "error",
      () => {
        if (cancelledRef.current) return;
        setStatus("error");
        setErrorMsg("No se pudo cargar el vídeo. Formato no compatible.");
      },
      { once: true }
    );

    video.src = url;
    video.load();

    return () => {
      cancelledRef.current = true;
      worker.terminate();
      workerRef.current = null;
      if (videoRef.current && videoRef.current.parentNode) {
        videoRef.current.parentNode.removeChild(videoRef.current);
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!videoReady || !isDetectorReady || !detector || status !== 'waiting') return;
    if (cancelledRef.current) return;
    processVideo(videoRef.current!, workerRef.current!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoReady, isDetectorReady, detector, status]);

  async function processVideo(video: HTMLVideoElement, worker: Worker) {
    setStatus("processing");

    try {
      await detector!.setOptions({ runningMode: 'IMAGE' });
    } catch {
      setStatus("error");
      setErrorMsg("El detector de poses no pudo inicializarse. Vuelve a intentarlo.");
      return;
    }

    // Runtime check: requestVideoFrameCallback is required for frame-accurate processing
    if (!(video as any).requestVideoFrameCallback) {
      setStatus("error");
      setErrorMsg("Tu navegador no es compatible con esta función. Actualízalo e inténtalo de nuevo.");
      try { await detector!.setOptions({ runningMode: 'VIDEO' }); } catch { /* best-effort */ }
      return;
    }

    const LANDMARK_NAMES = [
      'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
      'right_eye_inner', 'right_eye', 'right_eye_outer',
      'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
      'left_index', 'right_index', 'left_thumb', 'right_thumb',
      'left_hip', 'right_hip', 'left_knee', 'right_knee',
      'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
      'left_foot_index', 'right_foot_index',
    ];

    const effectiveStart = trimStart ?? 0;
    const effectiveEnd = trimEnd ?? video.duration;
    const duration = (effectiveEnd - effectiveStart) * 1000;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const series: KinematicsSeries = {};
    jointDataRef.current = {};
    let frameCount = 0;
    let detectionErrors = 0;

    // Single seek to the start of the trim range (replaces per-frame seeks)
    video.currentTime = effectiveStart;
    await new Promise<void>((resolve) => {
      const onSeeked = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }, 3000);
      video.addEventListener("seeked", onSeeked, { once: true });
    });

    if (cancelledRef.current) {
      try { await detector!.setOptions({ runningMode: 'VIDEO' }); } catch { /* best-effort */ }
      return;
    }

    // RVFC-driven frame loop: plays the video at 4× and samples at PROCESS_FPS (video time).
    // This eliminates the per-frame seek hangs that caused failures on mobile decoders.
    await new Promise<void>((resolve) => {
      let lastSampledTime = effectiveStart - 1 / PROCESS_FPS; // force first frame to be sampled
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        video.pause();
        video.removeEventListener("ended", finish);
        resolve();
      };

      video.addEventListener("ended", finish, { once: true });

      const onFrame = async (
        _now: DOMHighResTimeStamp,
        meta: { mediaTime: number }
      ) => {
        if (cancelledRef.current || meta.mediaTime >= effectiveEnd) {
          finish();
          return;
        }

        if (meta.mediaTime - lastSampledTime >= 1 / PROCESS_FPS - 0.01) {
          lastSampledTime = meta.mediaTime;
          frameCount++;

          let keypoints: Keypoint[] = [];
          try {
            const result = detector!.detect(video);
            if (result.landmarks.length > 0) {
              keypoints = result.landmarks[0]
                .map((lm, i) => ({
                  x: lm.x * vw,
                  y: lm.y * vh,
                  z: lm.z,
                  score: lm.visibility,
                  name: LANDMARK_NAMES[i],
                }))
                .filter(kp => (kp.score ?? 0) > minPoseScore && !excludedKeypoints.includes(kp.name!));
            }
          } catch {
            detectionErrors++;
          }

          if (keypoints.length > 0 && selectedJoints.length > 0 && !cancelledRef.current) {
            const rawOrientation =
              poseOrientation === "auto" || poseOrientation === null
                ? inferPoseOrientation(keypoints)
                : poseOrientation;
            const effectiveOrientation = rawOrientation
              ? adjustOrientationForMirror(rawOrientation, isMirrored)
              : null;

            const updatedJointData = await updateMultipleJoints({
              keypoints,
              selectedJoints,
              jointDataRef,
              jointConfigMap,
              jointWorker: worker,
              orthogonalReference,
              formatJointName,
              jointAngleHistorySize: angularHistorySize,
              poseOrientation: effectiveOrientation,
            });

            if (!cancelledRef.current) {
              const elapsedMs = (meta.mediaTime - effectiveStart) * 1000;
              Object.entries(updatedJointData).forEach(([joint, jd]) => {
                if (!jd) return;
                if (!series[joint]) series[joint] = { t: [], a: [] };
                series[joint].t.push(elapsedMs);
                series[joint].a.push(Math.round(jd.angle));
              });
            }
          }

          if (frameCount % 5 === 0) {
            setProgress(Math.min(
              (meta.mediaTime - effectiveStart) / (effectiveEnd - effectiveStart), 1
            ));
          }
        }

        if (!done && !cancelledRef.current && meta.mediaTime < effectiveEnd) {
          (video as any).requestVideoFrameCallback(onFrame);
        } else {
          finish();
        }
      };

      (video as any).requestVideoFrameCallback(onFrame);
      video.playbackRate = 4;
      video.play().catch(finish);
    });

    // Restore VIDEO mode for the live camera before resolving
    try { await detector!.setOptions({ runningMode: 'VIDEO' }); } catch { /* best-effort */ }

    if (cancelledRef.current) return;

    setProgress(1);

    if (frameCount > 0 && detectionErrors / frameCount > 0.5) {
      setStatus("error");
      setErrorMsg("El detector de poses falló durante el procesamiento. Vuelve a intentarlo.");
      return;
    }

    setStatus("done");

    onComplete({
      videoBlob: file,
      series: cleanOutliers(series),
      duration,
      joints: [...selectedJoints],
    });
  }

  const handleCancel = () => {
    cancelledRef.current = true;
    onCancel();
  };

  const pct = Math.round(progress * 100);

  const isInIframe =
    typeof window !== "undefined" && window.self !== window.top;
  const handleGoHome = () => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
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
              >
                ‹
              </span>
            )}
            <span
              className={
                isInIframe
                  ? "cursor-pointer transition-opacity duration-150 hover:opacity-75"
                  : ""
              }
              onClick={isInIframe ? handleGoHome : undefined}
            >
              Physi
              <span
                style={{
                  background: "linear-gradient(135deg,#4f9cf9,#38d9a9)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Q
              </span>
            </span>
            <span className="opacity-50 font-normal">—</span>
            <span style={{ color: "#5dadec" }}>Kinematics</span>
          </h2>
          <button onClick={handleCancel} className="p-1 -mr-1">
            <XMarkIcon className="h-5 w-5 text-white/50" />
          </button>
        </div>
      </div>

      {/* Progress area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        {status === "waiting" && (
          <p className="text-white/60 text-sm">Cargando vídeo...</p>
        )}

        {status === "processing" && (
          <>
            {/* Circular progress */}
            <div className="relative w-28 h-28">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="6"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="#5dadec"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - progress)}`}
                  className="transition-[stroke-dashoffset] duration-200"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-mono text-white text-xl">
                {pct}%
              </span>
            </div>
            <p className="text-white/60 text-sm">Procesando vídeo...</p>
          </>
        )}

        {status === "error" && (
          <>
            <p className="text-red-400 text-sm text-center">{errorMsg}</p>
            <button
              onClick={handleCancel}
              className="px-6 py-3 rounded-md text-sm text-white font-medium active:opacity-80"
              style={{ background: "#5dadec" }}
            >
              Volver
            </button>
          </>
        )}
      </div>

      {/* Cancel button */}
      {(status === "waiting" || status === "processing") && (
        <div className="shrink-0 px-4 py-4">
          <button
            onClick={handleCancel}
            className="w-full py-3 rounded-md text-sm text-white/60 border border-white/20 active:bg-white/5"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
