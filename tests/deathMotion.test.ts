import {expect,it} from 'vitest';
import {DeathMotion} from '../src/game/DeathMotion';
import {CollisionWorld} from '../src/physics/CollisionWorld';
it.each([30,60,144])('reacts backward, falls, settles and stays within map solids at %s FPS',fps=>{
 const world=new CollisionWorld();world.add({c:[0,-.2,0],h:[10,.2,10]});world.add({c:[0,2,2],h:[10,2,.1]});
 const motion=new DeathMotion({x:0,y:0,z:0},{x:0,y:0,z:1},world);
 for(let i=0;i<fps*2.2;i++){motion.advance(1/fps);for(const p of motion.points()){expect(p.y).toBeGreaterThanOrEqual(.299);expect(world.overlapsCylinder(p.x,p.z,.295,p.y-.295,p.y+.295)).toBe(false);}}
 expect(motion.center.z).toBeGreaterThan(.1);expect(motion.center.z).toBeLessThan(1.5);expect(motion.angle).toBeGreaterThan(1.1);expect(motion.center.y).toBeLessThan(.6);
});
it('redirects a wall-adjacent landing instead of sweeping the body through the wall',()=>{
 const world=new CollisionWorld();world.add({c:[0,-.2,0],h:[10,.2,10]});world.add({c:[0,2,1],h:[10,2,.1]});const motion=new DeathMotion({x:0,y:0,z:.5},{x:0,y:0,z:1},world);
 for(let i=0;i<264;i++){motion.advance(1/120);for(const p of motion.points())expect(world.overlapsCylinder(p.x,p.z,.29,p.y-.29,p.y+.29)).toBe(false);}
 expect(Math.abs(motion.center.x)).toBeGreaterThan(.05);expect(motion.angle).toBeGreaterThan(.8);
});
