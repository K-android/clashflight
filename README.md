# ClashFlight

> **Fly through any BIM model (`.ifc`) in your browser and hunt down real coordination clashes (`.bcf` / `.bcfzip`) as in-game objectives.**

**Live Demo:** https://clashflight.vercel.app

ClashFlight turns BIM QA/QC and clash coordination into a fast, local-first 3D flight game. Drop an IFC building model and a BCF clash report onto the page — everything is parsed on-device inside a Web Worker, so **models never leave your machine**.

---

## Highlights

- **100% Local & Private**: Powered by [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) in a dedicated ES Web Worker with zero server uploads.
- **Real IFC + BCF Support**: Automatically normalizes units to metres, converts IFC Z-up to Three.js Y-up, shifts distant project coordinates near the origin, and places issue beacons by IFC GUID bounding-box centroid (falling back to BCF camera direction when needed).
- **Two Flight Crafts (`[P]`)**:
  - **Arcade Drone**: Nimble 6-DOF hover flight with precision speed tiers and instant braking.
  - **Micro Jet Plane**: Forward-cruise aerodynamics with wing banking, climb/dive pitch, and afterburner boost.
- **1st & 3rd Person Chase Camera (`[V]`)**: Switch between cockpit POV and a third-person chase view featuring animated procedural 3D Drone & Plane models and `three-mesh-bvh` raycast wall pull-in.
- **Sliding BVH Collision & Ghost Mode (`[G]`)**: Smooth sphere-vs-mesh surface sliding so you never snag on corners, plus Ghost Mode to slip straight through walls into sealed mechanical rooms.
- **X-Ray Translucency (`[X]`) & Element Highlights**: See clashing ductwork, pipes, beams, and walls right through architectural enclosures, with bounding-box highlights on the active issue.
- **Revit-Flavored Crash Humour (Serious Mode Toggle)**: Non-repeating BIM coordination jokes when you slam into a wall, clip a column, or clear every issue with zero warnings — with a **Serious Mode** toggle for client demos.

---

## Controls

| Key / Input | Action |
| :--- | :--- |
| **Left-click canvas** (or **Right-drag**) | Mouse look (Pointer Lock) |
| **W / A / S / D** or Arrow Keys | Fly / steer |
| **Space / E** | Ascend / Climb |
| **Ctrl / Q / C** | Descend / Dive |
| **Shift** | Boost / Afterburner |
| **1 / 2 / 3** | Speed tiers (`5` / `10` / `20 m/s` drone; `4.5` / `8.5` / `14.5 m/s` plane) |
| **P** | Toggle flight craft (**Arcade Drone** / **Micro Jet Plane**) |
| **V** | Toggle camera view (**1st Person** / **3rd Person Chase**) |
| **G** | Toggle Ghost Mode (fly through walls) |
| **X** | Toggle X-Ray translucency |
| **F** | Mark nearby inspected issue resolved |
| **T** | Warp to next unresolved issue |
| **R** | Respawn at building entrance |
| **H** | Open menu, file drop, FOV slider & Serious Mode |

---

## Architecture (Monorepo)

```text
clashflight/
├── packages/
│   ├── core/       # @clashflight/core — Pure TS domain contracts, normalization, GUID/camera resolver, scoring, jokes
│   ├── ingest/     # @clashflight/ingest — web-ifc Web Worker parser + fflate/fast-xml-parser BCF adapter
│   ├── engine/     # @clashflight/engine — Three.js scene, CraftVisual, Drone/Plane controller, MeshBVH collision, beacons
│   ├── game/       # @clashflight/game — EventBus, ClashHuntMode, FreeFlyMode, GameRuntime
│   └── app/        # @clashflight/app — Vite app, plain DOM HUD, drag-and-drop loader
├── samples/        # Self-contained test building (.ifc) + 6-issue clash pack (.bcfzip)
├── tools/          # Procedural IFC/BCF generator & web-ifc WASM asset copier
└── vercel.json     # Static Vite deployment config with WASM MIME/cache headers
```

`@clashflight/core` has **zero DOM and zero Three.js dependencies**, allowing scoring rules, coordinate normalization, joke rotation, and BCF issue resolution to be unit-tested directly in Node.

---

## Local Development

```bash
npm install
npm run generate:samples
npm run dev
```

Open `http://localhost:5173` and click **Load Sample Building & Clashes (Instant Demo)**, or drag and drop any `.ifc` and `.bcf` / `.bcfzip` files onto the window.

### Testing & Typechecking

```bash
npm test         # Vitest unit tests + real web-ifc/BCF integration test
npm run typecheck
npm run build    # Copies web-ifc WASM assets and builds packages/app/dist
```

---

## Deploying to Vercel

This repo includes [`vercel.json`](vercel.json) configured for the monorepo build (`npm run generate:samples && npm run build` -> `packages/app/dist`):

```bash
vercel --prod
```
