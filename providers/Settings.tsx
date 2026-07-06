"use client";

import { CanvasKeypointName } from '@/interfaces/pose';
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { PoseOrientation } from '@/utils/pose';

export type OrthogonalReference = 'vertical' | undefined;
export type PoseModel = 'lite' | 'full' | 'heavy';

interface PoseSettings {
  selectedJoints: CanvasKeypointName[];
  angularHistorySize: number;
  poseModel: PoseModel;
  orthogonalReference: OrthogonalReference;
  poseOrientation: PoseOrientation | null;
}

interface Settings {
  pose: PoseSettings;
}

interface SettingsContextProps {
  settings: Settings;
  setSelectedJoints: (joints: CanvasKeypointName[]) => void;
  setAngularHistorySize: (size: number) => void;
  setPoseModel: (value: PoseModel) => void;
  setOrthogonalReference: (value: OrthogonalReference) => void;
  setPoseOrientation: (value: PoseOrientation | null) => void;
  resetPoseSettings: () => void;
}

const SettingsContext = createContext<SettingsContextProps | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const defaultConfig: Settings = {
    pose: {
      selectedJoints: [],
      angularHistorySize: 5,
      poseModel: 'lite' as PoseModel,
      orthogonalReference: undefined,
      poseOrientation: "auto",
    },
  };

  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("physiq-kinematics-settings");
      return stored ? JSON.parse(stored) : defaultConfig;
    }
    return defaultConfig;
  });

  const setSelectedJoints = (joints: CanvasKeypointName[]) => {
    setSettings(prev => ({ ...prev, pose: { ...prev.pose, selectedJoints: joints } }));
  };

  const setAngularHistorySize = (size: number) => {
    if (size >= 1 && size <= 20) {
      setSettings(prev => ({ ...prev, pose: { ...prev.pose, angularHistorySize: size } }));
    }
  };

  const setPoseModel = (value: PoseModel) => {
    setSettings(prev => ({ ...prev, pose: { ...prev.pose, poseModel: value } }));
  };

  const setOrthogonalReference = (value: OrthogonalReference) => {
    setSettings(prev => ({ ...prev, pose: { ...prev.pose, orthogonalReference: value } }));
  };

  const setPoseOrientation = (value: PoseOrientation | null) => {
    setSettings(prev => ({ ...prev, pose: { ...prev.pose, poseOrientation: value } }));
  };

  const resetPoseSettings = () => {
    setSettings(prev => ({
      ...prev,
      pose: {
        ...defaultConfig.pose,
        selectedJoints: prev.pose.selectedJoints,
      },
    }));
  };

  useEffect(() => {
    localStorage.setItem("physiq-kinematics-settings", JSON.stringify(settings));
  }, [settings]);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        setSelectedJoints,
        setAngularHistorySize,
        setPoseModel,
        setOrthogonalReference,
        setPoseOrientation,
        resetPoseSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextProps => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
