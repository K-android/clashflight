import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import {
  resolveIssues,
  type CameraView,
  type Issue,
  type IssueDraft,
  type IssueFileInput,
  type IssueResolveResult,
  type IssueSource,
  type IssueStatus,
  type ModelIndex,
  type Vec3,
} from '@clashflight/core';

const ARRAY_TAGS = new Set(['Viewpoints', 'Component', 'Comments']);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
  trimValues: true,
});

function parseStatus(raw?: string): IssueStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'closed') return 'closed';
  if (s === 'resolved' || s === 'done') return 'resolved';
  if (s === 'in-progress' || s === 'in progress' || s === 'assigned') {
    return 'in-progress';
  }
  return 'open';
}

function readVec3(node: any): Vec3 | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const x = Number(node.X);
  const y = Number(node.Y);
  const z = Number(node.Z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return undefined;
  }
  return [x, y, z];
}

function parseCamera(vizInfo: any): CameraView | undefined {
  const camNode = vizInfo?.PerspectiveCamera ?? vizInfo?.OrthogonalCamera;
  if (!camNode) return undefined;

  const position = readVec3(camNode.CameraViewPoint);
  const direction = readVec3(camNode.CameraDirection);
  const up = readVec3(camNode.CameraUpVector) ?? [0, 0, 1];
  if (!position || !direction) return undefined;

  return { position, direction, up };
}

function findEntryCaseInsensitive(
  files: Record<string, Uint8Array>,
  targetPath: string
): Uint8Array | undefined {
  const direct = files[targetPath];
  if (direct) return direct;
  const lower = targetPath.toLowerCase();
  for (const [k, v] of Object.entries(files)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Parses a BCF (.bcf or .bcfzip) archive buffer and resolves every topic against
 * the given ModelIndex (GUID centroid first, camera ray fallback second).
 */
export function parseBcfBuffer(
  buffer: Uint8Array,
  model: ModelIndex
): IssueResolveResult {
  const files = unzipSync(buffer);
  const drafts: IssueDraft[] = [];

  const markupPaths = Object.keys(files)
    .filter((entry) => /(?:^|\/)markup\.bcf$/i.test(entry))
    .sort();

  for (const markupPath of markupPaths) {
    const markupXml = strFromU8(files[markupPath]);
    const parsed = xmlParser.parse(markupXml);
    const markup = parsed?.Markup;
    const topic = markup?.Topic;
    if (!topic) continue;

    const topicFolder = markupPath.includes('/')
      ? markupPath.slice(0, markupPath.lastIndexOf('/'))
      : '';
    const folderName = topicFolder.includes('/')
      ? topicFolder.slice(topicFolder.lastIndexOf('/') + 1)
      : topicFolder;

    const id = String(topic['@_Guid'] ?? (folderName || `bcf-${drafts.length + 1}`));
    const title = String(topic.Title ?? `Issue ${id}`);
    const description =
      typeof topic.Description === 'string' && topic.Description.length > 0
        ? topic.Description
        : undefined;
    const priority =
      typeof topic.Priority === 'string' && topic.Priority.length > 0
        ? topic.Priority
        : undefined;
    const status = parseStatus(topic['@_TopicStatus']);

    const ifcGuids = new Set<string>();
    let cameraIfcZUp: CameraView | undefined;

    const viewpointsList: any[] = Array.isArray(markup.Viewpoints)
      ? markup.Viewpoints
      : [];

    // Locate candidate .bcfv files referenced by Viewpoints, or any .bcfv in folder
    const vpPaths: string[] = [];
    for (const vp of viewpointsList) {
      if (typeof vp?.Viewpoint === 'string' && vp.Viewpoint.trim()) {
        const rel = vp.Viewpoint.trim().replace(/^\.?\//, '');
        vpPaths.push(topicFolder ? `${topicFolder}/${rel}` : rel);
      }
    }
    if (vpPaths.length === 0) {
      const prefix = topicFolder ? `${topicFolder}/` : '';
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix) && key.toLowerCase().endsWith('.bcfv')) {
          vpPaths.push(key);
        }
      }
    }

    for (const vpPath of vpPaths) {
      const vpBytes = findEntryCaseInsensitive(files, vpPath);
      if (!vpBytes) continue;
      const vpParsed = xmlParser.parse(strFromU8(vpBytes));
      const vizInfo = vpParsed?.VisualizationInfo;
      if (!vizInfo) continue;

      if (!cameraIfcZUp) {
        cameraIfcZUp = parseCamera(vizInfo);
      }

      const comps = vizInfo?.Components?.Selection?.Component;
      if (Array.isArray(comps)) {
        for (const comp of comps) {
          const guid = comp?.['@_IfcGuid'];
          if (typeof guid === 'string' && guid.trim()) {
            ifcGuids.add(guid.trim());
          }
        }
      }
    }

    drafts.push({
      id,
      source: 'bcf',
      title,
      description,
      status,
      priority,
      ifcGuids: Array.from(ifcGuids),
      cameraIfcZUp,
      meta: {
        topicType: topic['@_TopicType'],
        author: topic.CreationAuthor,
        creationDate: topic.CreationDate,
      },
    });
  }

  return resolveIssues(drafts, model);
}

/**
 * BCF IssueSource plugin adapter (Section 7.8).
 */
export class BcfIssueSource implements IssueSource {
  readonly id = 'bcf';

  accepts(file: IssueFileInput): boolean {
    const lower = file.name.toLowerCase();
    return lower.endsWith('.bcfzip') || lower.endsWith('.bcf');
  }

  async load(file: IssueFileInput, model: ModelIndex): Promise<Issue[]> {
    const res = await this.loadWithStats(file, model);
    return res.issues;
  }

  async loadWithStats(
    file: IssueFileInput,
    model: ModelIndex
  ): Promise<IssueResolveResult> {
    const buf = new Uint8Array(await file.arrayBuffer());
    return parseBcfBuffer(buf, model);
  }
}
