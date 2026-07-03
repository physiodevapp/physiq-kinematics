// jointWorker.js

self.onmessage = (e) => {
  const {
    keypoints,
    jointNames,
    jointConfigMap,
    jointDataMap = {},
    angleHistorySize,
    orthogonalReference,
    poseOrientation,
  } = e.data;

  // Build O(1) name→keypoint map once per message instead of Array.find per joint
  const kpMap = new Map();
  for (let i = 0; i < keypoints.length; i++) {
    kpMap.set(keypoints[i].name, keypoints[i]);
  }

  const updatedJointData = {};

  jointNames.forEach((jointName) => {
    const jointConfig = jointConfigMap[jointName] ?? { invert: false };
    const history = jointDataMap[jointName]?.angleHistory ?? [];
    const jointKeypoints = getJointKeypoints(jointName, kpMap);
    if (!jointKeypoints) return;

    const [kpA, kpB, kpC] = jointKeypoints;
    const angleNow = calculateJointAngleDegrees(
      kpA,
      kpB,
      kpC,
      jointConfig.invert,
      orthogonalReference,
      poseOrientation,
    );

    // Avoid spread+shift: slice from tail then append
    const newHistory = history.length < angleHistorySize
      ? history.concat(angleNow)
      : history.slice(history.length - angleHistorySize + 1).concat(angleNow);

    const smoothedAngle = angleHistorySize > 0
      ? newHistory.reduce((a, b) => a + b, 0) / newHistory.length
      : angleNow;

    updatedJointData[jointName] = {
      angle: smoothedAngle,
      angleHistory: newHistory,
      timestamp: Date.now(),
    };
  });

  self.postMessage({ updatedJointData });
};

// === Funciones auxiliares ===

function calculateJointAngleDegrees(
  A, B, C,
  invert = false,
  orthogonalReference,
  poseOrientation,
) {
  const isShoulder = B.name?.includes('shoulder');
  const isElbow = B.name?.includes('elbow');
  const isHip = B.name?.includes('hip');
  const isKnee = B.name?.includes('knee');

  const jointSide = B.name?.includes("left") ? "left"
    : B.name?.includes("right") ? "right"
    : undefined;

  let proximalSegment;
  let distalSegment;
  if (orthogonalReference === 'vertical') {
    proximalSegment = { x: 0, y: 1 };

    let targetName;
    if (isShoulder) targetName = 'elbow';
    if (isHip) targetName = 'knee';
    if (isElbow) targetName = 'wrist';
    if (isKnee) targetName = 'ankle';
    const referencePoint = A.name?.includes(targetName) ? A
      : C.name?.includes(targetName) ? C
      : null;
    if (!referencePoint) return 0;
    distalSegment = {
      x: referencePoint.x - B.x,
      y: referencePoint.y - B.y,
    };
  } else {
    proximalSegment = { x: A.x - B.x, y: A.y - B.y };
    distalSegment = { x: C.x - B.x, y: C.y - B.y };
  }

  const dot = proximalSegment.x * distalSegment.x + proximalSegment.y * distalSegment.y;
  const cross = proximalSegment.x * distalSegment.y - proximalSegment.y * distalSegment.x;
  if ((proximalSegment.x === 0 && proximalSegment.y === 0) || (distalSegment.x === 0 && distalSegment.y === 0)) return 0;
  const angleRad = Math.atan2(cross, dot);
  const angleDeg = angleRad * (180 / Math.PI);

  let angleDegAdjusted;
  if (poseOrientation === "left") angleDegAdjusted = angleDeg;
  if (poseOrientation === "right") angleDegAdjusted = -angleDeg;
  if (
    (poseOrientation === "front" && jointSide === "left") ||
    (poseOrientation === "back" && jointSide === "right")
  ) angleDegAdjusted = -angleDeg;
  if (
    (poseOrientation === "front" && jointSide === "right") ||
    (poseOrientation === "back" && jointSide === "left")
  ) angleDegAdjusted = angleDeg;

  let hasCrossedVertical;
  if (poseOrientation === "left") hasCrossedVertical = distalSegment.x > 0 && distalSegment.y < 0;
  if (poseOrientation === "right") hasCrossedVertical = distalSegment.x < 0 && distalSegment.y < 0;
  if (
    (poseOrientation === "front" && jointSide === "left") ||
    (poseOrientation === "back" && jointSide === "right")
  ) hasCrossedVertical = distalSegment.x < 0 && distalSegment.y < 0;
  if (
    (poseOrientation === "front" && jointSide === "right") ||
    (poseOrientation === "back" && jointSide === "left")
  ) hasCrossedVertical = distalSegment.x > 0 && distalSegment.y < 0;
  if (angleDegAdjusted < 0 && hasCrossedVertical) angleDegAdjusted += 360;

  if (!orthogonalReference) {
    angleDegAdjusted = (invert && angleDegAdjusted < 0) ? 180 + angleDegAdjusted
      : (invert && angleDegAdjusted > 0) ? angleDegAdjusted - 180
      : angleDegAdjusted;

    if (isKnee) angleDegAdjusted = -angleDegAdjusted;
  }

  return angleDegAdjusted ?? angleDeg;
}

function getJointKeypoints(jointName, kpMap) {
  const map = {
    right_elbow: ['right_shoulder', 'right_elbow', 'right_wrist'],
    right_knee: ['right_hip', 'right_knee', 'right_ankle'],
    right_shoulder: ['right_hip', 'right_shoulder', 'right_elbow'],
    right_hip: ['right_shoulder', 'right_hip', 'right_knee'],
    left_elbow: ['left_shoulder', 'left_elbow', 'left_wrist'],
    left_knee: ['left_hip', 'left_knee', 'left_ankle'],
    left_shoulder: ['left_hip', 'left_shoulder', 'left_elbow'],
    left_hip: ['left_shoulder', 'left_hip', 'left_knee'],
  };

  const jointPoints = map[jointName];
  if (!jointPoints) return null;

  const kpA = kpMap.get(jointPoints[0]);
  const kpB = kpMap.get(jointPoints[1]);
  const kpC = kpMap.get(jointPoints[2]);
  return kpA && kpB && kpC ? [kpA, kpB, kpC] : null;
}
