import {
  applyOriginShift,
  boundsCenter,
  createEmptyBounds,
  expandBoundsByBounds,
  ifcZUpToThreeYUp,
  normalizeVec3,
} from './normalize';
import type {
  CameraView,
  ElementInfo,
  ElementKey,
  Issue,
  IssueDraft,
  IssueResolveResult,
  ModelIndex,
  Vec3,
} from './types';

const CAMERA_FALLBACK_OFFSET_METERS = 2.5;

function convertCameraIfcToScene(
  camera: CameraView,
  originShift: Vec3
): CameraView {
  const posYUp = applyOriginShift(
    ifcZUpToThreeYUp(camera.position),
    originShift
  );
  const dirYUp = normalizeVec3(ifcZUpToThreeYUp(camera.direction));
  const upYUp = normalizeVec3(ifcZUpToThreeYUp(camera.up));
  return {
    position: posYUp,
    direction: dirYUp,
    up: upYUp,
  };
}

/**
 * Resolves pre-normalized IssueDraft items against a normalized ModelIndex.
 * Primary placement uses the combined bounding-box center of matched IFC GUID elements.
 * Fallback placement places a marker 2.5 m along the BCF camera direction.
 * Unresolvable issues receive position: null so the UI can list them separately.
 */
export function resolveIssues(
  drafts: IssueDraft[],
  model: ModelIndex
): IssueResolveResult {
  const byGuid = new Map<string, ElementInfo>();
  for (const el of model.elements.values()) {
    if (el.ifcGuid) {
      byGuid.set(el.ifcGuid, el);
    }
  }

  let matchedByGuid = 0;
  let fallbackByCamera = 0;
  let unplaced = 0;

  const issues: Issue[] = drafts.map((draft) => {
    const elementKeys: ElementKey[] = [];
    const combinedBounds = createEmptyBounds();
    let inferredDiscipline = draft.discipline;

    for (const guid of draft.ifcGuids) {
      const el = byGuid.get(guid);
      if (el) {
        elementKeys.push(el.key);
        expandBoundsByBounds(combinedBounds, el.bounds);
        if (!inferredDiscipline && el.discipline) {
          inferredDiscipline = el.discipline;
        }
      }
    }

    const sceneCamera = draft.cameraIfcZUp
      ? convertCameraIfcToScene(draft.cameraIfcZUp, model.originShift)
      : undefined;

    let position: Vec3 | null = boundsCenter(combinedBounds);
    let placementMode: 'guid' | 'camera-fallback' | 'unplaced' = 'unplaced';

    if (position !== null) {
      matchedByGuid += 1;
      placementMode = 'guid';
    } else if (sceneCamera) {
      position = [
        sceneCamera.position[0] +
          sceneCamera.direction[0] * CAMERA_FALLBACK_OFFSET_METERS,
        sceneCamera.position[1] +
          sceneCamera.direction[1] * CAMERA_FALLBACK_OFFSET_METERS,
        sceneCamera.position[2] +
          sceneCamera.direction[2] * CAMERA_FALLBACK_OFFSET_METERS,
      ];
      fallbackByCamera += 1;
      placementMode = 'camera-fallback';
    } else {
      unplaced += 1;
    }

    return {
      schemaVersion: 1,
      id: draft.id,
      source: draft.source,
      title: draft.title,
      description: draft.description,
      status: draft.status ?? 'open',
      priority: draft.priority,
      discipline: inferredDiscipline,
      elementKeys,
      position,
      camera: sceneCamera,
      meta: {
        ...draft.meta,
        requestedGuids: draft.ifcGuids,
        matchedElementCount: elementKeys.length,
        placementMode,
      },
    };
  });

  return {
    issues,
    stats: {
      total: drafts.length,
      matchedByGuid,
      fallbackByCamera,
      unplaced,
    },
  };
}
