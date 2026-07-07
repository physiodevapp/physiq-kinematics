"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, XMarkIcon } from "@heroicons/react/24/outline";

const MIN_SEL = 5;
const MAX_SEL = 30;

function formatTime(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

interface VideoTrimmerProps {
  file: File;
  isMirrored: boolean;
  onConfirm: (startTime: number, endTime: number) => void;
  onCancel: () => void;
}

export default function VideoTrimmer({ file, isMirrored, onConfirm, onCancel }: VideoTrimmerProps) {
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const video = videoRef.current!;
    video.src = url;
    video.load();

    const onLoaded = () => {
      const d = video.duration;
      if (!isFinite(d) || d <= 0) { setStatus("error"); return; }
      const initialEnd = Math.min(MAX_SEL, d);
      setDuration(d);
      setStartTime(0);
      setEndTime(initialEnd);
      video.currentTime = 0;
      setStatus("ready");
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", () => setStatus("error"), { once: true });

    return () => { URL.revokeObjectURL(url); };
  }, []);

  // Stop playback when currentTime reaches the trim end
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const check = () => {
      if (video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlaying(false);
      }
    };
    video.addEventListener("timeupdate", check);
    return () => video.removeEventListener("timeupdate", check);
  }, [startTime, endTime]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      if (video.currentTime < startTime || video.currentTime >= endTime) {
        video.currentTime = startTime;
      }
      video.play();
      setIsPlaying(true);
    }
  };

  const timeFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || !duration) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };

  const onStartPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = "start";
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onEndPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = "end";
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const which = draggingRef.current;
    if (!which || !duration) return;
    const t = timeFromClientX(e.clientX);

    if (which === "start") {
      const newStart = Math.max(0, Math.min(t, endTime - MIN_SEL, duration - MIN_SEL));
      const newEnd = newStart + (endTime - startTime) > newStart + MAX_SEL
        ? newStart + MAX_SEL
        : endTime;
      setStartTime(newStart);
      setEndTime(newEnd);
      if (videoRef.current && !isPlaying) videoRef.current.currentTime = newStart;
    } else {
      const newEnd = Math.max(startTime + MIN_SEL, Math.min(t, duration));
      const newStart = newEnd - startTime > MAX_SEL
        ? Math.max(0, newEnd - MAX_SEL)
        : startTime;
      setEndTime(newEnd);
      setStartTime(newStart);
      if (videoRef.current && !isPlaying) videoRef.current.currentTime = newEnd;
    }
  };

  const onPointerUp = () => { draggingRef.current = null; };

  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 0;
  const selDuration = Math.round(endTime - startTime);
  const canTrim = duration > MIN_SEL;

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;
  const handleGoHome = () => window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");

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
              className={isInIframe ? "cursor-pointer transition-opacity duration-150 hover:opacity-75" : ""}
              onClick={isInIframe ? handleGoHome : undefined}
            >
              Physi
              <span style={{ background: "linear-gradient(135deg,#4f9cf9,#38d9a9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Q
              </span>
            </span>
            <span className="opacity-50 font-normal">—</span>
            <span style={{ color: "#5dadec" }}>Kinematics</span>
          </h2>
          <button onClick={onCancel} className="p-1 -mr-1">
            <XMarkIcon className="h-5 w-5 text-white/50" />
          </button>
        </div>
      </div>

      {/* Video preview */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0">
        <video
          ref={videoRef}
          className="max-h-full max-w-full object-contain"
          style={isMirrored ? { transform: "scaleX(-1)" } : undefined}
          playsInline
          muted
        />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/40 text-sm">Cargando vídeo...</p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-red-400 text-sm">No se pudo cargar el vídeo.</p>
          </div>
        )}
        {status === "ready" && (
          <button
            onClick={togglePlay}
            className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center active:bg-black/70"
          >
            {isPlaying
              ? <PauseIcon className="h-5 w-5 text-white" />
              : <PlayIcon className="h-5 w-5 text-white" />
            }
          </button>
        )}
      </div>

      {/* Trim controls */}
      <div className="shrink-0 px-5 pt-5 pb-2">
        {status === "ready" && canTrim && (
          <>
            {/* Dual-handle track */}
            <div
              ref={trackRef}
              className="relative h-8 flex items-center select-none touch-none"
            >
              {/* Background track */}
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15 pointer-events-none" />
              {/* Selected range highlight */}
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full pointer-events-none"
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%`, background: "#5dadec" }}
              />
              {/* Start handle */}
              <div
                className="absolute top-1/2 w-5 h-5 rounded-full bg-white shadow-lg -translate-y-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing touch-none"
                style={{ left: `${startPct}%` }}
                onPointerDown={onStartPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
              {/* End handle */}
              <div
                className="absolute top-1/2 w-5 h-5 rounded-full bg-white shadow-lg -translate-y-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing touch-none"
                style={{ left: `${endPct}%` }}
                onPointerDown={onEndPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            </div>

            {/* Time labels */}
            <div className="flex justify-between items-center font-mono text-xs mt-2 text-white/40">
              <span>{formatTime(startTime)}</span>
              <span style={{ color: "#5dadec" }}>{selDuration}s</span>
              <span>{formatTime(endTime)}</span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 px-4 py-4 space-y-2">
        {status === "ready" && (
          <button
            onClick={() => onConfirm(startTime, endTime)}
            className="w-full py-3 rounded-md text-sm text-white font-medium active:opacity-80"
            style={{ background: "#5dadec" }}
          >
            {canTrim ? "Procesar selección" : "Procesar vídeo"}
          </button>
        )}
        {status === "error" && (
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-md text-sm text-white font-medium active:opacity-80"
            style={{ background: "#5dadec" }}
          >
            Volver
          </button>
        )}
        <button
          onClick={onCancel}
          className="w-full py-3 rounded-md text-sm border border-white/20 active:bg-white/5"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
