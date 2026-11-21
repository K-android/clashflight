import './styles.css';
import * as THREE from 'three';
import type { ModelIndex } from '@clashflight/core';
import {
  BcfIssueSource,
  loadIfcFileInWorker,
} from '@clashflight/ingest';
import {
  CraftVisual,
  DroneController,
  IssueMarkerManager,
  SceneManager,
} from '@clashflight/engine';
import { GameRuntime } from '@clashflight/game';
import { HudController } from './hud';

const viewport = document.getElementById('viewport')!;
const hudRoot = document.getElementById('hud-root')!;

const sceneManager = new SceneManager(viewport);
const drone = new DroneController(sceneManager.camera, sceneManager.domElement);
const craftVisual = new CraftVisual();
sceneManager.scene.add(craftVisual.root);
const markers = new IssueMarkerManager(sceneManager.markersGroup);
const runtime = new GameRuntime();
const bcfSource = new BcfIssueSource();

let currentModel: ModelIndex | null = null;
let xrayMode = false;
let lastInspectableId: string | null = null;

const hud = new HudController(hudRoot, {
  onLoadSample: () => void loadSampleDemo(),
  onFilesSelected: (files) => void handleDroppedFiles(files),
  onModeChange: (modeId) => {
    runtime.setMode(modeId);
    syncMarkersAndMission();
  },
  onQualityChange: (preset) => sceneManager.setQuality(preset),
  onCraftChange: (type) => drone.setCraftType(type),
  onToggleCraft: () => drone.toggleCraftType(),
  onToggleCameraView: () => drone.toggleCameraView(),
  onToggleGhost: () => drone.toggleGhostMode(),
  onToggleXray: () => toggleXray(),
  onToggleSeriousMode: () => {
    runtime.jokes.seriousMode = !runtime.jokes.seriousMode;
    hud.setSeriousMode(runtime.jokes.seriousMode);
  },
  onResolveActive: () => resolveCurrentIssue(),
  onWarpNext: () => warpToNextIssue(),
  onRespawn: () => respawnAtEntrance(),
  onFovChange: (fov) => sceneManager.setFov(fov),
  onResumeFlight: () => drone.requestPointerLock(),
});

runtime.onJoke = ({ event, joke }) => {
  const tag =
    event === 'win'
      ? 'Zero Warnings!'
      : event === 'fall'
      ? 'Base Constraint Warning'
      : event === 'load-error'
      ? 'IFC Export Warning'
      : 'Revit Coordination Notice';
  hud.showToast(tag, joke.text, event === 'win' ? 'win' : 'warning', 4500);
};

drone.onCollision = ({ speed, expressId }) => {
  const el =
    expressId !== undefined
      ? sceneManager.getElementByExpressId(expressId)
      : undefined;
  runtime.recordCollision(speed, el?.ifcClass, el?.name);
};

drone.onFall = () => {
  runtime.recordFall();
};

function toggleXray(): void {
  xrayMode = !xrayMode;
  sceneManager.setXrayMode(xrayMode);
  hud.setXrayEnabled(xrayMode);
}

function respawnAtEntrance(): void {
  const spawn = sceneManager.getSafeSpawnPoint();
  drone.setSpawn(spawn.position, spawn.lookAt);
}

function resolveCurrentIssue(): void {
  const result = runtime.resolveActiveIssue();
  if (result.resolved && result.issue) {
    markers.updateIssueVisual(
      result.issue,
      runtime.session.state.inspectedIssueIds.has(result.issue.id)
    );
    sceneManager.highlightIssue(null);
    lastInspectableId = null;
    hud.updateInspectableIssue(null, currentModel);
    if (runtime.jokes.seriousMode && runtime.session.isAllPlacedResolved()) {
      hud.showToast(
        'Session Complete',
        `All placed issues resolved! Final score: ${runtime.session.state.score} pts`,
        'win',
        5000
      );
    }
  }
}

function warpToNextIssue(): void {
  const next = runtime.session
    .getPlacedIssues()
    .find((i) => !runtime.session.state.resolvedIssueIds.has(i.id));
  if (!next || !next.position) return;

  const target = new THREE.Vector3(
    next.position[0],
    next.position[1],
    next.position[2]
  );
  const offset = new THREE.Vector3(0, 0.4, 3.2);
  const camPos = target.clone().add(offset);
  drone.teleportTo(camPos, target);
}

function syncMarkersAndMission(): void {
  markers.setIssues(
    runtime.session.state.issues,
    runtime.session.state.inspectedIssueIds
  );
  sceneManager.highlightIssue(null);
  lastInspectableId = null;
}

