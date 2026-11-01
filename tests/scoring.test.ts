import { describe, expect, it } from 'vitest';
import { awardElimination, expireCombo, finalizeRound, pointsOrder, resetCombo, resultOutcome, type RoundLedger, type ScoreState } from '../shared/scoring';
import { formatScore, matchCountdown } from '../src/ui/matchFormatting';
import { PROTOCOL_VERSION, parseClientMessage, parseServerMessage, validResult } from '../shared/protocol';
import { resultGroups } from '../src/ui/RoundResults';

const score = (): ScoreState => ({ score: 0, comboCount: 0, comboUntil: null });
const ledger = (mode: 'ffa' | 'teams' = 'ffa'): RoundLedger => ({ roundId: 2, mapId: 'european-town', mode, endsAt: 600000, players: {
  b: { id: 'b', name: 'Bravo', score: 410, kills: 3, deaths: 1, team: 'red', weapon: 'shotgun' },
  a: { id: 'a', name: 'Alpha', score: 300, kills: 3, deaths: 0, team: 'blue', weapon: 'rifle' },
} });

describe('authoritative point rules', () => {
  it('awards base and headshot elimination points', () => {
    expect(awardElimination(score(), 1000, false).total).toBe(100);
    expect(awardElimination(score(), 1000, true).total).toBe(150);
  });
  it('awards the exact normal/double/triple-headshot example', () => {
    const s = score();
    expect(awardElimination(s, 1000, false).total).toBe(100);
    expect(awardElimination(s, 2000, false).total).toBe(120);
    expect(awardElimination(s, 3000, true)).toEqual({ base: 100, headshot: 50, combo: 40, comboCount: 3, total: 190 });
    expect(s.score).toBe(410);
  });
  it('awards normal triple and indefinitely increasing large combos without rounding', () => {
    const s = score();
    for (let i = 1; i <= 1000; i++) {
      const award = awardElimination(s, i * 100, false);
      expect(award.total).toBe(100 + 20 * (i - 1)); expect(award.comboCount).toBe(i);
    }
    expect(s.score).toBe(1000 * 100 + 20 * 999 * 1000 / 2);
  });
  it('restarts the four-second deadline per kill and expires at its exact boundary', () => {
    const s = score(); awardElimination(s, 1000, false);
    expect(awardElimination(s, 4999, false).comboCount).toBe(2);
    expect(s.comboUntil).toBe(8999);
    expireCombo(s, 8998); expect(s.comboCount).toBe(2);
    expireCombo(s, 8999); expect(s.comboCount).toBe(0);
    expect(awardElimination(s, 8999, false).total).toBe(100);
  });
  it('uses the same elapsed deadline on resume; death/round resets do not extend it', () => {
    const s = score(); awardElimination(s, 1000, false);
    const resumed: ScoreState = JSON.parse(JSON.stringify(s));
    expect(awardElimination(resumed, 4000, false).total).toBe(120);
    resetCombo(resumed); expect(awardElimination(resumed, 4001, false).total).toBe(100);
    resetCombo(resumed); resumed.score = 0;
    expect(awardElimination(resumed, 5000, false).total).toBe(100);
  });
  it('supports a server-configured window', () => {
    const s = score(); awardElimination(s, 1000, false, 2000);
    expect(awardElimination(s, 3000, false, 2000).comboCount).toBe(1);
  });
});

