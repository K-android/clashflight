import type { GameContext, GameEvent, GameMode } from '@clashflight/core';

/**
 * Unpressured exploration mode for walking/flying through a building model without timers.
 */
export class FreeFlyMode implements GameMode {
  readonly id = 'free-fly';
  readonly label = 'Free Fly';
  readonly description =
    'Explore the building geometry freely with no objectives or timer pressure.';

  init(_ctx: GameContext): void {}

  update(_dt: number): void {}

  onEvent(_e: GameEvent): void {}
}
