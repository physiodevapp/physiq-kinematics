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
        {isFrozen && <PauseIcon className="h-4 w-4 animate-pulse" />}
      </h1>

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
          className="h-6 w-6 cursor-pointer text-white"
          onClick={() => setIsPoseSettingsModalOpen((prev) => !prev)}
        />

        <PresentationChartLineIcon
          className={`h-6 w-6 cursor-pointer transition-opacity duration-150 ${showGraph ? "text-white opacity-100" : "text-white opacity-40"}`}
          onClick={() => setShowGraph((prev) => !prev)}
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

      {/* Bottom right controls — float above graph panel when visible */}
      <div
        className="absolute right-1 z-30 flex flex-row-reverse items-center gap-2 transition-all duration-300"
        style={{ bottom: showGraph ? "calc(45vh + 0.5rem)" : "0.5rem" }}
      >
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
          jointDataRef={jointDataRef}
          selectedJoints={selectedJoints}
          isFrozen={isFrozen}
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

      <PoseSettingsModal isModalOpen={isPoseSettingsModalOpen} />
    </main>
  );
}
