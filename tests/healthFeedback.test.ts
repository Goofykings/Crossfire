import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthFeedback } from '../src/ui/HealthFeedback';
import { DamageFeedback } from '../src/ui/DamageFeedback';
const initial = { id: 'p', life: 1, round: 2, at: 1000, health: 60, max: 100, alive: true };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('observes actual same-life gains, not time, spawn, duplicate frames or Giant max changes', () => {
  const h = new HealthFeedback();
  expect(h.observe(initial).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6000 }).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6100, health: 61 }).healed).toBe(true);
  expect(h.observe({ ...initial, at: 6100, health: 62 }).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6000, health: 90 }).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6200, health: 91.5, max: 150 }).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6300, health: 92.5, max: 150 }).healed).toBe(true);
  expect(h.observe({ ...initial, at: 6400, health: 100, life: 2 }).healed).toBe(false);
  expect(h.observe({ ...initial, at: 6500, health: 0, alive: false }).full).toBe(true);
  h.clear(); expect(h.observe({ ...initial, health: 80 }).healed).toBe(false);
});
function setup() {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const elements: any[] = [];
  vi.stubGlobal('document', { createElement: () => {
    const e = { style: { opacity: '0', setProperty(k: string, v: string) { (this as any)[k] = v; } },
      dataset: {}, setAttribute: vi.fn(), className: '', textContent: '' };
    elements.push(e); return e;
  } });
  const root = { append: vi.fn() };
  const feedback = new DamageFeedback(root as any);
  return { feedback, elements, time: (n: number) => { now = n; feedback.update(0); } };
}
describe('bounded edge presentation', () => {
  it('uses 75ms attack / 550ms release, scales damage, preserves direction and refreshes continuously', () => {
    const { feedback: f, time, elements } = setup();
    f.hit({ x: -1, y: 0, z: 0 }, 10); time(75);
    const small = f.inspect().edges;
    expect(elements[0].style['--edge-right']).toBe( '1');
    expect(elements[0].style['--edge-left']).toBe('0');
    time(200); const before = f.inspect().edges;
    f.hit({ x: 1, y: 0, z: 0 }, 60); time(200);
    expect(f.inspect().edges).toBeCloseTo(before);
    time(275); expect(f.inspect().edges).toBeGreaterThan(small);
    time(825); expect(f.inspect().edges).toBe(0); expect(f.inspect().arrow).toBe(0);
  });
  it('only heals following gains, emits ~2 edge symbols/sec, stops at max or damage, and reuses six nodes', () => {
    const { feedback: f, time, elements } = setup();
    f.observeHealth(initial); time(6000); expect(f.inspect().healing).toBe(0);
    const count = elements.length;
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    let emitted = 0, previous = new Set<unknown>();
    for (let n = 1; n <= 20; n++) {
      time(6000 + n * 100); f.observeHealth({ ...initial, at: 6000 + n * 100, health: 60 + n });
      time(6001 + n * 100);
      const visible = elements.filter(e => e.className === 'healing-plus' && Number(e.style.opacity) > 0);
      emitted += visible.filter(e => !previous.has(e)).length; previous = new Set(visible);
    }
    expect(emitted).toBe(4); // Four appearances over two seconds, with expired nodes reused.
    expect(f.inspect().healing).toBeGreaterThan(0);
    expect(f.inspect().symbols).toBeGreaterThan(0); expect(f.inspect().symbols).toBeLessThanOrEqual(2);
    expect(elements.length).toBe(count);
    for (const e of elements.filter(e => e.className === 'healing-plus' && e.style.left)) {
      const x = parseFloat(e.style.left), y = parseFloat(e.style.top);
      expect(x < 9 || x > 90 || y < 12 || y > 87).toBe(true);
    }
    f.hit({ x: 0, y: 0, z: 1 }, 20); time(8050);
    expect(f.inspect().healing).toBe(0); expect(f.inspect().symbols).toBe(0);
    f.observeHealth({ ...initial, at: 8100, health: 60 });
    time(14000); expect(f.inspect().healing).toBe(0);
    f.observeHealth({ ...initial, at: 14000, health: 61 }); time(14001);
    expect(f.inspect().healing).toBeGreaterThan(0);
    time(14400); expect(f.inspect().healing).toBe(0); // no continuing real HP gains
    f.observeHealth({ ...initial, at: 14500, health: 100 }); time(14501);
    expect(f.inspect().healing).toBe(0); expect(f.inspect().symbols).toBe(0);
    f.clear(); expect(f.inspect().edges).toBe(0);
  });
  it('shows confirmed non-ray damage without inventing an attacker arrow', () => {
    const { feedback: f, time } = setup();
    f.observeHealth(initial); time(1000);
    f.observeHealth({ ...initial, at: 2000, health: 50 }); time(1075);
    expect(f.inspect().edges).toBeGreaterThan(0); expect(f.inspect().arrow).toBe(0);
  });
});
