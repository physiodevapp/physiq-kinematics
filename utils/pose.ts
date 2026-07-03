import { CanvasKeypointName, JointConfigMap, JointDataMap } from "@/interfaces/pose";
import { OrthogonalReference } from "@/providers/Settings";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { RefObject } from "react";

export type PoseOrientation = "front" | "back" | "left" | "right" | "auto";

export const excludedKeypoints = [
  'left_eye', 'right_eye',
  'left_eye_inner', 'right_eye_inner',
  'left_eye_outer', 'right_eye_outer',
  'mouth_left', 'mouth_right',
  'left_thumb', 'right_thumb',
  'left_index', 'right_index',
  'left_pinky', 'right_pinky',
];

export const excludedDrawableKeypoints = [
  'left_ear', 'right_ear',
  'nose',
];

export const keypointPairs: [CanvasKeypointName, CanvasKeypointName][] = [
  [CanvasKeypointName.LEFT_SHOULDER, CanvasKeypointName.RIGHT_SHOULDER],
  [CanvasKeypointName.LEFT_SHOULDER, CanvasKeypointName.LEFT_ELBOW],
  [CanvasKeypointName.LEFT_ELBOW, CanvasKeypointName.LEFT_WRIST],
  [CanvasKeypointName.RIGHT_SHOULDER, CanvasKeypointName.RIGHT_ELBOW],
  [CanvasKeypointName.RIGHT_ELBOW, CanvasKeypointName.RIGHT_WRIST],
  [CanvasKeypointName.LEFT_HIP, CanvasKeypointName.RIGHT_HIP],
  [CanvasKeypointName.LEFT_HIP, CanvasKeypointName.LEFT_KNEE],
  [CanvasKeypointName.LEFT_KNEE, CanvasKeypointName.LEFT_ANKLE],
  [CanvasKeypointName.LEFT_ANKLE, CanvasKeypointName.LEFT_HEEL],
  [CanvasKeypointName.LEFT_ANKLE, CanvasKeypointName.LEFT_FOOT_INDEX],
  [CanvasKeypointName.LEFT_HEEL, CanvasKeypointName.LEFT_FOOT_INDEX],
  [CanvasKeypointName.RIGHT_HIP, CanvasKeypointName.RIGHT_KNEE],
  [CanvasKeypointName.RIGHT_KNEE, CanvasKeypointName.RIGHT_ANKLE],
  [CanvasKeypointName.RIGHT_ANKLE, CanvasKeypointName.RIGHT_HEEL],
  [CanvasKeypointName.RIGHT_ANKLE, CanvasKeypointName.RIGHT_FOOT_INDEX],
  [CanvasKeypointName.RIGHT_HEEL, CanvasKeypointName.RIGHT_FOOT_INDEX],
];

export const updateMultipleJoints = ({
  keypoints,
  selectedJoints,
  jointDataRef,
  jointConfigMap,
  jointWorker,
  orthogonalReference,
  formatJointName,
  jointAngleHistorySize,
  setAnglesToDisplay,
  poseOrientation,
}: {
  keypoints: poseDetection.Keypoint[];
  selectedJoints: CanvasKeypointName[];
  jointDataRef: RefObject<JointDataMap>;
  jointConfigMap: JointConfigMap;
  jointWorker: Worker;
  orthogonalReference?: OrthogonalReference;
  formatJointName: (jointName: string) => string;
  jointAngleHistorySize: number;
  setAnglesToDisplay?: React.Dispatch<React.SetStateAction<string[]>>;
  poseOrientation: PoseOrientation | null;
}): Promise<JointDataMap> => {
  return new Promise((resolve) => {
    if (!jointWorker) return resolve({} as JointDataMap);

    const jointNamesToUse = selectedJoints;

    if (!jointNamesToUse.length) return resolve({} as JointDataMap);

    const jointDataMap = jointNamesToUse.reduce((acc, jointName) => {
      const data = jointDataRef.current[jointName];
      acc[jointName] = {
        angleHistory: data?.angleHistory ?? [],
      };
      return acc;
    }, {} as Record<string, { angleHistory: number[] }>);

    const handleWorkerResponse = (e: MessageEvent<{ updatedJointData: JointDataMap }>) => {
      const updatedJointData = e.data.updatedJointData;
      const jointAngles: Record<string, { L?: string; R?: string }> = {};

      selectedJoints.forEach((jointName) => {
        const updatedData = updatedJointData[jointName];
        const label = formatJointName(jointName);

        const match = label.match(/^(R|L) (.+)$/);
        if (match) {
          const [, side, baseName] = match;

          if (!jointAngles[baseName]) jointAngles[baseName] = {};

          if (updatedData) {
            jointDataRef.current[jointName] = updatedData;
            jointAngles[baseName][side as 'L' | 'R'] = `${updatedData.angle.toFixed(0)}°`;
          }
        } else {
          jointAngles[label] = {
            L: updatedData ? `${updatedData.angle.toFixed(0)}°` : "-",
          };

          if (updatedData) {
            jointDataRef.current[jointName] = updatedData;
          }
        }
      });

      const anglesToDisplay: string[] = [];

      Object.entries(jointAngles).forEach(([baseName, { L, R }]) => {
        if (L && R) {
          anglesToDisplay.push(`${baseName}: ${L} / ${R}`);
        } else if (L) {
          anglesToDisplay.push(`L ${baseName}: ${L}`);
        } else if (R) {
          anglesToDisplay.push(`R ${baseName}: ${R}`);
        } else {
          anglesToDisplay.push(`${baseName}: -`);
        }
      });

      if (setAnglesToDisplay) {
        setAnglesToDisplay(prev => {
          const hasChanged =
            prev.length !== anglesToDisplay.length ||
            prev.some((val, i) => val !== anglesToDisplay[i]);

          return hasChanged ? anglesToDisplay : prev;
        });
      }

      resolve(updatedJointData);
    };

    jointWorker.addEventListener('message', handleWorkerResponse, { once: true });

    jointWorker.postMessage({
      keypoints,
      jointNames: jointNamesToUse,
      jointConfigMap,
      jointDataMap,
      angleHistorySize: jointAngleHistorySize,
      orthogonalReference,
      poseOrientation,
    });
  });
};

export function inferPoseOrientation(keypoints: poseDetection.Keypoint[]): PoseOrientation | null {
  const nose = keypoints.find(kp => kp.name === 'nose');
  const leftEar = keypoints.find(kp => kp.name === 'left_ear');
  const rightEar = keypoints.find(kp => kp.name === 'right_ear');

  if (!nose || !leftEar || !rightEar) return null;

  if (nose.x > leftEar.x && nose.x > rightEar.x) {
    return 'right';
  } else if (nose.x < leftEar.x && nose.x < rightEar.x) {
    return 'left';
  } else if (leftEar.x > nose.x && leftEar.x > rightEar.x) {
    return 'front';
  } else if (rightEar.x > nose.x && rightEar.x > leftEar.x) {
    return 'back';
  } else {
    return null;
  }
}

export function adjustOrientationForMirror(
  orientation: PoseOrientation | null,
  isMirrored: boolean
): PoseOrientation | null {
  if (!orientation || !isMirrored) return orientation;
  if (orientation === 'left') return 'right';
  if (orientation === 'right') return 'left';
  return orientation;
}
