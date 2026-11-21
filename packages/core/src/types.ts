export type Vec3 = [number, number, number];

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export type ElementKey = string;

export interface MeshRange {
  groupIndex: number;
  indexStart: number;
  indexCount: number;
}

export interface ElementInfo {
  key: ElementKey;
  ifcGuid?: string;
  ifcClass: string;
  name?: string;
  level?: string;
  discipline?: string;
  bounds: Bounds3;
  meshRanges: MeshRange[];
}

export interface ModelIndex {
  schemaVersion: 1;
  id: string;
  source: 'ifc' | 'gltf';
  units: 'm';
  originShift: Vec3;
  bounds: Bounds3;
  elements: Map<ElementKey, ElementInfo>;
}

export interface CameraView {
  position: Vec3;
  direction: Vec3;
  up: Vec3;
}

export type IssueSourceKind = 'bcf' | 'healthcheck' | 'clash-report';
export type IssueStatus = 'open' | 'in-progress' | 'resolved' | 'closed';

export interface Issue {
  schemaVersion: 1;
  id: string;
  source: IssueSourceKind;
  title: string;
  description?: string;
  status: IssueStatus;
  priority?: string;
  discipline?: string;
  elementKeys: ElementKey[];
  position: Vec3 | null;
  camera?: CameraView;
  meta: Record<string, unknown>;
}

export interface IssueDraft {
  id: string;
  source: IssueSourceKind;
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: string;
  discipline?: string;
  ifcGuids: string[];
  cameraIfcZUp?: CameraView;
  meta?: Record<string, unknown>;
}

export interface IssueResolveStats {
  total: number;
  matchedByGuid: number;
  fallbackByCamera: number;
  unplaced: number;
}

export interface IssueResolveResult {
  issues: Issue[];
  stats: IssueResolveStats;
}

export interface IssueFileInput {
  readonly name: string;
  readonly size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface IssueSource {
  id: string;
  accepts(file: IssueFileInput): boolean;
  load(file: IssueFileInput, model: ModelIndex): Promise<Issue[]>;
}

export type GameEvent =
  | { type: 'issue-found'; issueId: string; timestamp: number }
  | { type: 'issue-inspected'; issueId: string; timestamp: number }
  | { type: 'issue-resolved'; issueId: string; issue: Issue; timestamp: number }
  | {
      type: 'collision';
      speed: number;
      ifcClass?: string;
      elementName?: string;
      timestamp: number;
    }
  | { type: 'fall'; timestamp: number }
  | { type: 'timeout'; timestamp: number }
  | { type: 'load-error'; reason?: string; timestamp: number }
  | { type: 'win'; elapsedSeconds: number; score: number; timestamp: number };

export interface SessionState {
  schemaVersion: 1;
  modeId: string;
  score: number;
  streak: number;
  foundIssueIds: Set<string>;
  inspectedIssueIds: Set<string>;
  resolvedIssueIds: Set<string>;
  crashCount: number;
  elapsedSeconds: number;
  timeLimitSeconds: number | null;
  issues: Issue[];
  completed: boolean;
}

export interface GameContext {
  session: SessionState;
  emit(event: GameEvent): void;
}

export interface GameMode {
  id: string;
  label: string;
  description: string;
  init(ctx: GameContext): void;
  update(dt: number): void;
  onEvent(e: GameEvent): void;
}

export interface ScoreRule {
  id: string;
  apply(event: GameEvent, state: SessionState): number;
}

export type JokeEventType =
  | 'collision'
  | 'fall'
  | 'timeout'
  | 'load-error'
  | 'win';

export interface JokeEntry {
  id: string;
  event: JokeEventType;
  text: string;
  ifcClassMatch?: string[];
}

export interface JokePack {
  schemaVersion: 1;
  id: string;
  jokes: JokeEntry[];
}