async function loadIfcBlob(
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<void> {
  hud.setStatus(`Parsing ${file.name} in Web Worker...`);
  try {
    const result = await loadIfcFileInWorker(file, {
      onProgress: (msg) => hud.setStatus(msg),
    });
    currentModel = result.modelIndex;
    sceneManager.loadModel(result.modelIndex, result.meshGroups);
    const spawn = sceneManager.getSafeSpawnPoint();
    drone.setSpawn(spawn.position, spawn.lookAt);
    hud.markModelLoaded();
    hud.setStatus(
      `Loaded ${file.name} (${result.stats.elementCount} elements, ${result.stats.triangleCount.toLocaleString()} tris).`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hud.setStatus(`Load failed: ${msg}`);
    runtime.recordLoadError(msg);
    throw err;
  }
}

async function loadIssueFile(file: File): Promise<void> {
  if (!currentModel) {
    hud.setStatus('Load an .ifc model first, then drop the .bcfzip file.');
    return;
  }
  if (!bcfSource.accepts(file)) {
    hud.setStatus(`Unsupported issue file: ${file.name}`);
    return;
  }

  const res = await bcfSource.loadWithStats(file, currentModel);
  runtime.loadIssues(res.issues);
  syncMarkersAndMission();
  hud.setStatus(
    `Loaded ${res.stats.total} issues (${res.stats.matchedByGuid} by GUID, ${res.stats.fallbackByCamera} by camera, ${res.stats.unplaced} unplaced).`
  );
}

async function handleDroppedFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  const ifcFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ifc'));
  const issueFiles = files.filter((f) => bcfSource.accepts(f));

  if (ifcFiles.length === 0 && issueFiles.length === 0) {
    hud.setStatus('Please drop a .ifc model or .bcf / .bcfzip issue file.');
    return;
  }

  for (const ifc of ifcFiles) {
    await loadIfcBlob(ifc);
  }
  for (const bcf of issueFiles) {
    await loadIssueFile(bcf);
  }

  if (currentModel) {
    hud.hideMenu();
  }
}

async function loadSampleDemo(): Promise<void> {
  try {
    hud.setStatus('Fetching sample building & BCF issues...');
    const [ifcResp, bcfResp] = await Promise.all([
      fetch('/samples/clashflight-sample.ifc'),
      fetch('/samples/clashflight-sample.bcfzip'),
    ]);
    if (!ifcResp.ok || !bcfResp.ok) {
      throw new Error('Sample assets could not be fetched from /samples/.');
    }
    const [ifcBuf, bcfBuf] = await Promise.all([
      ifcResp.arrayBuffer(),
      bcfResp.arrayBuffer(),
    ]);

    const ifcFile = new File([ifcBuf], 'clashflight-sample.ifc');
    const bcfFile = new File([bcfBuf], 'clashflight-sample.bcfzip');

    await loadIfcBlob(ifcFile);
    await loadIssueFile(bcfFile);
    hud.hideMenu();
    drone.requestPointerLock();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hud.setStatus(`Error: ${msg}`);
    runtime.recordLoadError(msg);
  }
}

// Drag & Drop handlers on window
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter += 1;
  hud.setDragVisible(true);
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) hud.setDragVisible(false);
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  hud.setDragVisible(false);
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    void handleDroppedFiles(e.dataTransfer.files);
  }
});

// Global hotkeys
window.addEventListener('keydown', (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (e.code === 'KeyF' && !e.repeat) {
    resolveCurrentIssue();
  } else if (e.code === 'KeyX' && !e.repeat) {
    toggleXray();
  } else if (e.code === 'KeyH' && !e.repeat) {
    hud.toggleMenu();
  } else if (e.code === 'KeyT' && !e.repeat) {
    warpToNextIssue();
  } else if (e.code === 'KeyR' && !e.repeat) {
    respawnAtEntrance();
  }
});

window.addEventListener('resize', () => sceneManager.resize());

// Main game + render loop
let lastTime = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let currentFps = 60;

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  fpsAccum += dt;
  fpsFrames += 1;
  if (fpsAccum >= 0.4) {
    currentFps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  if (!hud.isMenuVisible()) {
    drone.update(
      dt,
      sceneManager.getCollisionData(),
      currentModel?.bounds ?? null
    );
    runtime.update(dt);
  }

  const craftState = drone.getCraftState();
  craftVisual.setCraftType(craftState.craftType);
  craftVisual.setVisible(craftState.cameraView === 'third-person');
  if (craftState.cameraView === 'third-person') {
    craftVisual.update(dt, craftState);
  }

  const markerState = markers.update(
    dt,
    sceneManager.camera,
    5.5,
    drone.position
  );
  const inspectIssue = markerState.inspectableIssue;

  if ((inspectIssue?.id ?? null) !== lastInspectableId) {
    lastInspectableId = inspectIssue?.id ?? null;
    const { newlyInspected } = runtime.setNearbyIssue(inspectIssue);
    if (newlyInspected && inspectIssue) {
      markers.updateIssueVisual(inspectIssue, true);
    }
    sceneManager.highlightIssue(inspectIssue);
    hud.updateInspectableIssue(inspectIssue, currentModel);
  }

  hud.updateTelemetry(drone.getTelemetry(), currentFps);
  hud.updateCompass(markerState, runtime.session.state.issues.length > 0);
  hud.updateMission({
    score: runtime.session.state.score,
    resolvedCount: runtime.session.state.resolvedIssueIds.size,
    placedCount: runtime.session.getPlacedIssues().length,
    elapsedSeconds: runtime.session.state.elapsedSeconds,
    crashCount: runtime.session.state.crashCount,
    unplacedIssues: runtime.session.getUnplacedIssues(),
  });

  sceneManager.render();
}

requestAnimationFrame(animate);
