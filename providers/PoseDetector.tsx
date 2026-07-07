"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
import { useSettings, PoseModel } from './Settings';

export type DetectorType = PoseLandmarker | null;

interface PoseDetectorContextType {
  detector: DetectorType;
  detectorModel: PoseModel | null;
  minPoseScore: number;
  isDetectorReady: boolean;
}

const PoseDetectorContext = createContext<PoseDetectorContextType | null>(null);

const MODEL_URLS: Record<PoseModel, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

// Singleton: WASM runtime is loaded once per browser session regardless of how
// many times the provider mounts/unmounts (satellite hide/show cycles).
let visionPromise: Promise<WasmFileset> | null = null;
const getVision = (): Promise<WasmFileset> => {
  if (!visionPromise) visionPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  return visionPromise;
};

export const PoseDetectorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [detector, setDetector] = useState<DetectorType>(null);
  const [detectorModel, setDetectorModel] = useState<PoseModel | null>(null);
  const [isDetectorReady, setIsDetectorReady] = useState(false);
  const minPoseScore = 0.5;

  const { settings } = useSettings();
  const { poseModel } = settings.pose;

  const activeRef = useRef<PoseLandmarker | null>(null);
  const initInProgressRef = useRef(false);

  useEffect(() => {
    if (detectorModel === poseModel && isDetectorReady) return;
    if (initInProgressRef.current) return;

    let cancelled = false;
    initInProgressRef.current = true;

    const init = async () => {
      try {
        setIsDetectorReady(false);
        activeRef.current?.close();
        activeRef.current = null;

        const vision = await getVision();

        const instance = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URLS[poseModel],
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: minPoseScore,
          minPosePresenceConfidence: minPoseScore,
          minTrackingConfidence: minPoseScore,
        });

        if (!cancelled) {
          activeRef.current = instance;
          setDetector(instance);
          setDetectorModel(poseModel);
          setIsDetectorReady(true);
        } else {
          instance.close();
        }
      } catch (error) {
        console.error('Error initializing MediaPipe detector:', error);
      } finally {
        initInProgressRef.current = false;
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [poseModel]);

  return (
    <PoseDetectorContext.Provider value={{ detector, detectorModel, minPoseScore, isDetectorReady }}>
      {children}
    </PoseDetectorContext.Provider>
  );
};

export const usePoseDetector = (): PoseDetectorContextType => {
  const context = useContext(PoseDetectorContext);
  if (!context) {
    throw new Error('usePoseDetector must be used within a PoseDetectorProvider');
  }
  return context;
};
