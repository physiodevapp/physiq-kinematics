import { CanvasKeypointName } from "@/interfaces/pose";
import * as poseDetection from "@tensorflow-models/pose-detection";
import { getColorsForJoint } from "./joint";

interface DrawKeypointsOptions {
  ctx: CanvasRenderingContext2D;
  keypoints: poseDetection.Keypoint[];
  selectedKeypoint?: CanvasKeypointName | null;
  pointColor?: string;
  pointRadius?: number;
  mirror?: boolean;
}

export const drawKeypoints = ({
  ctx,
  keypoints,
  pointColor,
  pointRadius = 5,
  mirror = false,
}: DrawKeypointsOptions) => {
  keypoints.forEach((kp) => {
    const x = mirror ? ctx.canvas.width - kp.x : kp.x;
    const y = kp.y;

    ctx.beginPath();
    ctx.arc(x, y, pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = pointColor ?? getColorsForJoint(kp.name ?? null).borderColor;
    ctx.fill();
  });
};

interface DrawKeypointConnectionsOptions {
  ctx: CanvasRenderingContext2D;
  keypoints: poseDetection.Keypoint[];
  keypointPairs: [CanvasKeypointName, CanvasKeypointName][];
  strokeStyle?: string;
  lineWidth?: number;
  mirror?: boolean;
}

export const drawKeypointConnections = ({
  ctx,
  keypoints,
  keypointPairs,
  strokeStyle = "white",
  lineWidth = 2,
  mirror = false,
}: DrawKeypointConnectionsOptions) => {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;

  keypointPairs.forEach(([pointA, pointB]) => {
    const kpA = keypoints.find((kp) => kp.name === pointA);
    const kpB = keypoints.find((kp) => kp.name === pointB);

    if (kpA && kpB) {
      const xA = mirror ? ctx.canvas.width - kpA.x : kpA.x;
      const xB = mirror ? ctx.canvas.width - kpB.x : kpB.x;

      ctx.beginPath();
      ctx.moveTo(xA, kpA.y);
      ctx.lineTo(xB, kpB.y);
      ctx.stroke();
    }
  });
};

export const getCanvasScaleFactor = ({
  canvas,
  sourceDimensions,
}: {
  canvas: HTMLCanvasElement | null;
  sourceDimensions?: { width: number; height: number };
}): number => {
  if (!canvas || !sourceDimensions) return 1;

  const canvasDisplayWidth = canvas.clientWidth;
  const canvasDisplayHeight = canvas.clientHeight;

  const { width, height } = sourceDimensions;

  if (!width || !height) return 1;

  const inverseScaleX = width / canvasDisplayWidth;
  const inverseScaleY = height / canvasDisplayHeight;
  const rawScale = Math.max(inverseScaleX, inverseScaleY);
  return Math.min(Math.max(rawScale, 1.5), 4);
};
