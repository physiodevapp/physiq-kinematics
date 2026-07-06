"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
import type { KinematicsSeries } from "@/interfaces/kinematics";
import { VideoConstraints } from "@/interfaces/camera";
import { useSettings } from "@/providers/Settings";
import { OrthogonalReference } from "@/providers/Settings";
import { PoseOrientation } from "@/utils/pose";
import { jointOptions, formatJointName } from "@/utils/joint";
import {
  CameraIcon,
  ChevronDownIcon,
  UserIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  Bars2Icon,
  FilmIcon,
  PauseIcon,
  PresentationChartLineIcon,
  StopIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import PoseModal from "@/modals/Poses";
import PoseSettingsModal from "@/modals/PoseSettings";
import AngleGraph from "@/components/AngleGraph";
import { QUICK_CLOSE_DURATION, type DraggableSheetHandle } from "@/hooks/useDraggableSheet";

const KinematicsLive = dynamic(
  () => import("../components/KinematicsLive").then((mod) => mod.default),
  { ssr: false }
);

const KinematicsReview = dynamic(
  () => import("../components/KinematicsReview").then((mod) => mod.default),
  { ssr: false }
);

const KinematicsRecordingsList = dynamic(
  () => import("../components/KinematicsRecordingsList").then((mod) => mod.default),
  { ssr: false }
);

const VideoProcessor = dynamic(
  () => import("../components/VideoProcessor").then((mod) => mod.default),
  { ssr: false }
);

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export default function Home() {
  const { basePath } = useRouter();
  const {
    settings,
    setSelectedJoints,
    setOrthogonalReference,
    setPoseOrientation,
  } = useSettings();
  const { selectedJoints, orthogonalReference, poseOrientation } = settings.pose;

  const [poseOrientationInferred, setPoseOrientationInferred] = useState<PoseOrientation | null>(null);

  const [isFrozen, setIsFrozen] = useState(false);
  const [anglesToDisplay, setAnglesToDisplay] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [videoConstraints, setVideoConstraints] = useState<VideoConstraints>({ facingMode: "user" });

  const [isPoseModalOpen, setIsPoseModalOpen] = useState(false);
  const [isPoseSettingsModalOpen, setIsPoseSettingsModalOpen] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  const [showPoseOrientationModal, setShowPoseOrientationModal] = useState(false);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
  const shouldResumeRef = useRef(false);

  const jointDataRef = useRef<JointDataMap>({});
  const jointWorkerRef = useRef<Worker | null>(null);
  const angleGraphRef = useRef<DraggableSheetHandle>(null);
  const poseSettingsRef = useRef<DraggableSheetHandle>(null);
  const isSheetTransitioningRef = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showSentToast, setShowSentToast] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [showNoDataDialog, setShowNoDataDialog] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const kinematicsSeriesRef = useRef<KinematicsSeries>({});
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  type ReviewData = {
    id: number;
    startedAt: number;
    videoBlob: Blob;
    series: KinematicsSeries;
    duration: number;
    joints: CanvasKeypointName[];
    facingMode: string;
  };
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [recordings, setRecordings] = useState<ReviewData[]>([]);
  const [showRecordingsList, setShowRecordingsList] = useState(false);

  const poseOrientations: PoseOrientation[] = ["front", "back", "left", "right", "auto"];

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;

  // Start camera immediately when standalone; wait for PHYSIQ_SAT_VISIBLE when inside hub iframe
  const [isCameraActive, setIsCameraActive] = useState(!isInIframe);

  const handleGoHome = () => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
  };

  const handleJointData = useCallback((data: JointDataMap) => {
    if (!isRecordingRef.current) return;
    const elapsed = Date.now() - recordingStartedAtRef.current;
    Object.entries(data).forEach(([joint, jointData]) => {
      if (!jointData) return;
      if (!kinematicsSeriesRef.current[joint]) {
        kinematicsSeriesRef.current[joint] = { t: [], a: [] };
      }
      kinematicsSeriesRef.current[joint].t.push(elapsed);
      kinematicsSeriesRef.current[joint].a.push(Math.round(jointData.angle));
    });
  }, []);

  const handleStartRecording = () => {
    kinematicsSeriesRef.current = {};
    recordingStartedAtRef.current = Date.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordingDuration(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    }, 1000);

    if (streamRef.current) {
      videoChunksRef.current = [];
      try {
        const mimeType = getSupportedMimeType();
        const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) videoChunksRef.current.push(e.data);
        };
        mediaRecorderRef.current = mr;
        mr.start(200);
      } catch {
        // MediaRecorder unavailable — review will show chart only
      }
    }
  };

  const stopMediaRecorder = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") {
        resolve(null);
        return;
      }
      mr.onstop = () => {
        const chunks = videoChunksRef.current;
        const blob = chunks.length > 0
          ? new Blob(chunks, { type: mr.mimeType || "video/webm" })
          : null;
        videoChunksRef.current = [];
        mediaRecorderRef.current = null;
        resolve(blob);
      };
      mr.stop();
    });

  const handleStopRecording = async () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const startedAt = recordingStartedAtRef.current;
    const duration = Date.now() - startedAt;
    const series = { ...kinematicsSeriesRef.current };
    kinematicsSeriesRef.current = {};

    if (!Object.keys(series).length) {
      await stopMediaRecorder();
      setShowNoDataDialog(true);
      return;
    }

    const videoBlob = await stopMediaRecorder();
    setReviewData({
      id: startedAt,
      startedAt,
      videoBlob: videoBlob ?? new Blob(),
      series,
      duration,
      joints: [...selectedJoints],
      facingMode: videoConstraints.facingMode ?? "user",
    });
  };

  const handleAcceptAndRecordAnother = () => {
    if (!reviewData) return;
    setRecordings((prev) => [...prev, reviewData]);
    setReviewData(null);
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    setShowSavedToast(true);
    savedToastTimerRef.current = setTimeout(() => setShowSavedToast(false), 2000);
  };

  const handleDeleteRecording = (id: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSendToReport = () => {
    const all = reviewData ? [...recordings, reviewData] : recordings;
    if (!all.length) return;
    const ch = new BroadcastChannel("physiq-session");
    ch.postMessage({
      type: "SESSION_KINEMATICS",
      kinematics: all.map(({ startedAt, duration, joints, series }) => ({
        startedAt,
        duration,
        joints,
        series,
      })),
    });
    ch.close();
    setRecordings([]);
    setReviewData(null);
    setShowRecordingsList(false);
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    setShowSavedToast(false);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setShowSentToast(true);
    toastTimerRef.current = setTimeout(() => setShowSentToast(false), 2500);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setIsFrozen(true);
    }
    e.target.value = "";
  };

  const handleUploadComplete = (data: {
    videoBlob: Blob;
    series: KinematicsSeries;
    duration: number;
    joints: CanvasKeypointName[];
  }) => {
    setUploadFile(null);
    setIsFrozen(false);
    if (!Object.keys(data.series).length) {
      setShowNoDataDialog(true);
      return;
    }
    setReviewData({
      id: Date.now(),
      startedAt: Date.now(),
      videoBlob: data.videoBlob,
      series: data.series,
      duration: data.duration,
      joints: data.joints,
      facingMode: "environment",
    });
  };

  const handleUploadCancel = () => {
    setUploadFile(null);
    setIsFrozen(false);
  };

  const formatRecordingDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleWorkerLifecycle = (start: boolean) => {
    if (start && !jointWorkerRef.current) {
      jointWorkerRef.current = new Worker("/physiq/kinematics/workers/jointWorker.js");
    } else if (!start && jointWorkerRef.current) {
      jointWorkerRef.current.terminate();
      jointWorkerRef.current = null;
    }
  };

  const handleJointSelection = useCallback((selectedJoints: string[]) => {
    setSelectedJoints(selectedJoints as CanvasKeypointName[]);

    setAnglesToDisplay((prevAngles) => {
      const jointAngles: Record<string, { L?: string; R?: string }> = {};
      const result: string[] = [];

      selectedJoints.forEach((joint) => {
        const formatted = formatJointName(joint);
        const existing = prevAngles.find((a) => a.startsWith(formatted));
        if (!existing) return;

        const match = formatted.match(/^(R|L) (.+)$/);
        if (match) {
          const [, side, baseName] = match;
          if (!jointAngles[baseName]) jointAngles[baseName] = {};
          jointAngles[baseName][side as "L" | "R"] = existing.split(":")[1].trim();
        } else {
          jointAngles[formatted] = { L: existing.split(":")[1].trim() };
        }
      });

      Object.entries(jointAngles).forEach(([baseName, { L, R }]) => {
        if (L && R) {
          result.push(`${baseName}: ${L} / ${R}`);
        } else if (L) {
          result.push(`L ${baseName}: ${L}`);
        } else if (R) {
          result.push(`R ${baseName}: ${R}`);
        } else {
          result.push(`${baseName}: - °`);
        }
      });

      return result;
    });
  }, []);

  // Pose settings and the angle graph are both bottom sheets — keep them mutually
  // exclusive so they never render stacked on top of each other. Closing a sheet
  // (whether re-tapping its own icon or switching to the other one) goes through
  // its ref's animated close() instead of flipping the mount flag directly, so it
  // slides out instead of vanishing instantly.
  //
  // isPoseSettingsModalOpen/showGraph only flip once a close animation finishes
  // (QUICK_CLOSE_DURATION later), so a toggle tap that lands mid-animation would
  // still read the stale "open" value and misfire another close instead of
  // reopening — a rapid gear/graph/gear/graph tap sequence could end with BOTH
  // sheets closed. isSheetTransitioningRef locks out toggle taps for the duration
  // of any in-flight close so only one transition is ever in flight at a time.
  const lockSheetTransition = () => {
    isSheetTransitioningRef.current = true;
    setTimeout(() => { isSheetTransitioningRef.current = false; }, QUICK_CLOSE_DURATION);
  };

  const handleTogglePoseSettings = () => {
    if (isSheetTransitioningRef.current) return;
    if (isPoseSettingsModalOpen) {
      lockSheetTransition();
      poseSettingsRef.current?.close();
      return;
    }
    if (showGraph) {
      lockSheetTransition();
      angleGraphRef.current?.close();
    }
    setIsPoseSettingsModalOpen(true);
  };

  const handleToggleGraph = () => {
    if (isSheetTransitioningRef.current) return;
    if (showGraph) {
      lockSheetTransition();
      angleGraphRef.current?.close();
      return;
    }
    if (isPoseSettingsModalOpen) {
      lockSheetTransition();
      poseSettingsRef.current?.close();
    }
    setShowGraph(true);
  };

  const toggleCamera = () => {
    setVideoConstraints((prev) => ({
      facingMode: prev.facingMode === "user" ? "environment" : "user",
    }));
  };

  // Preload the joint-selection body diagram so it's cached before the modal opens
  useEffect(() => {
    new Image().src = `${basePath}/human.png`;
  }, [basePath]);

  // Hub integration: listen for visibility messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "PHYSIQ_SAT_VISIBLE") {
        setIsCameraActive(true);
      } else if (e.data?.type === "PHYSIQ_SAT_HIDDEN") {
        setIsCameraActive(false);
        setIsFrozen(false);
        setIsPoseSettingsModalOpen(false);
        setShowPoseOrientationModal(false);
        setIsPoseModalOpen(false);
        setReviewData(null);
        setRecordings([]);
        setShowRecordingsList(false);
        setShowSavedToast(false);
        setShowNoDataDialog(false);
        setUploadFile(null);
        if (isRecordingRef.current) {
          isRecordingRef.current = false;
          setIsRecording(false);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          const mr = mediaRecorderRef.current;
          if (mr && mr.state !== "inactive") {
            mr.onstop = null;
            mr.stop();
            mediaRecorderRef.current = null;
          }
          videoChunksRef.current = [];
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (isCameraActive) {
      handleWorkerLifecycle(true);
    } else {
      handleWorkerLifecycle(false);
    }
    return () => handleWorkerLifecycle(false);
  }, [isCameraActive]);

  return (
    <main className="relative flex flex-col items-center justify-start h-dvh overflow-hidden">

      {/* Title bar — status indicator only; pause/resume via canvas tap */}
      <h1 className="absolute z-10 top-1 left-1 font-display text-base sm:text-lg text-white bg-[#5dadec] dark:bg-black/40 rounded-2xl py-1.5 px-4 whitespace-nowrap inline-flex items-center gap-1.5 max-w-[85vw] select-none">
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
        {isFrozen && (
          <PauseIcon className="h-4 w-4 animate-pulse" />
        )}
        {isRecording && (
          <>
            <span className="opacity-30 font-normal">|</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="font-mono text-sm text-red-400">{formatRecordingDuration(recordingDuration)}</span>
            </span>
          </>
        )}
        {recordings.length > 0 && (
          <>
            <span className="opacity-30 font-normal">|</span>
            <button
              onClick={() => setShowRecordingsList(true)}
              className="flex items-center gap-1 active:opacity-70"
            >
              <FilmIcon className="h-4 w-4" />
              <span className="font-mono text-sm">{recordings.length}</span>
            </button>
          </>
        )}
      </h1>

      {showSavedToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-black/70 rounded-full px-4 py-1.5 text-white text-xs whitespace-nowrap">
          Grabación guardada · {recordings.length} en total
        </div>
      )}

      {showSentToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-black/70 rounded-full px-4 py-1.5 text-white text-xs whitespace-nowrap">
          Cinemática enviada al informe
        </div>
      )}

      {showNoDataDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-6"
          onClick={() => setShowNoDataDialog(false)}
        >
          <div
            className="bg-black border border-white/15 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-white text-lg mb-2">Sin datos articulares</h3>
            <p className="text-white/60 text-sm leading-relaxed mb-5">
              No se detectaron articulaciones durante la grabación. Encuadra bien las articulaciones seleccionadas y vuelve a intentarlo.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowNoDataDialog(false)}
                className="px-4 py-2 rounded-md text-sm text-white font-medium active:opacity-80"
                style={{ background: "#5dadec" }}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera feed + canvas — only mounted when satellite is visible */}
      <div className="relative w-full flex-1">
        {isCameraActive && (
          <KinematicsLive
            orthogonalReference={orthogonalReference}
            videoConstraints={videoConstraints}
            anglesToDisplay={anglesToDisplay}
            setAnglesToDisplay={setAnglesToDisplay}
            isPoseSettingsModalOpen={isPoseSettingsModalOpen}
            setIsPoseSettingsModalOpen={setIsPoseSettingsModalOpen}
            jointWorkerRef={jointWorkerRef}
            jointDataRef={jointDataRef}
            onChangeIsFrozen={setIsFrozen}
            onWorkerInit={() => handleWorkerLifecycle(true)}
            showGrid={showGrid}
            showPoseOrientationModal={showPoseOrientationModal}
            setShowPoseOrientationModal={setShowPoseOrientationModal}
            onPoseOrientationInferredChange={setPoseOrientationInferred}
            onJointData={handleJointData}
            onStreamReady={(s) => { streamRef.current = s; }}
          />
        )}
      </div>

      {/* Right toolbar */}
      <section className="absolute top-1 right-1 p-2 z-10 flex flex-col justify-between gap-6 bg-[#5dadec] dark:bg-black/40 rounded-2xl">
        <div
          className="relative cursor-pointer"
          onClick={toggleCamera}
        >
          <CameraIcon className="h-6 w-6 text-white" />
          <ArrowPathIcon className="absolute top-[60%] -right-1 h-4 w-4 text-[#5dadec] dark:text-white bg-white/80 dark:bg-black/80 rounded-full p-[0.1rem]" />
        </div>

        <UserIcon
          className="h-6 w-6 cursor-pointer text-white"
          onClick={() => setIsPoseModalOpen((prev) => !prev)}
        />

        <div className="w-6 flex justify-center items-center z-10">
          <button
            className={`h-6 w-6 rounded-md text-center text-[1.2rem] font-bold leading-none uppercase ${
              poseOrientation === "auto"
                ? "bg-green-500"
                : poseOrientation
                ? "bg-[#5dadec]"
                : "bg-red-500 animate-pulse"
            }`}
            onClick={() => {
              setShowPoseOrientationModal((prev) => !prev);
              shouldResumeRef.current = !isFrozen;
            }}
          >
            {poseOrientation === "auto"
              ? poseOrientationInferred?.[0] ?? "?"
              : poseOrientation
              ? poseOrientation[0]
              : "?"}
          </button>
        </div>

        <button
          onClick={() => setIsToolbarExpanded((prev) => !prev)}
          className="flex justify-center items-center"
        >
          <ChevronDownIcon
            className={`h-4 w-4 text-white/70 transition-transform duration-200 ${isToolbarExpanded ? "rotate-180" : ""}`}
          />
        </button>

        <div
          className="flex flex-col gap-6 overflow-hidden transition-all duration-200"
          style={{
            maxHeight: isToolbarExpanded ? "300px" : "0px",
            opacity: isToolbarExpanded ? 1 : 0,
          }}
        >
          <Cog6ToothIcon
            className={`h-6 w-6 cursor-pointer transition-opacity duration-150 ${isPoseSettingsModalOpen ? "text-white opacity-100" : "text-white opacity-40"}`}
            onClick={handleTogglePoseSettings}
          />

          <PresentationChartLineIcon
            className={`h-6 w-6 cursor-pointer transition-opacity duration-150 ${showGraph ? "text-white opacity-100" : "text-white opacity-40"}`}
            onClick={handleToggleGraph}
          />

          <button
            disabled={selectedJoints.length === 0 || isRecording}
            onClick={handleUploadClick}
            className={`h-6 w-6 flex items-center justify-center ${
              selectedJoints.length === 0 || isRecording
                ? "opacity-25 cursor-not-allowed"
                : ""
            }`}
          >
            <ArrowUpTrayIcon className="h-6 w-6 text-white" />
          </button>

          <button
            disabled={selectedJoints.length === 0 && !isRecording}
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className={`h-6 w-6 rounded-full flex items-center justify-center transition-all duration-150 ${
              selectedJoints.length === 0 && !isRecording
                ? "opacity-25 cursor-not-allowed"
                : isRecording
                ? "bg-red-500 animate-pulse"
                : "border-2 border-white/70"
            }`}
          >
            {isRecording
              ? <StopIcon className="h-3.5 w-3.5 text-white" />
              : <VideoCameraIcon className="h-4 w-4 text-white" />
            }
          </button>
        </div>

        {/* Pose orientation picker */}
        {showPoseOrientationModal && (
          <section className="absolute top-[0.2rem] right-full mr-2 flex flex-col gap-2">
            {poseOrientations.map((orientation) => (
              <div key={orientation} className="w-[3.8rem]">
                <button
                  className={`rounded-md w-full py-1 ${
                    orientation === poseOrientation && poseOrientation === "auto"
                      ? "bg-green-500"
                      : orientation === poseOrientation
                      ? "bg-[#5dadec]"
                      : "bg-black/40"
                  }`}
                  onClick={() => {
                    setPoseOrientation(orientation);
                    setShowPoseOrientationModal(false);
                  }}
                >
                  <span className="uppercase text-white">{orientation[0]}</span>
                  <span className="text-white">{orientation.slice(1)}</span>
                </button>
              </div>
            ))}
          </section>
        )}
      </section>

      {/* Bottom right controls — fixed position; AngleGraph reserves bottom padding
          so its content never renders underneath these instead of chasing the sheet
          with an animated offset (which drifted out of sync with the sheet's own
          transition). */}
      <div className="absolute right-1 bottom-2 z-30 flex flex-row-reverse items-center gap-2">
        <ArrowTopRightOnSquareIcon
          className={`w-8 h-8 text-white transition-transform ${
            orthogonalReference === undefined ? "-rotate-0 opacity-50" : "-rotate-45"
          }`}
          onClick={() => {
            const next: OrthogonalReference =
              orthogonalReference === "vertical" ? undefined : "vertical";
            setOrthogonalReference(next);
          }}
        />
        <div
          className={`relative ${showGrid ? "opacity-100" : "opacity-40"}`}
          onClick={() => setShowGrid((prev) => !prev)}
        >
          <Bars2Icon className="h-8 w-8 text-white" />
          <Bars2Icon className="absolute top-[0.025rem] left-[0.026rem] rotate-90 h-8 w-8 text-white" />
        </div>
      </div>

      {/* Real-time angle graph — bottom sheet */}
      {showGraph && (
        <AngleGraph
          ref={angleGraphRef}
          jointDataRef={jointDataRef}
          selectedJoints={selectedJoints}
          isFrozen={isFrozen}
          onClose={() => setShowGraph(false)}
        />
      )}

      {/* Modals */}
      <PoseModal
        isModalOpen={isPoseModalOpen}
        handleModal={() => setIsPoseModalOpen((prev) => !prev)}
        jointOptions={jointOptions}
        maxSelected={6}
        initialSelectedJoints={selectedJoints}
        onSelectionChange={handleJointSelection}
      />

      {isPoseSettingsModalOpen && (
        <PoseSettingsModal ref={poseSettingsRef} onClose={() => setIsPoseSettingsModalOpen(false)} />
      )}

      {reviewData && (
        <KinematicsReview
          videoBlob={reviewData.videoBlob}
          series={reviewData.series}
          duration={reviewData.duration}
          joints={reviewData.joints}
          facingMode={reviewData.facingMode}
          recordingNumber={recordings.length + 1}
          onSend={handleSendToReport}
          onDiscard={() => setReviewData(null)}
          onAcceptAndRecordAnother={handleAcceptAndRecordAnother}
        />
      )}

      {showRecordingsList && (
        <KinematicsRecordingsList
          recordings={recordings}
          onDelete={handleDeleteRecording}
          onSend={handleSendToReport}
          onClose={() => setShowRecordingsList(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {uploadFile && (
        <VideoProcessor
          file={uploadFile}
          selectedJoints={selectedJoints}
          poseOrientation={poseOrientation}
          orthogonalReference={orthogonalReference}
          angularHistorySize={settings.pose.angularHistorySize}
          onComplete={handleUploadComplete}
          onCancel={handleUploadCancel}
        />
      )}
    </main>
  );
}
