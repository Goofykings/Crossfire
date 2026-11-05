import {afterEach,expect,it} from 'vitest';
import {NullEngine,Scene,TransformNode,Vector3,Matrix} from '@babylonjs/core';
import {DamageContributions} from '../shared/assists';
import {migrateSession,migrateResult} from '../server/src/legacyState';
import {roundMode} from '../shared/combat';
import {damageAngle} from '../src/game/CombatPresentation';
import {DEFAULT_SETTINGS,effectiveSettings,SettingsStore,sanitizeSettings} from '../src/config/settings';
import {SettingsDraft} from '../src/config/settingsDraft';
import {graphicsPreset} from '../src/rendering/quality';
import {BulletTrails} from '../src/weapons/BulletTrails';
import {RemoteMuzzleFlash} from '../src/weapons/RemoteMuzzleFlash';
import {PROTOCOL_VERSION,parseServerMessage,validMotion} from '../shared/protocol';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerController} from '../src/player/PlayerController';

it('only real damage contributes, last hit refreshes a 10s window and each victim life is consumed once',()=>{
 const c=new DamageContributions();c.damage('v',1,1,'a',1,0,0);c.damage('v',1,1,'v',1,25,0);
 expect(c.take('v',1,1,1)).toEqual([]);
 c.damage('v',1,1,'a',1,25,0);c.damage('v',1,1,'b',1,10,0);c.damage('v',1,1,'a',1,1,9000);
 expect(c.take('v',1,1,10001)).toEqual([{id:'a',life:1,at:9000}]);expect(c.take('v',1,1,10002)).toEqual([]);
 c.damage('v',2,1,'a',1,25,10000);expect(c.take('v',3,1,10001)).toEqual([]);
});
it('clears respawning contributors/victims and round resets; durable capture cannot commit later mutations',()=>{
 const c=new DamageContributions();c.damage('v',1,1,'a',1,25,100);c.damage('v',1,1,'b',1,25,100);
 const capture=c.capture();c.damage('v',1,1,'a',1,1,101);c.committed(capture.revision);expect(c.dirty).toBe(true);
 const restored=new DamageContributions(10000,capture.data,102);restored.clear('a');expect(restored.take('v',1,1,103).map(s=>s.id)).toEqual(['b']);
 restored.damage('v',1,1,'a',1,1,104);restored.clear('v');expect(restored.take('v',1,1,105)).toEqual([]);
 restored.damage('v',1,1,'a',1,1,104);restored.clear();expect(restored.take('v',1,1,105)).toEqual([]);
 expect(new DamageContributions(10,capture.data,1000).capture().data).toEqual([]);
});
it('migrates retired stored abilities without clearing scores or changing normal sessions',()=>{
 const motion=new PlayerController(new CollisionWorld()).capture();
 const old={health:120,score:345,assists:0,motion:{...motion,scale:1.5,eyeScale:1.5,doubleJump:true,extraJumpUsed:true,velocity:{x:100,y:100,z:0}},powerup:{type:'giant'},burn:{},death:{weapon:'burn'}};
 migrateSession(old);expect(old.health).toBe(80);expect(old.score).toBe(345);expect(old).not.toHaveProperty('powerup');expect(old).not.toHaveProperty('burn');expect(old.death.weapon).toBeNull();expect(validMotion(old.motion)).toBe(true);
 const normal={health:75,motion};migrateSession(normal);expect(normal.health).toBe(75);expect(normal.motion).toEqual(motion);
 const ledger={mode:'powerups',players:{a:{score:345}}};migrateResult(ledger);expect(ledger).toEqual({mode:'ffa',players:{a:{score:345,assists:0}}});
 expect(new Set(Array.from({length:30},(_,i)=>roundMode(123,i)))).toEqual(new Set(['ffa','teams']));
 expect(validMotion({...motion,scale:1})).toBe(false);
 expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'powerup',event:{}}))).toBeNull();
});
it('validates authoritative bounce locations/strength and refuses forged fields',()=>{
 const message={v:PROTOCOL_VERSION,type:'grenade',event:{kind:'bounce',id:'bounce-1',grenadeId:'g',roundId:1,at:1000,position:{x:1,y:1,z:1},strength:.5}};
 expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
 for(const patch of [{strength:2},{position:{x:10000,y:0,z:0}},{damage:100},{at:-1}])expect(parseServerMessage(JSON.stringify({...message,event:{...message.event,...patch}}))).toBeNull();
});
it('points front/up, rear/down, left/left and right/right and updates continuously with yaw',()=>{
 expect(damageAngle({x:0,y:0,z:1},0)).toBeCloseTo(-Math.PI/2);
 expect(damageAngle({x:0,y:0,z:-1},0)).toBeCloseTo(Math.PI/2);
 expect(Math.abs(damageAngle({x:1,y:0,z:0},0)!)).toBeCloseTo(Math.PI);
 expect(damageAngle({x:-1,y:0,z:0},0)).toBeCloseTo(0);
 expect(damageAngle({x:0,y:0,z:1},Math.PI/4)).toBeCloseTo(-Math.PI/4);
 expect(damageAngle({x:0,y:1,z:0},0)).toBeNull();
});
it('Chromebook draft applies/persists derived costs and restores original graphics preferences',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)} as unknown as Storage;
 const store=new SettingsStore(storage);expect(store.value.chromebookMode).toBe(false);
 store.update({graphicsQuality:'ultra',shadowQuality:'high',resolutionScale:.85,reducedEffects:false});
 const draft=new SettingsDraft(store);draft.set('chromebookMode',true);expect(store.value.chromebookMode).toBe(false);draft.discard();expect(draft.value.chromebookMode).toBe(false);
 draft.set('chromebookMode',true);draft.apply();const loaded=new SettingsStore(storage);
 expect(effectiveSettings(loaded.value)).toMatchObject({graphicsQuality:'low',shadowQuality:'off',resolutionScale:.5,reducedEffects:true});
 expect(graphicsPreset(loaded.value)).toMatchObject({msaa:1,fxaa:false,bloom:false,ssao:false,sharpen:false,anisotropy:1});
 loaded.update({chromebookMode:false});expect(effectiveSettings(loaded.value)).toMatchObject({graphicsQuality:'ultra',shadowQuality:'high',resolutionScale:.85,reducedEffects:false});
 expect(sanitizeSettings({chromebookMode:'true'}).chromebookMode).toBe(false);expect(DEFAULT_SETTINGS.chromebookMode).toBe(false);draft.dispose();
});
let engine:NullEngine|undefined,scene:Scene|undefined;
afterEach(()=>{scene?.dispose();engine?.dispose();});
it('pools subtle trails along actual confirmed rays, fades within 220ms, and limits one draw call',()=>{
 engine=new NullEngine();scene=new Scene(engine);const trails=new BulletTrails(scene);
 const ray={from:{x:1,y:2,z:3},to:{x:1,y:2,z:13}};
 trails.shot({traces:[ray]},0);expect(trails.inspect()).toEqual({active:1,budget:128,drawCalls:1});
 const particle=(trails as any).batch.particles[0];expect(particle.position.asArray()).toEqual([1,2,8.4]);expect(particle.scaling.z).toBeCloseTo(9.2);
 const origin=Vector3.TransformCoordinates(new Vector3(0,0,-.5),Matrix.Compose(particle.scaling,particle.rotationQuaternion??(awaitQuaternion(particle.rotation)),particle.position));
 expect(origin.z).toBeCloseTo(3.8);
 trails.update(110);expect(particle.color.a).toBeCloseTo(.03);trails.update(220);expect(trails.inspect().active).toBe(0);
 trails.setReduced(true);for(let i=0;i<200;i++)trails.shot({traces:[ray]},300);expect(trails.inspect()).toEqual({active:32,budget:32,drawCalls:1});trails.clear();expect(trails.inspect().drawCalls).toBe(0);trails.dispose();
});
import {Quaternion} from '@babylonjs/core';
function awaitQuaternion(v:Vector3){return Quaternion.RotationYawPitchRoll(v.y,v.x,v.z);}
it('muzzle flashes inherit the actual gun transform and expire without lights/shadows',()=>{
 engine=new NullEngine();scene=new Scene(engine);const gun=new TransformNode('gun',scene);gun.position.set(2,1,3);gun.rotation.y=Math.PI/2;gun.scaling.setAll(.85);
 const flash=new RemoteMuzzleFlash(scene,gun,new Vector3(0,.1,-.8));expect(flash.inspect().active).toBe(false);
 flash.fire(100);flash.root.computeWorldMatrix(true);const expected=Vector3.TransformCoordinates(new Vector3(0,.1,-.8),gun.computeWorldMatrix(true));flash.inspect().position.forEach((n,i)=>expect(n).toBeCloseTo(expected.asArray()[i],6));
 flash.update(154);expect(flash.inspect().active).toBe(true);flash.update(156);expect(flash.inspect().active).toBe(false);expect(scene.lights).toHaveLength(0);flash.dispose();
});
