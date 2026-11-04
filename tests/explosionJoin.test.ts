import { describe, it, expect } from 'vitest';
import { burstEnvelope } from '../src/weapons/burstEnvelope';
import { parseClientMessage, parseServerMessage, PROTOCOL_VERSION } from '../shared/protocol';
import { GRENADE } from '../shared/grenades';

describe('bounded explosion presentation', () => {
  it('flashes only during the first 60ms', () => {
    expect(burstEnvelope(0).flash).toBe(1);
    expect(burstEnvelope(30).flash).toBeGreaterThan(0);
    expect(burstEnvelope(60).flash).toBe(0);
  });
  it('expands quickly, then hands over to smoke at 450ms', () => {
    expect(burstEnvelope(120).expansion).toBeGreaterThan(burstEnvelope(40).expansion);
    expect(burstEnvelope(120).fire).toBeGreaterThan(0);
    expect(burstEnvelope(250).fire).toBeLessThan(burstEnvelope(120).fire);
    expect(burstEnvelope(450).fire).toBe(0);
    expect(burstEnvelope(550).sparks).toBe(0);
    expect(GRENADE.damageRadius).toBe(4.2);
  });
  it('keeps every opacity bounded, including clock skew and stale history', () => {
    for (const age of [-100, 0, 30, 60, 120, 250, 450, 550, 7000]) {
      const { age: _, ...values } = burstEnvelope(age);
      for (const value of Object.values(values)) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(values)) expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('trusted join announcement schema', () => {
  const event = { v: PROTOCOL_VERSION, type: 'system', kind: 'player_joined', id: 'join:12345678-1234-1234-1234-123456789abc', name: 'Real Guest' };
  it('accepts only the distinct server-authored schema', () => expect(parseServerMessage(JSON.stringify(event))).toEqual(event));
  it('rejects forged client announcements and player-supplied senders', () => {
    expect(parseClientMessage(JSON.stringify(event))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'chat', text: 'joined.', name: 'Server' }))).toBeNull();
  });
  it('rejects unsafe names, extra fields, invalid kinds and versions', () => {
    for (const change of [{ name: '<Guest>' }, { name: '' }, { text: 'spoof' }, { kind: 'anything' }, { id: '' }, { v: PROTOCOL_VERSION - 1 }]) {
      expect(parseServerMessage(JSON.stringify({ ...event, ...change }))).toBeNull();
    }
  });
});
