"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasKeypointName, JointDataMap } from "@/interfaces/pose";
import { VideoConstraints } from "@/interfaces/camera";
import { useSettings } from "@/providers/Settings";
import { OrthogonalReference } from "@/providers/Settings";
import { PoseOrientation } from "@/utils/pose";
import { jointOptions, formatJointName } from "@/utils/joint";
import {
  CameraIcon,
  UserIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Bars2Icon,
  PauseIcon,
  PresentationChartLineIcon,
} from "@heroicons/react/24/outline";
import PoseModal from "@/modals/Poses";
import PoseSettingsModal from "@/modals/PoseSettings";
import AngleGraph from "@/components/AngleGraph";
import type { KinematicsLiveHandle } from "@/components/KinematicsLive";
import { QUICK_CLOSE_DURATION, type DraggableSheetHandle } from "@/hooks/useDraggableSheet";

const KinematicsLive = dynamic(
  () => import("../components/KinematicsLive").then((mod) => mod.default),
  { ssr: false }
);

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
  const shouldResumeRef = useRef(false);

  const jointDataRef = useRef<JointDataMap>({});
  const jointWorkerRef = useRef<Worker | null>(null);
  const kinematicsLiveRef = useRef<KinematicsLiveHandle>(null);
  const angleGraphRef = useRef<DraggableSheetHandle>(null);
  const poseSettingsRef = useRef<DraggableSheetHandle>(null);
  const isSheetTransitioningRef = useRef(false);

  const poseOrientations: PoseOrientation[] = ["front", "back", "left", "right", "auto"];

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;

  // Start camera immediately when standalone; wait for PHYSIQ_SAT_VISIBLE when inside hub iframe
  const [isCameraActive, setIsCameraActive] = useState(!isInIframe);

  const handleGoHome = () => {
    window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*");
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

  // Mirrors KinematicsLive's handleClickOnCanvas: same guard (close modals first if
  // one is open), same freeze toggle otherwise — so this title button truly behaves
  // like tapping the video.
  const handleTitlePauseClick = () => {
    if (isPoseSettingsModalOpen || showPoseOrientationModal) {
      setIsPoseSettingsModalOpen(false);
      setShowPoseOrientationModal(false);
    } else {
      kinematicsLiveRef.current?.setIsFrozen((prev) => !prev);
    }
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

      {/* Title bar — container is pointer-events-none so only explicit targets capture clicks */}
      <h1 className="pointer-events-none absolute z-10 top-1 left-1 font-display text-base sm:text-lg text-white bg-[#5dadec] dark:bg-black/40 rounded-2xl py-1.5 px-4 whitespace-nowrap inline-flex items-center gap-1.5 max-w-[85vw] select-none">
        {isInIframe && (
          <span
            className="pointer-events-auto animate-hub-back-hint transition-opacity duration-150 hover:opacity-100 cursor-pointer"
            style={{ opacity: 0.55 }}
            onClick={handleGoHome}
          >‹</span>
        )}
        <span
          className={isInIframe ? "pointer-events-auto cursor-pointer transition-opacity duration-150 hover:opacity-75" : ""}
          onClick={isInIframe ? handleGoHome : undefined}
        >Physi<span style={{ background: "linear-gradient(135deg,#4f9cf9,#38d9a9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Q</span></span>
        <span className="opacity-50 font-normal">—</span>
        <span style={{ color: "#5dadec" }}>Kinematics</span>
        {isFrozen && (
          <PauseIcon
            className="pointer-events-auto cursor-pointer h-4 w-4 animate-pulse"
            onClick={handleTitlePauseClick}
          />
        )}
      </h1>

      {/* Camera feed + canvas — only mounted when satellite is visible */}
      <div className="relative w-full flex-1">
        {isCameraActive && (
          <KinematicsLive
            ref={kinematicsLiveRef}
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

        <Cog6ToothIcon
          className={`h-6 w-6 cursor-pointer transition-opacity duration-150 ${isPoseSettingsModalOpen ? "text-white opacity-100" : "text-white opacity-40"}`}
          onClick={handleTogglePoseSettings}
        />

        <PresentationChartLineIcon
          className={`h-6 w-6 cursor-pointer transition-opacity duration-150 ${showGraph ? "text-white opacity-100" : "text-white opacity-40"}`}
          onClick={handleToggleGraph}
        />

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
    </main>
  );
}
