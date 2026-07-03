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

  const updatedJointData = {};

  jointNames.forEach((jointName) => {
    const jointConfig = jointConfigMap[jointName] ?? { invert: false };
    const history = jointDataMap[jointName]?.angleHistory ?? [];
    const jointKeypoints = getJointKeypoints(jointName, keypoints);
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

    const newHistory = angleHistorySize > 0 
      ? [...history, angleNow]
      : [];
    if (newHistory.length > angleHistorySize) {
      newHistory.shift();
    } 

    const smoothedAngle = angleHistorySize > 0 
      ? newHistory.reduce((a, b) => a + b, 0) / newHistory.length
      : angleNow;

    updatedJointData[jointName] = {
      angle: smoothedAngle,
      angleHistory: newHistory,
      color: getColorsForJoint(jointName),
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

  let proximalSegment; // segmento proximal
  let distalSegment; // segmento distal
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
      y: referencePoint.y - B.y 
    };
  }
  else {
    proximalSegment = { x: A.x - B.x, y: A.y - B.y };

    distalSegment = { x: C.x - B.x, y: C.y - B.y };
  }

  const dot = proximalSegment.x * distalSegment.x + proximalSegment.y * distalSegment.y;
  const cross = proximalSegment.x * distalSegment.y - proximalSegment.y * distalSegment.x; // Producto cruzado en 2D
  if ((proximalSegment.x === 0 && proximalSegment.y === 0) || (distalSegment.x === 0 && distalSegment.y === 0)) return 0;
  const angleRad = Math.atan2(cross, dot);
  const angleDeg = angleRad * (180 / Math.PI);

  let angleDegAdjusted;
  // ángulo ajustado a la orientación (Left/Right/Back/Front)
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
  // ángulo desenrollado para evitar saltos de ±180º
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

    // el signo es el opuesto que para el criterio de signos de cadera
    if (isKnee) angleDegAdjusted = -angleDegAdjusted;
  }

  return angleDegAdjusted ?? angleDeg;
  ///
  // ángulo entre 0 y 180, sin importar el signo del giro
  // const BA = { x: A.x - B.x, y: A.y - B.y };
  // const BC = { x: C.x - B.x, y: C.y - B.y };
  // const dot = BA.x * BC.x + BA.y * BC.y;
  // const magBA = Math.hypot(BA.x, BA.y);
  // const magBC = Math.hypot(BC.x, BC.y);
  // if (magBA === 0 || magBC === 0) return 0;
  // let angleDeg = Math.acos(dot / (magBA * magBC)) * (180 / Math.PI);
  //
  // return invert ? 180 - angleDeg : angleDeg;
  ///
}

function getJointKeypoints(jointName, keypoints) {
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

  const [a, b, c] = jointPoints;
  const kpA = keypoints.find(kp => kp.name === a);
  const kpB = keypoints.find(kp => kp.name === b);
  const kpC = keypoints.find(kp => kp.name === c);
  return kpA && kpB && kpC ? [kpA, kpB, kpC] : null;
}

function getColorsForJoint(jointName) {
  if (!jointName) return { borderColor: 'white', backgroundColor: 'white' };
  let hash = 0;
  for (let i = 0; i < jointName.length; i++) {
    hash = jointName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const absHash = Math.abs(hash);
  const lower = jointName.toLowerCase();
  const isRight = lower.includes('right') && !lower.includes('left');
  const isLeft = lower.includes('left') && !lower.includes('right');
  const baseHue = isRight ? absHash % 180 : isLeft ? (absHash % 180) + 180 : absHash % 360;
  return {
    borderColor: `hsl(${baseHue}, 70%, 50%)`,
    backgroundColor: `hsla(${baseHue}, 70%, 50%, 0.2)`,
  };
}
