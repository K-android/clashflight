import type { GameEvent } from '@clashflight/core';

export type GameEventHandler<T extends GameEvent = GameEvent> = (event: T) => void;

/**
 * Lightweight typed event bus connecting engine events, game modes, scoring, and HUD.
 */
export class EventBus {
  private readonly anyListeners = new Set<GameEventHandler>();
  private readonly typedListeners = new Map<
    GameEvent['type'],
    Set<GameEventHandler<any>>
  >();

  on<T extends GameEvent['type']>(
    type: T,
    handler: GameEventHandler<Extract<GameEvent, { type: T }>>
  ): () => void {
    let set = this.typedListeners.get(type);
    if (!set) {
      set = new Set();
      this.typedListeners.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  onAny(handler: GameEventHandler): () => void {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  emit(event: GameEvent): void {
    const specific = this.typedListeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        listener(event);
      }
    }
    for (const listener of this.anyListeners) {
      listener(event);
    }
  }

  clear(): void {
    this.anyListeners.clear();
    this.typedListeners.clear();
  }
}
