@AGENTS.md

# CLAUDE.md — physiq-kinematics

This file provides guidance to Claude Code when working with code in this repository.

## What this project is

**physiq-kinematics** is a PhysiQ satellite that provides real-time joint angle measurement via the device camera. It runs as a static Next.js app served at `/physiq/kinematics/` inside the PhysiQ hub iframe.

The satellite's job is to:
1. Open the device camera and run TensorFlow.js pose detection in the browser
2. Overlay a skeleton on the live feed and compute joint angles off the main thread
3. Display selected joint angles in real time
4. Integrate with the PhysiQ hub via `postMessage` and `BroadcastChannel`

## Architecture

```
physiq-kinematics/
├── pages/
│   ├── index.tsx           — main page (camera feed + toolbars + modals)
│   ├── _app.tsx            — provider chain
│   └── _document.tsx       — HTML shell (dark mode, Google Fonts)
├── components/
│   └── KinematicsLive/     — core real-time component (camera + canvas + detection loop)
├── modals/
│   ├── Poses/              — joint selection overlay on human body diagram
│   └── PoseSettings/       — smoothing + model toggle panel
├── providers/
│   ├── Settings.tsx        — pose settings (localStorage: physiq-kinematics-settings)
│   ├── TensorFlow.tsx      — WebGL backend initialisation
│   └── PoseDetector.tsx    — MoveNet / BlazePose detector lifecycle
├── utils/
│   ├── joint.ts            — jointConfigMap, jointOptions, getColorsForJoint, formatJointName
│   ├── draw.ts             — drawKeypoints, drawKeypointConnections, getCanvasScaleFactor
│   └── pose.ts             — PoseOrientation, inferPoseOrientation, updateMultipleJoints
├── interfaces/
│   ├── pose.ts             — CanvasKeypointName, Kinematics, JointData, JointDataMap
│   ├── camera.ts           — VideoConstraints
│   └── checkbox.ts         — checkbox { label, value }
├── mocks/
│   └── mediapipe-pose.js   — empty mock (TF.js imports @mediapipe/pose but we use tfjs runtime)
├── public/
│   ├── workers/
│   │   └── jointWorker.js  — Web Worker: computes joint angles off main thread via atan2
│   └── human.png           — body diagram for joint selection modal
├── styles/
│   └── globals.css         — Tailwind v4 import, font families, range input styles
└── .github/workflows/
    └── deploy-to-hub.yml   — CD: build → copy out/ to physiq/kinematics/ → push
```

## Key providers

### Settings (`providers/Settings.tsx`)
Persists to `localStorage['physiq-kinematics-settings']`. Pose-only settings:

| Setting | Type | Default | Description |
|---|---|---|---|
| `selectedJoints` | `CanvasKeypointName[]` | `[]` | Joints to track and display |
| `angularHistorySize` | `number` | `10` | Smoothing buffer (5–20 frames) |
| `poseModel` | `SupportedModels` | MoveNet | MoveNet (fast) or BlazePose (accurate) |
| `orthogonalReference` | `"vertical" \| undefined` | `undefined` | Vertical reference line on canvas |
| `poseOrientation` | `PoseOrientation \| null` | `null` | front/back/left/right/auto |

### TensorFlow (`providers/TensorFlow.tsx`)
Initialises the `@tensorflow/tfjs-backend-webgl` backend before pose detection starts. Must wrap `PoseDetector`.

### PoseDetector (`providers/PoseDetector.tsx`)
Creates and tears down the TF.js detector when `poseModel` changes. Exposes the detector instance via context.

## Web Worker (`public/workers/jointWorker.js`)

Angle computation runs entirely off the main thread to avoid blocking the animation loop.

- Input: `{ joints, keypoints }` — selected joint names + current keypoints from TF.js
- Output: `{ jointName, angle }` messages back to main thread
- Math: `atan2` on keypoint pairs defined in `jointConfigMap`
- Path in production: `/physiq/kinematics/workers/jointWorker.js` (must use full basePath)

## Joints supported

| Joint | Keypoints used |
|---|---|
| L/R Shoulder | elbow → shoulder → hip |
| L/R Elbow | shoulder → elbow → wrist |
| L/R Hip | shoulder → hip → knee |
| L/R Knee | hip → knee → ankle |

## Design system

physiq-kinematics aligns with the PhysiQ satellite ecosystem:

- **Fonts**: Outfit (body), DM Serif Display (branding/title), DM Mono (labels) — loaded via Google Fonts in `_document.tsx`
- **Icons**: `@heroicons/react/24/outline` only — never solid/filled
- **Border radius**: `rounded-2xl` (16px) for overlay panels and title; `rounded-md` for buttons
- **Accent colour**: `#5dadec` (sky blue — matches the hub card colour for this satellite)
- **Dark mode**: always on — `className="dark"` on `<Html>` in `_document.tsx`; Tailwind variant `@custom-variant dark (&:where(.dark, .dark *))`

The satellite is camera-first: the video fills the full viewport. UI controls float as overlays (pill title, side toolbars) rather than a fixed header.

## Hub integration

### postMessage (satellite → hub)

```js
window.parent.postMessage({ type: "PHYSIQ_GO_HOME" }, "*")  // go back to hub home
```

### postMessage (hub → satellite)

```js
// Satellite listens for:
{ type: "PHYSIQ_SAT_HIDDEN" }  // close any open modals/sheets before iframe is hidden
```

### iframe declaration in hub (`physiq/index.html`)

```html
<iframe id="sat-kinematics" class="sat-frame" allow="camera" hidden></iframe>
```

The `allow="camera"` permission is required for `getUserMedia`.

## Static export & asset paths

```ts
// next.config.ts
output: 'export'
basePath: '/physiq/kinematics'
assetPrefix: '/physiq/kinematics/'
```

**Important**: Tailwind CSS class values like `bg-[url('/image.png')]` are resolved at build time and ignore `assetPrefix`. For background images loaded from `public/`, use inline styles with `router.basePath`:

```tsx
import { useRouter } from 'next/router'
const { basePath } = useRouter()
// ...
style={{ backgroundImage: `url('${basePath}/human.png')` }}
```

## CD pipeline (`.github/workflows/deploy-to-hub.yml`)

Triggers on push to `main`:

1. `npm ci` + `npm run build` → generates `out/`
2. Clones `physiodevapp/physiq` using `PHYSIQ_DEPLOY_TOKEN` secret
3. `rm -rf hub/kinematics && cp -r out/ hub/kinematics`
4. Commits and pushes to `physiq/main`, which triggers its own GitHub Pages deployment

The `PHYSIQ_DEPLOY_TOKEN` must be a GitHub PAT with `repo` scope stored as an Actions secret in this repository.

## Turbopack / @mediapipe mock

Next.js 16 uses Turbopack by default. TF.js imports `@mediapipe/pose` internally but the `tfjs` runtime does not need it. The alias prevents the import from failing at build time:

```ts
// next.config.ts
turbopack: {
  resolveAlias: {
    '@mediapipe/pose': './mocks/mediapipe-pose.js',
  },
}
```

`mocks/mediapipe-pose.js` exports an empty object.

## Commit format

```
git commit -m "short imperative title" -m "description when necessary"
```

- Title: max ~72 characters, imperative mood
- Body (`-m`): only when context is needed
- Never add co-authorship lines

## Branch workflow

All changes must be developed on a feature branch and merged via PR:

```
git checkout -b feat/<description>   # or fix/<description>
# make changes, build, verify
git push -u origin feat/<description>
# open PR → main
```

Never push directly to `main`.
