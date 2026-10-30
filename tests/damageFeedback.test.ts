import { afterEach, expect, it, vi } from 'vitest';
import { DamageFeedback } from '../src/ui/DamageFeedback';

// Minimal DOM fixture for the time envelope; real CSS pixels are checked in Chrome.
const elements: { style: Record<string, unknown>; dataset: Record<string, string>; textContent: string }[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); elements.length = 0; });
it('attacks quickly, clears after 500ms and refreshes repeated hits with bounded brightness', () => {
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { createElement: () => {
    const style: Record<string, unknown> = {};
    style.setProperty = (key: string, value: string) => { style[key] = value; };
    const e = { style, dataset: {}, textContent: '', setAttribute() {} };
    elements.push(e); return e;
  } });
  const feedback = new DamageFeedback({ append() {} } as unknown as HTMLElement);
  feedback.hit({ x: -1, y: 0, z: 0 }, 25);
  now += 40; feedback.update(0);
  expect(feedback.inspect().edges).toBeGreaterThan(.4);
  expect(feedback.inspect().direction).toBe('right');
  expect(feedback.inspect().arrow).toBe(1);
  expect(elements[0].style['--damage-right']).toBe('1'); expect(elements[0].style['--damage-left']).toBe('0');
  feedback.update(-Math.PI / 2);
  expect(Number(elements[0].style['--damage-top'])).toBeCloseTo(.55);
  expect(feedback.inspect().arrow).toBe(0);
  now += 300; feedback.update(0); expect(feedback.inspect().edges).toBeLessThan(.2);
  const before = feedback.inspect().edges;
  feedback.hit({ x: 0, y: 0, z: 1 }, 100); feedback.update(0);
  expect(feedback.inspect().edges).toBeCloseTo(before);
  now += 80; feedback.update(0);
  expect(feedback.inspect().edges).toBeLessThanOrEqual(.8);
  expect(feedback.inspect().arrow).toBe(0);
  now += 500; feedback.update(0); expect(feedback.inspect().edges).toBe(0);
  expect(feedback.inspect().arrow).toBe(0);
  feedback.hit({ x: 1, y: 0, z: 0 }, 30); feedback.clear();
  expect(feedback.inspect().edges).toBe(0);
});