describe('rank and frozen results', () => {
  it('ranks numeric points before kills, deaths or names with stable ID ties', () => {
    const players = Object.values(ledger().players);
    expect(players.sort(pointsOrder).map((p) => p.id)).toEqual(['b', 'a']);
    players[0].score = players[1].score;
    expect(players.sort(pointsOrder).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('selects the FFA winner and MVP by points', () => {
    const result = finalizeRound(ledger(), { blue: 0, red: 0 });
    expect(result.winner?.id).toBe('b'); expect(result.mvp?.id).toBe('b'); expect(result.draw).toBe(false);
    expect(resultOutcome(result, 'b', null)).toBe('VICTORY'); expect(resultOutcome(result, 'a', null)).toBe('DEFEAT');
    expect(validResult(result)).toBe(true);
  });
  it('retains elimination-based team winners even when MVP is on the losing team', () => {
    const result = finalizeRound(ledger('teams'), { blue: 10, red: 2 });
    expect(result.winningTeam).toBe('blue'); expect(result.mvp?.id).toBe('b');
    expect(resultOutcome(result, 'a', 'blue')).toBe('VICTORY'); expect(resultOutcome(result, 'b', 'red')).toBe('DEFEAT');
    expect(validResult(result)).toBe(true);
  });
  it.each(['ffa', 'teams'] as const)('draws tied %s results while choosing MVP deterministically', (mode) => {
    const l = ledger(mode); l.players.a.score = l.players.b.score;
    const result = finalizeRound(l, { blue: 3, red: 3 });
    expect(result.draw).toBe(true); expect(result.mvp?.id).toBe('a'); expect(resultOutcome(result, 'a', 'blue')).toBe('DRAW');
    expect(result.winner).toBeNull(); expect(result.winningTeam).toBeNull(); expect(validResult(result)).toBe(true);
  });
  it('handles empty rounds and keeps completed results independent of new match state', () => {
    const l = ledger(), result = finalizeRound(l, { blue: 0, red: 0 });
    l.players.b.score = 0; expect(result.mvp?.score).toBe(410);
    l.players = {}; const empty = finalizeRound(l, { blue: 0, red: 0 }); expect(empty.draw).toBe(true); expect(empty.mvp).toBeNull();
  });
  it('freezes the complete participant roster, last weapon and team before new-round resets', () => {
    const l = ledger('teams'), result = finalizeRound(l, { blue: 10, red: 2 });
    l.players.b.name = 'Changed'; l.players.b.score = 0; l.players.b.weapon = 'sniper'; l.players = {};
    expect(result.players?.map((p) => [p.name, p.score, p.weapon])).toEqual([['Bravo', 410, 'shotgun'], ['Alpha', 300, 'rifle']]);
    expect(resultGroups(result).map((g) => [g.team, g.players.map((p) => p.id)])).toEqual([['blue', ['a']], ['red', ['b']]]);
    expect(result.mvp?.team).toBe('red'); expect(result.winningTeam).toBe('blue'); expect(validResult(result)).toBe(true);
  });
  it('ranks FFA results by full points without mutating the server result', () => {
    const result = finalizeRound(ledger(), { blue: 0, red: 0 }); result.players!.reverse();
    expect(resultGroups(result)[0].players.map((p) => p.id)).toEqual(['b', 'a']);
    expect(result.players![0].id).toBe('a'); expect(result.teamScores).toBeNull();
  });
  it('retains both empty team sections and accepts legacy summaries without fabricated rows', () => {
    const l = ledger('teams'); l.players = {};
    const result = finalizeRound(l, { blue: 0, red: 0 });
    expect(resultGroups(result)).toEqual([{ team: 'blue', players: [] }, { team: 'red', players: [] }]);
    delete result.players; expect(validResult(result)).toBe(true);
  });
  it('rejects malformed or duplicate frozen participants and mismatched MVP or winner', () => {
    const result = finalizeRound(ledger(), { blue: 0, red: 0 });
    for (const fields of [{ players: {} }, { players: [result.players![0], result.players![0]] },
      { players: [{ ...result.players![0], weapon: 'fake' }] }, { players: [{ ...result.players![0], score: -1 }] },
      { mvp: { ...result.mvp!, name: 'Forged' } }, { draw: true, winner: null }, { players: [] }]) {
      expect(validResult({ ...result, ...fields })).toBe(false);
    }
  });
});

describe('display-only formatting and compatibility', () => {
  it.each([[0, '0'], [999, '999'], [1000, '1k'], [1099, '1k'], [1200, '1.2k'], [2450, '2.4k'], [5900, '5.9k'], [9999, '9.9k'], [10000, '10k']])('%s displays as %s', (n, formatted) => {
    expect(formatScore(Number(n))).toBe(formatted);
  });
  it('uses the authoritative deadline across refresh, clock offsets, and reconnect', () => {
    expect(matchCountdown(600000, 0)).toBe('10:00'); expect(matchCountdown(600000, 1001)).toBe('9:59');
    expect(matchCountdown(600000, 599001)).toBe('0:01'); expect(matchCountdown(600000, 600001)).toBe('0:00');
    expect(matchCountdown(600000, 600001 - 5000 + 5000)).toBe('0:00'); expect(matchCountdown(null, 0)).toBe('--:--');
  });
  it('rejects old wire versions and forged score/award messages', () => {
    expect(PROTOCOL_VERSION).toBe(12);
    expect(parseClientMessage(JSON.stringify({ v: 9, type: 'join', name: 'Old' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ v: 9, type: 'pong', at: 0, serverTime: 0 }))).toBeNull();
    for (const extra of [{ score: 999 }, { comboCount: 10 }, { comboUntil: 123 }, { result: ledger() }]) {
      expect(parseClientMessage(JSON.stringify({ v: 12, type: 'join', name: 'Unit', ...extra }))).toBeNull();
    }
  });
  it('validates point breakdown arithmetic against the eliminating hit', () => {
    const elimination = { id: 'unit-elimination', victimLife: 1, direction: null, roundId: 0,
      victimId: 'b', victimName: 'B', killerId: 'a', killerName: 'A', weapon: 'rifle', head: true,
      at: 1000, respawnAt: 4000, killerTeam: null, victimTeam: null,
      award: { base: 100, headshot: 50, combo: 20, comboCount: 2, total: 170 } };
    const message = { v: 12, type: 'elimination', elimination };
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    for (const invalid of [{ total: 171 }, { headshot: 0 }, { combo: 40 }, { comboCount: 0 }, { total: 170.5 }]) {
      expect(parseServerMessage(JSON.stringify({ ...message, elimination: { ...elimination, award: { ...elimination.award, ...invalid } } }))).toBeNull();
    }
  });
});
