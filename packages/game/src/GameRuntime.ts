import {
  JokeRotator,
  SessionManager,
  type GameEvent,
  type GameMode,
  type Issue,
  type JokeEntry,
} from '@clashflight/core';
import { EventBus } from './EventBus';
import { ClashHuntMode } from './modes/ClashHuntMode';
import { FreeFlyMode } from './modes/FreeFlyMode';

export interface JokeNotification {
  event: GameEvent['type'];
  joke: JokeEntry;
}

/**
 * Coordinates the active GameMode, SessionManager, EventBus, and Revit crash JokeRotator.
 */
export class GameRuntime {
  readonly bus = new EventBus();
  readonly jokes = new JokeRotator();
  readonly modes: GameMode[] = [new ClashHuntMode(), new FreeFlyMode()];

  session: SessionManager;
  activeMode: GameMode;
  activeInspectableIssue: Issue | null = null;

  onJoke?: (notification: JokeNotification) => void;

  constructor() {
    this.activeMode = this.modes[0];
    this.session = new SessionManager({ modeId: this.activeMode.id });
    this.initMode(this.activeMode);
  }

  private initMode(mode: GameMode): void {
    this.activeMode = mode;
    this.session.state.modeId = mode.id;
    mode.init({
      session: this.session.state,
      emit: (event) => this.dispatch(event),
    });
  }

  setMode(modeId: string): void {
    const found = this.modes.find((m) => m.id === modeId);
    if (!found) return;
    this.session = new SessionManager({
      modeId: found.id,
      issues: this.session.state.issues,
    });
    this.initMode(found);
  }

  loadIssues(issues: Issue[]): void {
    this.session = new SessionManager({
      modeId: this.activeMode.id,
      issues,
    });
    this.activeInspectableIssue = null;
    this.initMode(this.activeMode);
  }

  update(dt: number): void {
    if (this.activeMode.id === 'clash-hunt' && this.session.state.issues.length > 0) {
      const timedOut = this.session.tick(dt);
      if (timedOut) {
        this.dispatch({ type: 'timeout', timestamp: Date.now() });
      }
    }
    this.activeMode.update(dt);
  }

  setNearbyIssue(issue: Issue | null): { newlyInspected: boolean } {
    this.activeInspectableIssue = issue;
    if (!issue) {
      return { newlyInspected: false };
    }
    const newlyFound = this.session.markFound(issue.id);
    if (newlyFound) {
      this.dispatch({
        type: 'issue-found',
        issueId: issue.id,
        timestamp: Date.now(),
      });
    }
    const newlyInspected = this.session.inspectIssue(issue.id);
    if (newlyInspected) {
      this.dispatch({
        type: 'issue-inspected',
        issueId: issue.id,
        timestamp: Date.now(),
      });
    }
    return { newlyInspected };
  }

  resolveActiveIssue(): { resolved: boolean; pointsAwarded: number; issue?: Issue } {
    if (!this.activeInspectableIssue) {
      return { resolved: false, pointsAwarded: 0 };
    }
    const res = this.session.resolveIssue(this.activeInspectableIssue.id);
    if (res.resolved && res.issue) {
      this.dispatch({
        type: 'issue-resolved',
        issueId: res.issue.id,
        issue: res.issue,
        timestamp: Date.now(),
      });
    }
    return res;
  }

  recordCollision(speed: number, ifcClass?: string, elementName?: string): void {
    this.session.recordCrash();
    this.dispatch({
      type: 'collision',
      speed,
      ifcClass,
      elementName,
      timestamp: Date.now(),
    });
  }

  recordFall(): void {
    this.session.recordCrash();
    this.dispatch({
      type: 'fall',
      timestamp: Date.now(),
    });
  }

  recordLoadError(reason?: string): void {
    this.dispatch({
      type: 'load-error',
      reason,
      timestamp: Date.now(),
    });
  }

  private dispatch(event: GameEvent): void {
    this.activeMode.onEvent(event);
    this.bus.emit(event);

    if (
      event.type === 'collision' ||
      event.type === 'fall' ||
      event.type === 'timeout' ||
      event.type === 'load-error' ||
      event.type === 'win'
    ) {
      const joke = this.jokes.nextJoke(
        event.type,
        event.type === 'collision' ? event.ifcClass : undefined
      );
      if (joke) {
        this.onJoke?.({ event: event.type, joke });
      }
    }
  }
}
