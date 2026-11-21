import type {
  GameEvent,
  Issue,
  ScoreRule,
  SessionState,
} from './types';

const PRIORITY_POINTS: Record<string, number> = {
  critical: 300,
  high: 250,
  major: 250,
  medium: 150,
  normal: 150,
  minor: 100,
  low: 100,
};

/**
 * Default P1 scoring rule: awards points by issue priority/severity plus a modest
 * consecutive resolution streak bonus, enforcing inspection before resolution.
 */
export class SeverityScoreRule implements ScoreRule {
  readonly id = 'severity-v1';

  apply(event: GameEvent, state: SessionState): number {
    if (event.type !== 'issue-resolved') {
      return 0;
    }
    // Fairness rule (Section 8): no points for resolving an uninspected issue.
    if (!state.inspectedIssueIds.has(event.issueId)) {
      return 0;
    }
    const key = (event.issue.priority ?? 'normal').trim().toLowerCase();
    const base = PRIORITY_POINTS[key] ?? 150;
    const streakBonus = Math.min(state.streak, 5) * 25;
    return base + streakBonus;
  }
}

export interface SessionConfig {
  modeId?: string;
  timeLimitSeconds?: number | null;
  issues?: Issue[];
  scoreRules?: ScoreRule[];
}

/**
 * Pure TypeScript session state manager tracking issue discovery, inspection,
 * resolution, scoring, crash count, and elapsed time.
 */
export class SessionManager {
  readonly state: SessionState;
  private readonly scoreRules: ScoreRule[];

  constructor(config: SessionConfig = {}) {
    this.scoreRules = config.scoreRules ?? [new SeverityScoreRule()];
    this.state = {
      schemaVersion: 1,
      modeId: config.modeId ?? 'clash-hunt',
      score: 0,
      streak: 0,
      foundIssueIds: new Set<string>(),
      inspectedIssueIds: new Set<string>(),
      resolvedIssueIds: new Set<string>(),
      crashCount: 0,
      elapsedSeconds: 0,
      timeLimitSeconds: config.timeLimitSeconds ?? null,
      issues: (config.issues ?? []).map((issue) => ({ ...issue })),
      completed: false,
    };

    for (const issue of this.state.issues) {
      if (issue.status === 'resolved' || issue.status === 'closed') {
        this.state.resolvedIssueIds.add(issue.id);
      }
    }
  }

  setIssues(issues: Issue[]): void {
    this.state.issues = issues.map((issue) => ({ ...issue }));
    this.state.foundIssueIds.clear();
    this.state.inspectedIssueIds.clear();
    this.state.resolvedIssueIds.clear();
    this.state.score = 0;
    this.state.streak = 0;
    this.state.completed = false;

    for (const issue of this.state.issues) {
      if (issue.status === 'resolved' || issue.status === 'closed') {
        this.state.resolvedIssueIds.add(issue.id);
      }
    }
  }

  markFound(issueId: string): boolean {
    if (this.state.foundIssueIds.has(issueId)) {
      return false;
    }
    const issue = this.getIssue(issueId);
    if (!issue) return false;
    this.state.foundIssueIds.add(issueId);
    return true;
  }

  inspectIssue(issueId: string): boolean {
    const issue = this.getIssue(issueId);
    if (!issue) return false;
    this.state.foundIssueIds.add(issueId);
    const newlyInspected = !this.state.inspectedIssueIds.has(issueId);
    this.state.inspectedIssueIds.add(issueId);
    return newlyInspected;
  }

  /**
   * Marks an issue as resolved locally and awards points if and only if
   * the player inspected it first.
   */
  resolveIssue(
    issueId: string,
    timestamp = Date.now()
  ): { resolved: boolean; pointsAwarded: number; issue?: Issue } {
    const issue = this.getIssue(issueId);
    if (!issue) {
      return { resolved: false, pointsAwarded: 0 };
    }
    if (this.state.resolvedIssueIds.has(issueId)) {
      return { resolved: false, pointsAwarded: 0, issue };
    }
    if (!this.state.inspectedIssueIds.has(issueId)) {
      return { resolved: false, pointsAwarded: 0, issue };
    }

    issue.status = 'resolved';
    this.state.resolvedIssueIds.add(issueId);

    const event: GameEvent = {
      type: 'issue-resolved',
      issueId,
      issue,
      timestamp,
    };

    let pointsAwarded = 0;
    for (const rule of this.scoreRules) {
      pointsAwarded += rule.apply(event, this.state);
    }

    this.state.score += pointsAwarded;
    this.state.streak += 1;
    this.checkCompletion();

    return { resolved: true, pointsAwarded, issue };
  }

  recordCrash(): void {
    this.state.crashCount += 1;
    this.state.streak = 0;
  }

  tick(dt: number): boolean {
    if (this.state.completed) return false;
    this.state.elapsedSeconds += dt;
    if (
      this.state.timeLimitSeconds !== null &&
      this.state.elapsedSeconds >= this.state.timeLimitSeconds
    ) {
      this.state.completed = true;
      return true;
    }
    return false;
  }

  getPlacedIssues(): Issue[] {
    return this.state.issues.filter((issue) => issue.position !== null);
  }

  getUnplacedIssues(): Issue[] {
    return this.state.issues.filter((issue) => issue.position === null);
  }

  isAllPlacedResolved(): boolean {
    const placed = this.getPlacedIssues();
    return (
      placed.length > 0 &&
      placed.every((issue) => this.state.resolvedIssueIds.has(issue.id))
    );
  }

  private getIssue(issueId: string): Issue | undefined {
    return this.state.issues.find((i) => i.id === issueId);
  }

  private checkCompletion(): void {
    if (this.isAllPlacedResolved()) {
      this.state.completed = true;
    }
  }
}
