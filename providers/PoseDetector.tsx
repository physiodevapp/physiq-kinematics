"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { useSettings } from './Settings';

export type DetectorType = poseDetection.PoseDetector | null;

interface PoseDetectorContextType {
  detector: DetectorType;
  detectorModel: poseDetection.SupportedModels | null;
  minPoseScore: number;
  isDetectorReady: boolean;
}

const PoseDetectorContext = createContext<PoseDetectorContextType | null>(null);

interface PoseDetectorProviderProps {
  isTfReady: boolean;
  children: React.ReactNode;
}

export const PoseDetectorProvider: React.FC<PoseDetectorProviderProps> = ({ isTfReady, children }) => {
  const [detector, setDetector] = useState<DetectorType>(null);
  const [detectorModel, setDetectorModel] = useState<poseDetection.SupportedModels | null>(null);
  const [isDetectorReady, setIsDetectorReady] = useState(false);

  const [minPoseScore] = useState(0.3);

  const { settings } = useSettings();
  const { poseModel } = settings.pose;

  useEffect(() => {
    if (!isTfReady) return;

    const initializeDetector = async () => {
      try {
        if (detectorModel === poseModel) return;

        setIsDetectorReady(false);

        let detectorInstance;

        if (poseModel === poseDetection.SupportedModels.MoveNet) {
          detectorInstance = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            {
              modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
              minPoseScore,
            },
          );
        } else if (poseModel === poseDetection.SupportedModels.BlazePose) {
          detectorInstance = await poseDetection.createDetector(
            poseDetection.SupportedModels.BlazePose,
            {
              runtime: 'tfjs',
              enableSmoothing: true,
              modelType: 'lite',
            },
          );
        }

        setDetector(detectorInstance!);
        setDetectorModel(poseModel);
        setIsDetectorReady(true);
      } catch (error) {
        console.error("Error initializing detector:", error);
      }
    };

    initializeDetector();
  }, [isTfReady, detector, poseModel]);

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
