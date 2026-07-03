"use client";

import { useSettings } from '@/providers/Settings';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import React from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';

interface IndexProps {
  isModalOpen: boolean;
}

const Index = ({ isModalOpen }: IndexProps) => {
  const {
    settings,
    setAngularHistorySize,
    setPoseModel,
    resetPoseSettings,
  } = useSettings();
  const { angularHistorySize, poseModel } = settings.pose;

  if (!isModalOpen) return null;

  return (
    <div className="fixed z-40 bottom-0 left-0 w-full px-4 pt-4 pb-8 flex flex-col items-center bg-gradient-to-b from-black/40 to-black rounded-t-lg">
      <div
        className="w-full h-9 flex justify-end text-white italic font-bold cursor-pointer"
        onClick={resetPoseSettings}
      >
        Set default values{" "}
        <ArrowPathIcon className="ml-2 w-6 h-6" />
      </div>
      <form className="w-full flex flex-col justify-center gap-8 mt-2">
        <div className="flex w-full gap-6">
          <div className="flex-1 flex flex-col justify-between gap-2">
            <label htmlFor="angular-history" className="text-white">
              Angle<span className="align-sub uppercase text-[0.6rem]"> Smooth</span>: {angularHistorySize}
            </label>
            <input
              id="angular-history"
              type="range"
              value={angularHistorySize}
              min="5"
              max="20"
              onChange={(e) => setAngularHistorySize(Number(e.target.value))}
            />
          </div>
          <div className="flex-1 flex flex-col justify-end gap-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                value=""
                className="sr-only peer"
                checked={poseModel === poseDetection.SupportedModels.BlazePose}
                onChange={() => {
                  const next =
                    poseModel === poseDetection.SupportedModels.MoveNet
                      ? poseDetection.SupportedModels.BlazePose
                      : poseDetection.SupportedModels.MoveNet;
                  setPoseModel(next);
                }}
              />
              <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:bg-[#5dadec] transition-all duration-200" />
              <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full shadow bg-white peer-checked:translate-x-full transform transition-all duration-200" />
              <span className="text-white text-sm pl-2">
                {poseModel === poseDetection.SupportedModels.BlazePose
                  ? poseDetection.SupportedModels.BlazePose
                  : poseDetection.SupportedModels.MoveNet}
              </span>
            </label>
          </div>
        </div>
      </form>
    </div>
  );
};

export default Index;
