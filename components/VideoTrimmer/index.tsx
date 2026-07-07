"use client";

import { useEffect, useRef, useState } from "react";
import {
  PauseIcon,
  PlayIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

const MIN_SEL = 5;
const MAX_SEL = 30;
const THUMB_COUNT = 10;
const STRIP_H = 64;
const HANDLE_W = 28;

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
  const [curTime, setCurTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  // Load main preview video
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const video = videoRef.current!;
    video.src = url;
    video.load();

    const onLoaded = () => {
      const d = video.duration;
      if (!isFinite(d) || d <= 0) { setStatus("error"); return; }
      setDuration(d);
      setStartTime(0);
      setEndTime(Math.min(MAX_SEL, d));
      setCurTime(0);
      video.currentTime = 0;
      setStatus("ready");
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", () => setStatus("error"), { once: true });

    return () => { URL.revokeObjectURL(url); };
  }, []);

  // Extract thumbnails progressively using a separate hidden video so the
  // preview stays immediately interactive while frames fill in.
  useEffect(() => {
    if (status !== "ready" || !duration) return;

    let cancelled = false;
    const url = objectUrlRef.current!;
    const thumbVid = document.createElement("video");
    thumbVid.muted = true;
    thumbVid.playsInline = true;
    thumbVid.preload = "auto";
    thumbVid.style.cssText =
      "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(thumbVid);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const run = async () => {
      thumbVid.src = url;
      thumbVid.load();
      await new Promise<void>((resolve) => {
        thumbVid.addEventListener("loadedmetadata", () => resolve(), { once: true });
        thumbVid.addEventListener("error", () => resolve(), { once: true });
      });

      if (!ctx || !isFinite(thumbVid.duration) || thumbVid.duration <= 0) return;

      const vw = thumbVid.videoWidth || 320;
      const vh = thumbVid.videoHeight || 240;
      canvas.height = STRIP_H;
      canvas.width = Math.round(STRIP_H * (vw / vh));

      const result: string[] = [];
      for (let i = 0; i < THUMB_COUNT; i++) {
        if (cancelled) break;
        const t = THUMB_COUNT > 1 ? (i / (THUMB_COUNT - 1)) * thumbVid.duration : 0;
        thumbVid.currentTime = t;
        await new Promise<void>((resolve) => {
          const onSeeked = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => {
            thumbVid.removeEventListener("seeked", onSeeked);
            resolve();
          }, 2000);
          thumbVid.addEventListener("seeked", onSeeked, { once: true });
        });
        if (cancelled) break;
        try {
          ctx.drawImage(thumbVid, 0, 0, canvas.width, canvas.height);
          result.push(canvas.toDataURL("image/jpeg", 0.6));
        } catch {
          result.push("");
        }
        if (!cancelled) setThumbnails([...result]);
      }
    };

    run().finally(() => {
      if (thumbVid.parentNode) thumbVid.parentNode.removeChild(thumbVid);
    });

    return () => {
      cancelled = true;
      thumbVid.src = "";
      if (thumbVid.parentNode) thumbVid.parentNode.removeChild(thumbVid);
    };
  }, [status, duration]);

  // Track currentTime and enforce trim end
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      setCurTime(video.currentTime);
      if (video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setCurTime(startTime);
        setIsPlaying(false);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
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
        setCurTime(startTime);
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

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const which = draggingRef.current;
    if (!which || !duration) return;
    const t = timeFromClientX(e.clientX);

    if (which === "start") {
      const newStart = Math.max(0, Math.min(t, endTime - MIN_SEL));
      const newEnd = endTime - newStart > MAX_SEL ? newStart + MAX_SEL : endTime;
      setStartTime(newStart);
      setEndTime(newEnd);
      if (videoRef.current && !isPlaying) {
        videoRef.current.currentTime = newStart;
        setCurTime(newStart);
      }
    } else {
      const newEnd = Math.max(startTime + MIN_SEL, Math.min(t, duration));
      const newStart = newEnd - startTime > MAX_SEL ? Math.max(0, newEnd - MAX_SEL) : startTime;
      setEndTime(newEnd);
      setStartTime(newStart);
      if (videoRef.current && !isPlaying) {
        videoRef.current.currentTime = newEnd;
        setCurTime(newEnd);
      }
    }
  };

  const onPointerUp = () => { draggingRef.current = null; };

  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;
  const curPct = duration ? (curTime / duration) * 100 : 0;
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
      </div>

      {/* Filmstrip + controls */}
      {status === "ready" && (
        <div className="shrink-0 px-4 pt-3 pb-2">
          {/* Playback row */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
            >
              {isPlaying
                ? <PauseIcon className="h-4 w-4 text-white" />
                : <PlayIcon className="h-4 w-4 text-white" />
              }
            </button>
            <span className="font-mono text-xs text-white/50">
              {formatTime(curTime)} / {formatTime(duration)}
            </span>
            {canTrim && (
              <span className="font-mono text-xs ml-auto" style={{ color: "#5dadec" }}>
                {selDuration}s
              </span>
            )}
          </div>

          {/* Filmstrip */}
          {canTrim && (
            <div
              ref={trackRef}
              className="relative select-none touch-none overflow-hidden rounded-sm"
              style={{ height: STRIP_H }}
            >
              {/* Thumbnail cells */}
              <div className="absolute inset-0 flex">
                {Array.from({ length: THUMB_COUNT }).map((_, i) => (
                  <div key={i} className="flex-1 h-full bg-white/5 overflow-hidden">
                    {thumbnails[i] && (
                      <img
                        src={thumbnails[i]}
                        alt=""
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Dim overlay — left of selection */}
              <div
                className="absolute top-0 bottom-0 left-0 pointer-events-none"
                style={{ width: `${startPct}%`, background: "rgba(0,0,0,0.65)" }}
              />

              {/* Dim overlay — right of selection */}
              <div
                className="absolute top-0 bottom-0 right-0 pointer-events-none"
                style={{ width: `${100 - endPct}%`, background: "rgba(0,0,0,0.65)" }}
              />

              {/* Selection top bar */}
              <div
                className="absolute top-0 pointer-events-none"
                style={{
                  left: `${startPct}%`,
                  width: `${endPct - startPct}%`,
                  height: 3,
                  background: "#5dadec",
                }}
              />

              {/* Selection bottom bar */}
              <div
                className="absolute bottom-0 pointer-events-none"
                style={{
                  left: `${startPct}%`,
                  width: `${endPct - startPct}%`,
                  height: 3,
                  background: "#5dadec",
                }}
              />

              {/* Start handle */}
              <div
                className="absolute top-0 bottom-0 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                style={{
                  left: `${startPct}%`,
                  transform: "translateX(-50%)",
                  width: HANDLE_W,
                  background: "#5dadec",
                  zIndex: 10,
                }}
                onPointerDown={(e) => {
                  draggingRef.current = "start";
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <ChevronLeftIcon className="h-5 w-5 text-white" strokeWidth={2.5} />
              </div>

              {/* End handle */}
              <div
                className="absolute top-0 bottom-0 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                style={{
                  left: `${endPct}%`,
                  transform: "translateX(-50%)",
                  width: HANDLE_W,
                  background: "#5dadec",
                  zIndex: 10,
                }}
                onPointerDown={(e) => {
                  draggingRef.current = "end";
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <ChevronRightIcon className="h-5 w-5 text-white" strokeWidth={2.5} />
              </div>

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: `${curPct}%`,
                  transform: "translateX(-50%)",
                  width: 2,
                  background: "white",
                  zIndex: 20,
                }}
              />
            </div>
          )}
        </div>
      )}

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
