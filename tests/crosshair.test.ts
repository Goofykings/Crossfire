import { describe, expect, it } from 'vitest';
import { CrosshairMotion } from '../src/ui/CrosshairMotion';

describe('cosmetic crosshair damping', () => {
  it('smooths jump expansion and landing recovery without overshoot', () => {
    const motion=new CrosshairMotion();
    const first=motion.update(20,1/60);
    expect(first).toBeGreaterThan(4);expect(first).toBeLessThan(24);
    for(let i=0;i<30;i++)motion.update(20,1/60);
    expect(motion.gap).toBeCloseTo(24,2);
    const land=motion.update(0,1/60);expect(land).toBeGreaterThan(4);expect(land).toBeLessThan(24);
    for(let i=0;i<30;i++)motion.update(0,1/60);
    expect(motion.gap).toBeCloseTo(4,2);
  });
  it('gives the same result at 30, 60 and 144 FPS, ignoring negative frame time', () => {
    const values=[30,60,144].map(fps=>{const m=new CrosshairMotion();for(let i=0;i<fps;i++)m.update(30,1/fps);return m.gap;});
    expect(values[0]).toBeCloseTo(values[1],10);expect(values[0]).toBeCloseTo(values[2],10);
    const m=new CrosshairMotion();expect(m.update(30,0)).toBe(4);expect(m.update(30,-1)).toBe(4);
  });
});
