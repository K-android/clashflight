import type { GameContext, GameEvent, GameMode } from '@clashflight/core';

/**
 * Primary MVP game mode: find, inspect, and resolve coordination issues for a score.
 */
export class ClashHuntMode implements GameMode {
  readonly id = 'clash-hunt';
  readonly label = 'Clash Hunt';
  readonly description =
    'Fly to each glowing issue marker, inspect the clashing elements, and mark it resolved.';

  private ctx: GameContext | null = null;
  private winEmitted = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.winEmitted = false;
  }

  update(_dt: number): void {
    // Timer & proximity updates are orchestrated by GameRuntime/SessionManager
  }

  onEvent(e: GameEvent): void {
    if (!this.ctx) return;
    if (e.type === 'issue-resolved' && !this.winEmitted) {
      const placed = this.ctx.session.issues.filter((i) => i.position !== null);
      const allDone =
        placed.length > 0 &&
        placed.every((i) => this.ctx!.session.resolvedIssueIds.has(i.id));
      if (allDone) {
        this.winEmitted = true;
        this.ctx.session.completed = true;
        this.ctx.emit({
          type: 'win',
          elapsedSeconds: this.ctx.session.elapsedSeconds,
          score: this.ctx.session.score,
          timestamp: Date.now(),
        });
      }
    }
  }
}
