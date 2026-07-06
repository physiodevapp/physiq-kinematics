"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs-core";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
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

const PROCESS_FPS = 15;

interface VideoProcessorProps {
  file: File;
  isMirrored: boolean;
  selectedJoints: CanvasKeypointName[];
  poseOrientation: PoseOrientation | null;
  orthogonalReference: OrthogonalReference;
  angularHistorySize: number;
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
  onComplete,
  onCancel,
}: VideoProcessorProps) {
  const { basePath } = useRouter();
  const { detector, detectorModel, minPoseScore, isDetectorReady } =
    usePoseDetector();

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<
    "waiting" | "processing" | "done" | "error"
  >("waiting");
  const [errorMsg, setErrorMsg] = useState("");

  const cancelledRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
    videoRef.current = video;

    const procCanvas = document.createElement("canvas");
    processingCanvasRef.current = procCanvas;

    const inCanvas = document.createElement("canvas");
    inputCanvasRef.current = inCanvas;

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    video.src = url;

    const handleLoaded = () => {
      if (cancelledRef.current) return;
      if (!detector || !isDetectorReady) {
        setStatus("error");
        setErrorMsg("El detector de poses no está listo. Espera a que cargue.");
        return;
      }
      processVideo(video, procCanvas, inCanvas, worker);
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

    return () => {
      cancelledRef.current = true;
      worker.terminate();
      workerRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  async function processVideo(
    video: HTMLVideoElement,
    procCanvas: HTMLCanvasElement,
    inCanvas: HTMLCanvasElement,
    worker: Worker
  ) {
    setStatus("processing");

    const duration = video.duration * 1000;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    procCanvas.width = vw;
    procCanvas.height = vh;
    const procCtx = procCanvas.getContext("2d")!;

    const frameInterval = 1 / PROCESS_FPS;
    const series: KinematicsSeries = {};
    jointDataRef.current = {};

    let currentTime = 0;
    let frameCount = 0;

    while (currentTime <= video.duration && !cancelledRef.current) {
      video.currentTime = currentTime;
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
      });

      if (cancelledRef.current) break;

      procCtx.drawImage(video, 0, 0, vw, vh);

      let poses: poseDetection.Pose[] = [];

      try {
        if (
          detectorModel === poseDetection.SupportedModels.BlazePose
        ) {
          const maxInputSize = 320;
          const scale =
            vw > vh ? maxInputSize / vw : maxInputSize / vh;
          const rw = Math.round(vw * scale);
          const rh = Math.round(vh * scale);

          inCanvas.width = rw;
          inCanvas.height = rh;
          const inCtx = inCanvas.getContext("2d")!;
          inCtx.drawImage(video, 0, 0, rw, rh);

          const inputTensor = tf.browser.fromPixels(inCanvas);
          poses = await detector!.estimatePoses(inputTensor);
          inputTensor.dispose();

          poses.forEach((pose) => {
            pose.keypoints.forEach((kp) => {
              kp.x = kp.x / scale;
              kp.y = kp.y / scale;
            });
          });
        } else {
          poses = await detector!.estimatePoses(procCanvas, {
            maxPoses: 1,
            flipHorizontal: false,
          });
        }
      } catch {
        // skip frame on detection error
      }

      if (poses.length > 0 && !cancelledRef.current) {
        const keypoints = poses[0].keypoints.filter(
          (kp) =>
            kp.score &&
            kp.score > minPoseScore &&
            !excludedKeypoints.includes(kp.name!)
        );

        if (keypoints.length > 0 && selectedJoints.length > 0) {
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

          const elapsedMs = currentTime * 1000;
          Object.entries(updatedJointData).forEach(([joint, jd]) => {
            if (!jd) return;
            if (!series[joint]) {
              series[joint] = { t: [], a: [] };
            }
            series[joint].t.push(elapsedMs);
            series[joint].a.push(Math.round(jd.angle));
          });
        }
      }

      currentTime += frameInterval;
      frameCount++;

      if (frameCount % 5 === 0) {
        setProgress(Math.min(currentTime / video.duration, 1));
      }
    }

    if (cancelledRef.current) return;

    setProgress(1);
    setStatus("done");

    onComplete({
      videoBlob: file,
      series,
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
