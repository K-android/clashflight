import { describe, expect, it } from 'vitest';
import { SessionManager } from '../scoring';
import type { Issue } from '../types';

function makeIssue(id: string, priority: string, position: [number, number, number] | null = [0, 2, 0]): Issue {
  return {
    schemaVersion: 1,
    id,
    source: 'bcf',
    title: `Issue ${id}`,
    status: 'open',
    priority,
    elementKeys: [],
    position,
    meta: {},
  };
}

describe('SessionManager & SeverityScoreRule', () => {
  it('denies resolving and awards 0 points if issue was not inspected first', () => {
    const session = new SessionManager({
      issues: [makeIssue('a', 'High')],
    });

    const uninspectedResult = session.resolveIssue('a');
    expect(uninspectedResult.resolved).toBe(false);
    expect(uninspectedResult.pointsAwarded).toBe(0);
    expect(session.state.score).toBe(0);

    session.inspectIssue('a');
    const inspectedResult = session.resolveIssue('a');
    expect(inspectedResult.resolved).toBe(true);
    expect(inspectedResult.pointsAwarded).toBe(250);
    expect(session.state.score).toBe(250);
    expect(session.state.completed).toBe(true);
  });

  it('scales points by priority, applies streak bonus, and resets streak on crash', () => {
    const session = new SessionManager({
      issues: [
        makeIssue('low', 'Low'),
        makeIssue('med', 'Medium'),
        makeIssue('crit', 'Critical'),
      ],
    });

    session.inspectIssue('low');
    expect(session.resolveIssue('low').pointsAwarded).toBe(100); // streak 0

    session.inspectIssue('med');
    expect(session.resolveIssue('med').pointsAwarded).toBe(175); // 150 + 25

    session.recordCrash();
    expect(session.state.crashCount).toBe(1);
    expect(session.state.streak).toBe(0);

    session.inspectIssue('crit');
    expect(session.resolveIssue('crit').pointsAwarded).toBe(300); // streak reset to 0
    expect(session.state.score).toBe(575);
  });
});
