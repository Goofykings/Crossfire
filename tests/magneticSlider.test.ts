import {expect,it} from 'vitest';
import {MagneticStops} from '../src/ui/MagneticSlider';
const settle=(s:MagneticStops,dt=1/120)=>{for(let i=0;i<240;i++)if(!s.tick(dt))return;throw Error('Spring failed to sleep');};
it('holds gently near a magnet and uses hysteresis without fractional selected counts',()=>{
 const s=new MagneticStops(0);s.grab(0);s.move(.4,.5);for(let i=0;i<20;i++)s.tick(1/120);expect(s.selected).toBe(0);expect(s.position).toBeLessThan(.2);
 s.move(.65,.5);expect(s.selected).toBe(1);s.move(.48,.5);expect(s.selected).toBe(1);s.move(.35,.5);expect(s.selected).toBe(0);
});
it('fast drags skip magnets, clamp at boundaries and release to an integer',()=>{
 const s=new MagneticStops(0);s.grab(0);s.move(4.8,.02);expect(s.selected).toBe(5);s.move(20,.02);s.release();settle(s);expect(s.position).toBe(5);
 s.grab(5);s.move(-10,.02);s.release();settle(s);expect(s.position).toBe(0);expect(s.selected).toBe(0);
 s.grab(2.2);s.move(2.6,.2);s.release();settle(s);expect(s.selected).toBe(3);expect(s.position).toBe(3);
});
it('spring settles with a small overshoot at different frame rates and sleeps at rest',()=>{
 for(const dt of [1/30,1/60,1/120]){const s=new MagneticStops(1);s.set(3);let maximum=0;for(let i=0;i<120;i++){s.tick(dt);maximum=Math.max(maximum,s.position);}expect(maximum).toBeGreaterThan(3);expect(maximum).toBeLessThan(3.2);settle(s,dt);expect(s.position).toBe(3);expect(s.tick(dt)).toBe(false);}
});
it('direct/reduced-motion snap and interrupted drags keep legal counts',()=>{
 const s=new MagneticStops(3);s.set(4.6);s.snap();expect(s.position).toBe(5);expect(s.tick(.5)).toBe(false);
 s.grab(5);s.move(2.4,.04);expect(Number.isInteger(s.selected)).toBe(true);s.set(s.selected);s.snap();expect(s.position).toBe(s.selected);
});

it('the same magnetic model spans all nine lobby stops without the old five-stop clamp',()=>{
 const s=new MagneticStops(4,8);expect(s.selected+2).toBe(6);s.grab(4);s.move(8,.02);s.release();settle(s);expect(s.selected+2).toBe(10);expect(s.position).toBe(8);
 s.set(-100);settle(s);expect(s.selected+2).toBe(2);
});
