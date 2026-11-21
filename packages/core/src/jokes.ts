import type { JokeEntry, JokeEventType, JokePack } from './types';

export const STARTER_JOKE_PACK: JokePack = {
  schemaVersion: 1,
  id: 'revit-starter-v1',
  jokes: [
    {
      id: 'wall-warning',
      event: 'collision',
      ifcClassMatch: ['IfcWall', 'IfcWallStandardCase', 'IfcWallElementedCase'],
      text: 'Crash detected. Revit would have called this a warning and carried on.',
    },
    {
      id: 'wall-which-one',
      event: 'collision',
      ifcClassMatch: ['IfcWall', 'IfcWallStandardCase', 'IfcWallElementedCase'],
      text: 'You hit a wall. Unlike Revit, we told you which one.',
    },
    {
      id: 'wall-fire-rating',
      event: 'collision',
      ifcClassMatch: ['IfcWall', 'IfcWallStandardCase', 'IfcWallElementedCase'],
      text: 'The wall has no fire rating either. Do not feel bad.',
    },
    {
      id: 'wall-off-axis',
      event: 'collision',
      ifcClassMatch: ['IfcWall', 'IfcWallStandardCase', 'IfcWallElementedCase'],
      text: 'Highlighted pilot is slightly off axis and may produce inaccurate results.',
    },
    {
      id: 'column-join',
      event: 'collision',
      ifcClassMatch: ['IfcColumn'],
      text: 'Join Geometry failed. So did you.',
    },
    {
      id: 'any-ctrl-z',
      event: 'collision',
      text: 'This crash cannot be undone with Ctrl+Z.',
    },
    {
      id: 'any-warnings-count',
      event: 'collision',
      text: 'Crash number 4,872. Also the number of warnings in this model.',
    },
    {
      id: 'any-detached',
      event: 'collision',
      text: 'Your pilot is now detached from central. Please save as a new local pilot.',
    },
    {
      id: 'any-sync-central',
      event: 'collision',
      text: 'Sync with Central: 47 minutes remaining. Respawning in 3 seconds instead.',
    },
    {
      id: 'any-owned-element',
      event: 'collision',
      text: 'Element Pilot is owned by another user. Request editing access, or just respawn.',
    },
    {
      id: 'fall-base-constraint',
      event: 'fall',
      text: 'You left the model. Check your base constraint.',
    },
    {
      id: 'timeout-someone-else',
      event: 'timeout',
      text: "Time is up. The clash is now someone else's problem, just like in real life.",
    },
    {
      id: 'load-error-export',
      event: 'load-error',
      text: 'Failed to load. Did you check the IFC export settings? Of course you did.',
    },
    {
      id: 'win-zero-warnings',
      event: 'win',
      text: 'Warnings: 0. This never happens in real life.',
    },
  ],
};

/**
 * Registry of joke packs so custom packs can be plugged in alongside game modes.
 */
export class JokeRegistry {
  private readonly packs = new Map<string, JokePack>();

  constructor(initialPacks: JokePack[] = [STARTER_JOKE_PACK]) {
    for (const pack of initialPacks) {
      this.register(pack);
    }
  }

  register(pack: JokePack): void {
    this.packs.set(pack.id, pack);
  }

  getAllJokes(): JokeEntry[] {
    const all: JokeEntry[] = [];
    for (const pack of this.packs.values()) {
      all.push(...pack.jokes);
    }
    return all;
  }
}

/**
 * Rotates through matching jokes without repeats until the pool is exhausted.
 * Returns null when seriousMode is enabled (for client demos).
 */
export class JokeRotator {
  private readonly registry: JokeRegistry;
  private readonly usedIds = new Set<string>();
  private readonly rng: () => number;
  seriousMode = false;

  constructor(registry = new JokeRegistry(), rng: () => number = Math.random) {
    this.registry = registry;
    this.rng = rng;
  }

  nextJoke(event: JokeEventType, ifcClass?: string): JokeEntry | null {
    if (this.seriousMode) {
      return null;
    }

    const allForEvent = this.registry
      .getAllJokes()
      .filter((joke) => joke.event === event);

    if (allForEvent.length === 0) {
      return null;
    }

    // Prefer class-specific jokes first if unused ones remain, otherwise general/all event jokes
    const specific = ifcClass
      ? allForEvent.filter((j) =>
          j.ifcClassMatch?.some(
            (cls) => cls.toUpperCase() === ifcClass.toUpperCase()
          )
        )
      : [];

    const general = allForEvent.filter(
      (j) => !j.ifcClassMatch || j.ifcClassMatch.length === 0
    );

    const eligible =
      specific.length > 0 ? [...specific, ...general] : [...allForEvent];

    let unused = eligible.filter((j) => !this.usedIds.has(j.id));
    if (unused.length === 0) {
      for (const j of eligible) {
        this.usedIds.delete(j.id);
      }
      unused = eligible;
    }

    // If unused specific jokes exist, pick among specific first for flavor
    const unusedSpecific = unused.filter((j) =>
      specific.some((s) => s.id === j.id)
    );
    const pool = unusedSpecific.length > 0 ? unusedSpecific : unused;
    const index = Math.min(
      pool.length - 1,
      Math.floor(this.rng() * pool.length)
    );
    const chosen = pool[index];
    this.usedIds.add(chosen.id);
    return chosen;
  }

  reset(): void {
    this.usedIds.clear();
  }
}
