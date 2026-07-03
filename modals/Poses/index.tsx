"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { checkbox } from "@/interfaces/checkbox";
import { CanvasKeypointName } from "@/interfaces/pose";
import { CheckIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

interface IndexProps {
  isModalOpen: boolean;
  handleModal: () => void;
  onSelectionChange: (selectedItems: string[]) => void;
  maxSelected?: number;
  jointOptions: checkbox[];
  initialSelectedJoints?: CanvasKeypointName[];
}

const Index = ({
  isModalOpen,
  handleModal,
  onSelectionChange,
  maxSelected = 6,
  jointOptions,
  initialSelectedJoints = [],
}: IndexProps) => {
  const { basePath } = useRouter();
  const [checkboxStates, setCheckboxStates] = useState<boolean[]>(
    jointOptions.map((joint) => initialSelectedJoints.includes(joint.value as CanvasKeypointName))
  );
  const [imageLoaded, setImageLoaded] = useState(false);
  const hiddenImgRef = useRef<HTMLImageElement>(null);

  // If the image is already in cache (complete) when the modal mounts, mark it ready immediately
  useEffect(() => {
    if (hiddenImgRef.current?.complete) setImageLoaded(true);
  }, []);

  const selectedCount = checkboxStates.filter(Boolean).length;

  const handleCheckboxChange = (index: number, checked: boolean) => {
    const newStates = [...checkboxStates];
    newStates[index] = checked;
    setCheckboxStates(newStates);
  };

  const positions = [
    { top: "20%", left: "20%" },
    { top: "35%", left: "15%" },
    { top: "50%", left: "30%" },
    { top: "65%", left: "28%" },
    { top: "20%", left: "80%" },
    { top: "35%", left: "85%" },
    { top: "50%", left: "70%" },
    { top: "65%", left: "75%" },
  ];

  useEffect(() => {
    const selectedItems = checkboxStates.reduce(
      (acc: string[], state, index) => {
        if (state) acc.push(jointOptions[index].value);
        return acc;
      },
      []
    );
    onSelectionChange(selectedItems);
  }, [checkboxStates, onSelectionChange]);

  if (!isModalOpen) return null;

  return (
    <div
      className="fixed w-full h-dvh inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: "blur(30px)" }}
      onClick={handleModal}
    >
      {/* Hidden img triggers onLoad and warms the browser cache */}
      <img
        ref={hiddenImgRef}
        src={`${basePath}/human.png`}
        onLoad={() => setImageLoaded(true)}
        className="hidden"
        alt=""
      />

      <p className="font-display absolute top-2 text-white text-base sm:text-lg bg-black/40 rounded-2xl py-1.5 px-6">
        Seleccionar articulaciones
      </p>

      {!imageLoaded ? (
        <div className="flex items-center justify-center h-[70vh] aspect-[806/2000]">
          <ArrowPathIcon className="w-8 h-8 text-white animate-spin" />
        </div>
      ) : (
        <div
          className="relative h-[70vh] bg-center bg-contain bg-no-repeat aspect-[806/2000]"
          style={{ backgroundImage: `url('${basePath}/human.png')` }}
          onClick={(e) => {
            e.stopPropagation();
            handleModal();
          }}
        >
          {jointOptions.map((joint, index) => (
            <label
              key={joint.value}
              className="absolute flex items-center justify-center cursor-pointer"
              style={{
                top: positions[index].top,
                left: positions[index].left,
                transform: "translate(-50%, -50%)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={checkboxStates[index]}
                disabled={!checkboxStates[index] && selectedCount >= maxSelected}
                onChange={(e) => handleCheckboxChange(index, e.target.checked)}
                className="absolute opacity-0 w-0 h-0"
              />
              <div
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${
                  checkboxStates[index]
                    ? "bg-[#5dadec] border-[#5dadec] opacity-100"
                    : "bg-black/30 border-white/40 opacity-60"
                }`}
              >
                {checkboxStates[index] && (
                  <CheckIcon className="w-4 h-4 text-white stroke-[2.5]" />
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default Index;
