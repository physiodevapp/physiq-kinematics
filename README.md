# PhysiQ · Kinematics

**physiq-kinematics** is a PhysiQ satellite that measures joint angles in real time using the device camera and TensorFlow.js pose detection — no server, no external hardware required.

It runs embedded in the [PhysiQ hub](https://physiodevapp.github.io/physiq/) at `/physiq/kinematics/`.

---

## Features

- **Live camera feed** with skeleton overlay (keypoints + connections)
- **Real-time joint angles** for shoulders, elbows, hips and knees (bilateral)
- **MoveNet / BlazePose** model toggle — speed vs. accuracy trade-off
- **Pose orientation** detection: front, back, left, right, or auto-inferred
- **Angle smoothing** via configurable history buffer (5–20 frames)
- **Orthogonal reference line** for visual alignment
- **Camera flip** (front / rear camera)
- **Freeze frame** for manual angle reading
- **PhysiQ hub integration**: home navigation, modal close on satellite hide

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (Pages Router, static export) |
| Language | TypeScript 5 |
| Pose detection | TensorFlow.js · `@tensorflow-models/pose-detection` (MoveNet / BlazePose) |
| Bundler | Turbopack |
| Styling | Tailwind CSS v4 |
| Icons | Heroicons (outline) |
| Fonts | Outfit · DM Serif Display · DM Mono (Google Fonts) |
| Off-thread compute | Web Worker (`jointWorker.js`) |
| Deployment | GitHub Pages via CD pipeline → physiq hub |

---

## Architecture

The satellite is camera-first: the video fills the full viewport and all controls float as overlays. There is no fixed header to maximise the visible camera area.

```
Camera feed (react-webcam)
  └── Canvas overlay (keypoints + skeleton + angle labels)
        └── Web Worker (joint angle computation, atan2)

Providers:
  TensorFlow → PoseDetector → Settings
```

Pose detection runs on the WebGL backend entirely in the browser — no data leaves the device.

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000/physiq/kinematics](http://localhost:3000/physiq/kinematics) in a browser with camera access.

> Camera permission is required. On mobile, use HTTPS or localhost.

---

## Build & deploy

```bash
npm run build   # produces out/ (static export)
```

The CD pipeline (`.github/workflows/deploy-to-hub.yml`) runs automatically on push to `main`:

1. Builds the static export
2. Clones the `physiodevapp/physiq` hub repo
3. Copies `out/` into `hub/kinematics/`
4. Pushes to physiq, triggering GitHub Pages deployment

Requires a `PHYSIQ_DEPLOY_TOKEN` secret (GitHub PAT with `repo` scope).

---

## Clinical disclaimer

physiq-kinematics is an assistive orientation tool. Joint angle measurements have not been validated against gold-standard clinical goniometry. Results should be interpreted by a qualified physiotherapist.

---

## Author

**Edu Gamboa** · Full Stack Developer  
[GitHub](https://github.com/physiodevapp) · [LinkedIn](https://www.linkedin.com/in/edu-gamboa/)
