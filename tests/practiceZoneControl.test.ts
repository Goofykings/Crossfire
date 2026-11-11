import {expect,it} from 'vitest';
import {PracticeSimulation} from '../src/practice/PracticeSimulation';
import {PracticeClient} from '../src/practice/PracticeClient';
import {DEFAULT_PRACTICE,validPractice} from '../src/practice/config';
import {WORLDS} from '../server/src/world';
import {ZONE_MAPS,zoneEligible} from '../shared/zoneControl';
import {MAP_IDS,type MapId} from '../shared/maps';
import {parseServerMessage,PROTOCOL_VERSION} from '../shared/protocol';
const setup={...DEFAULT_PRACTICE,mapId:'industrial-complex' as const,mode:'zone-control' as const,bots:0};
const world=(id:MapId)=>{const d=WORLDS[id];return {world:d.world,layout:d.layout,revision:d.revision};};
const advance=(s:PracticeSimulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*120);i++)s.step();};
function park(s:PracticeSimulation,index:number,zone=0){const [x,y,z]=ZONE_MAPS[s.setup.mapId][zone].position;s.actors[index].controller.teleport({x,y,z},0);}
it('Practice only accepts eligible Zone Control maps and keeps all maps for other modes',()=>{
 for(const mapId of MAP_IDS){expect(validPractice({...setup,mapId})).toBe(zoneEligible(mapId));expect(validPractice({...setup,mapId,mode:'ffa'})).toBe(true);expect(validPractice({...setup,mapId,mode:'teams'})).toBe(true);}
 expect(()=>new PracticeSimulation({...setup,mapId:'european-town'},world('european-town'),'Local')).toThrow('Invalid Practice');
});
it('local zones capture, contest, exclude dead occupants, score and freeze with valid snapshots',()=>{
 const sim=new PracticeSimulation({...setup,bots:2},world(setup.mapId),'Local',{now:0});sim.spawnHuman('rifle');
 for(const a of sim.actors.slice(1))a.brain=null;
 expect(sim.actors.map(a=>a.state.team)).toEqual(['blue','red','blue']);
 park(sim,0);sim.step();advance(sim,5);expect(sim.snapshot().zoneControl!.zones[0].progress).toBeCloseTo(.5,2);
 park(sim,1);sim.step();const progress=sim.snapshot().zoneControl!.zones[0].progress;advance(sim,2);expect(sim.snapshot().zoneControl!.zones[0].contested).toBe(true);expect(sim.snapshot().zoneControl!.zones[0].progress).toBe(progress);
 sim.actors[1].state.alive=false;sim.actors[1].state.health=0;sim.step();advance(sim,5.1);expect(sim.snapshot().zoneControl!.zones[0].owner).toBe('blue');
 advance(sim,2);expect(sim.teamScores.blue).toBeGreaterThanOrEqual(2);expect(sim.actors[0].state.score).toBe(0);
 const snap=sim.snapshot();expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'snapshot',snapshot:{...snap,room:'public-main'}}))).not.toBeNull();snap.zoneControl!.zones[0].owner='red';expect(sim.snapshot().zoneControl!.zones[0].owner).toBe('blue');
 sim.actors[0].state.alive=false;sim.actors[0].state.health=0;sim.step();expect(sim.snapshot().zoneControl!.zones[0].blue).toBe(0);advance(sim,1);expect(sim.teamScores.blue).toBeGreaterThanOrEqual(3);
 // Integrate the last interval exactly to the deadline, never past it.
 sim.now=sim.endsAt!-10;sim.step(null,.1);expect(sim.result?.winningTeam).toBe('blue');expect(sim.result?.teamScores).toEqual(sim.teamScores);expect(sim.snapshot().zoneControl!.updatedAt).toBe(sim.endsAt);
 const frozen=JSON.stringify(sim.snapshot());advance(sim,2);expect(JSON.stringify(sim.snapshot())).toBe(frozen);
});
it('local transport pauses objective time and closes without a gameplay WebSocket',async()=>{
 const client=new PracticeClient(setup,world(setup.mapId),'Local');await client.connect();await client.spawn('rifle');park(client.simulation,0);
 for(let i=0;i<20;i++)client.advance(.1);const state=JSON.stringify(client.simulation.snapshot());client.advance(10,true);expect(JSON.stringify(client.simulation.snapshot())).toBe(state);
 await client.leaveRoom();client.advance(1);expect(client.latest).toBeNull();expect(client.inspect().opens).toBe(0);
});
it.each(MAP_IDS.filter(zoneEligible))('bots walk to and capture an actual objective on %s',mapId=>{
 const sim=new PracticeSimulation({...setup,mapId,bots:1},world(mapId),'Local',{now:0,seed:137});sim.spawnHuman('rifle');sim.actors[0].state.alive=false;sim.actors[0].state.health=0;
 let captured=false;
 for(let i=0;i<120*90;i++){sim.step();sim.events.length=0;if(sim.snapshot().zoneControl!.zones.some(z=>z.owner==='red')){captured=true;break;}}
 expect(captured,'bot must physically occupy an objective for its capture duration').toBe(true);expect(sim.actors[1].brain!.distanceTravelled).toBeGreaterThan(2);expect(sim.actors[1].state.deaths).toBe(0);
},30000);
