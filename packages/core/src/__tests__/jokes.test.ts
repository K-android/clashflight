import { describe, expect, it } from 'vitest';
import { JokeRegistry, JokeRotator, STARTER_JOKE_PACK } from '../jokes';

describe('JokeRotator', () => {
  it('rotates through jokes without repeating until pool is exhausted', () => {
    let idx = 0;
    const rotator = new JokeRotator(
      new JokeRegistry([STARTER_JOKE_PACK]),
      () => ((idx++ * 0.37) % 1)
    );

    const wallAndGeneralCount = STARTER_JOKE_PACK.jokes.filter(
      (j) =>
        j.event === 'collision' &&
        (!j.ifcClassMatch || j.ifcClassMatch.includes('IfcWall'))
    ).length;

    const seen = new Set<string>();
    for (let i = 0; i < wallAndGeneralCount; i++) {
      const joke = rotator.nextJoke('collision', 'IfcWall');
      expect(joke).not.toBeNull();
      seen.add(joke!.id);
    }

    expect(seen.size).toBe(wallAndGeneralCount);

    // Next draw reshuffles and returns a valid joke again
    const next = rotator.nextJoke('collision', 'IfcWall');
    expect(next).not.toBeNull();
  });

  it('returns null when seriousMode is enabled', () => {
    const rotator = new JokeRotator();
    rotator.seriousMode = true;
    expect(rotator.nextJoke('collision', 'IfcColumn')).toBeNull();
    expect(rotator.nextJoke('win')).toBeNull();
  });
});
