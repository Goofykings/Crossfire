import {describe,it,expect} from 'vitest';
import {ZONE_MAPS,ZONE_SIZE,createZoneControl,advanceZoneControl,zoneScores,validZoneControl,zoneEligible,insideZone,type ZoneParticipant} from '../shared/zoneControl';
import {WORLDS} from '../server/src/world';
import {PracticeNavigation} from '../src/practice/Navigation';
import {validPractice,DEFAULT_PRACTICE} from '../src/practice/config';
import {validSetup} from '../shared/rooms';
import {teammates} from '../shared/combat';
import {finalizeRound,resultOutcome,type RoundLedger} from '../shared/scoring';
import {PROTOCOL_VERSION,parseClientMessage,parseServerMessage,validResult,type Snapshot} from '../shared/protocol';
import {encodeServerMessage} from '../shared/snapshotWire';
import {matchRewardRequests} from '../server/src/matchRewards';
import {markerPosition} from '../src/game/ZoneControlView';

const make=(end=600000)=>createZoneControl('industrial-complex',0,0,end);
const participant=(team:'blue'|'red',zone=0,patch:Partial<ZoneParticipant>={}):ZoneParticipant=>({team,alive:true,connected:true,position:{x:ZONE_MAPS['industrial-complex'][zone].position[0],y:0,z:ZONE_MAPS['industrial-complex'][zone].position[2]},...patch});
const ledger:RoundLedger={roundId:0,mapId:'industrial-complex',mode:'zone-control',endsAt:600000,players:{a:{id:'a',name:'A',team:'blue',score:1000,kills:10,deaths:1},b:{id:'b',name:'B',team:'red',score:100,kills:1,deaths:10}}};

describe('Zone Control authoritative elapsed-time rules',()=>{
 it('starts neutral with exactly A/B/C; counts only connected living team members in the square at ground level',()=>{
  const s=make();expect(s.zones.map(z=>z.id)).toEqual(['A','B','C']);expect(s.zones.every(z=>z.owner===null&&z.progress===0&&z.capturing===null)).toBe(true);
  advanceZoneControl(s,0,[participant('blue'),participant('blue',0,{alive:false}),participant('blue',0,{connected:false}),participant('blue',0,{team:null}),participant('red',0,{position:{...participant('red').position,y:3}})]);
  expect(s.zones[0]).toMatchObject({blue:1,red:0,contested:false});
  advanceZoneControl(s,10000,[]);expect(s.zones[0].owner).toBe('blue');expect(zoneScores(s)).toEqual({blue:0,red:0});
 });
 it.each([1,2,3])('%i players capture at the correct boundary with no early completion',n=>{
  const s=make(),p=Array.from({length:n},()=>participant('blue')),time=Math.ceil(10000/n);advanceZoneControl(s,0,p);
  advanceZoneControl(s,time-1,p);expect(s.zones[0].owner).toBeNull();advanceZoneControl(s,time,p);expect(s.zones[0]).toMatchObject({owner:'blue',capturing:null,progress:0});
 });
 it('contests freeze capture and decay, then resumes from the same partial amount',()=>{
  const s=make(),blue=participant('blue'),red=participant('red');advanceZoneControl(s,0,[blue]);advanceZoneControl(s,3000,[blue,red]);
  advanceZoneControl(s,6000,[blue,red]);expect(s.zones[0].progress).toBe(.3);expect(s.zones[0].contested).toBe(true);
  advanceZoneControl(s,7000,[]);advanceZoneControl(s,8000,[]);expect(s.zones[0].progress).toBe(.2);
  advanceZoneControl(s,8000,[blue]);advanceZoneControl(s,16000,[blue]);expect(s.zones[0].owner).toBe('blue');
 });
 it('opposite solo team drains old partial capture first, including leftover time deterministically',()=>{
  const s=make();advanceZoneControl(s,0,[participant('blue')]);advanceZoneControl(s,3000,[participant('red')]);
  advanceZoneControl(s,5000,[participant('red')]);expect(s.zones[0]).toMatchObject({capturing:'blue',progress:.1});
  advanceZoneControl(s,7000,[participant('red')]);expect(s.zones[0]).toMatchObject({owner:null,capturing:'red',progress:.1});
  advanceZoneControl(s,8000,[]);advanceZoneControl(s,10000,[]);expect(s.zones[0]).toMatchObject({owner:null,capturing:null,progress:0});
 });
 it('previous owner scores during takeover, decay and contest; transfer splits scoring at completion',()=>{
  const s=make(),red=participant('red'),blue=participant('blue');advanceZoneControl(s,0,[red]);advanceZoneControl(s,10000,[blue]);
  advanceZoneControl(s,14000,[blue,red]);expect(s.zones[0]).toMatchObject({owner:'red',capturing:'blue',progress:.4});
  advanceZoneControl(s,17000,[]);advanceZoneControl(s,18000,[blue]);expect(s.zones[0].progress).toBe(.3);
  advanceZoneControl(s,27000,[blue]);expect(s.zones[0]).toMatchObject({owner:'blue',capturing:null,progress:0});
  expect(zoneScores(s)).toEqual({red:15,blue:2});
 });
 it('neutral zones score nothing; three owners accrue while empty, stop at end and cannot double-count',()=>{
  const s=make(20000);advanceZoneControl(s,0,[]);advanceZoneControl(s,1000,[participant('blue',0),participant('blue',1),participant('blue',2)]);
  expect(zoneScores(s)).toEqual({blue:0,red:0});advanceZoneControl(s,11000,[]);advanceZoneControl(s,15000,[]);expect(zoneScores(s).blue).toBe(12);
  const clone=structuredClone(s);advanceZoneControl(clone,20000,[]);advanceZoneControl(s,30000,[]);expect(s).toEqual(clone);expect(zoneScores(s).blue).toBe(27);
  advanceZoneControl(s,40000,[participant('red')]);expect(zoneScores(s).blue).toBe(27);expect(s.zones[0].red).toBe(0);
 });
 it('small ticks and one elapsed-time update give the same exact score and progress',()=>{
  const a=make(),b=make(),p=[participant('blue'),participant('blue'),participant('blue')];advanceZoneControl(a,0,p);advanceZoneControl(b,0,p);
  for(let t=1;t<=20000;t++)advanceZoneControl(a,t,p);advanceZoneControl(b,20000,p);expect(a).toEqual(b);expect(a.ownedMs.blue).toBe(16666);
 });
 it('does not retroactively count a newly joined player and rejects upper floors or out-of-bounds feet',()=>{
  const s=make();advanceZoneControl(s,50000,[participant('blue')]);expect(s.zones[0].progress).toBe(0);advanceZoneControl(s,60000,[]);expect(s.zones[0].owner).toBe('blue');
  const d=ZONE_MAPS['industrial-complex'][0],p=participant('blue').position;expect(insideZone(d,{...p,x:p.x+ZONE_SIZE/2})).toBe(true);expect(insideZone(d,{...p,x:p.x+ZONE_SIZE/2+.001})).toBe(false);
 });
});

describe('Zone Control rooms, results and wire compatibility',()=>{
 it('uses team wins/draws instead of combat MVP rank and retains team reward safeguards',()=>{
  const result=finalizeRound(ledger,{blue:1,red:20});expect(result.winner).toBeNull();expect(result.mvp?.id).toBe('a');expect(result.winningTeam).toBe('red');expect(validResult(result)).toBe(true);
  expect(resultOutcome(result,'a','blue')).toBe('DEFEAT');expect(resultOutcome(result,'b','red')).toBe('VICTORY');expect(finalizeRound(ledger,{blue:2,red:2}).draw).toBe(true);
  const rewards=matchRewardRequests('room',result,{...ledger,rewardStartedAt:0,rewardParticipants:{a:{identity:'aa',name:'A',firstSpawn:0,abandoned:false},b:{identity:'bb',name:'B',firstSpawn:0,abandoned:false}}});
  expect(rewards.get('a')).toMatchObject({rewardVersion:3,kills:10,deaths:1,bonus:0});expect(rewards.get('b')).toMatchObject({rewardVersion:3,kills:1,deaths:10,bonus:25});
  expect(teammates('zone-control','red','red')).toBe(true);expect(teammates('ffa','red','red')).toBe(false);
 });
 it('accepts compatible full and compact objective snapshots and refuses invalid/injected state',()=>{
  const s:Snapshot={room:'public-main',roundId:0,mapId:'industrial-complex',mapVersion:'test',serverTime:0,players:[],grenades:[],explosions:[],result:null,match:{mode:'zone-control',endsAt:600000,teamScores:{blue:0,red:0}},zoneControl:make()};
  for(const compact of [false,true])expect(parseServerMessage(encodeServerMessage({v:PROTOCOL_VERSION,type:'snapshot',snapshot:s},compact))).toMatchObject({snapshot:s});
  for(const patch of [{zones:[]},{zones:[...s.zoneControl!.zones,s.zoneControl!.zones[0]]},{updatedAt:-1},{ownedMs:{blue:Infinity,red:0}},{roundId:1}])expect(validZoneControl({...s.zoneControl,...patch},s.mapId,0,600000)).toBe(false);
  expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'snapshot',snapshot:{...s,zoneControl:undefined}}))).toBeNull();
  for(const type of ['capture','zones','zone-control'])expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type,owner:'blue',progress:1}))).toBeNull();
  expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'ping',at:0,zoneControl:s.zoneControl}))).toBeNull();
  expect(validPractice({...DEFAULT_PRACTICE,mode:'zone-control'})).toBe(false);
 });
 it('excludes unsuitable maps at the authoritative room boundary and can preserve those maps for FFA',()=>{
  const setup={name:'Zone room',privacy:'public',mapId:'industrial-complex',mode:'zone-control',maxPlayers:10};expect(validSetup(setup)).toBe(true);
  const previous=ZONE_MAPS['industrial-complex'];try{ZONE_MAPS['industrial-complex']=[];expect(zoneEligible('industrial-complex')).toBe(false);expect(validSetup(setup)).toBe(false);expect(validSetup({...setup,mode:'ffa'})).toBe(true);expect(()=>make()).toThrow();}finally{ZONE_MAPS['industrial-complex']=previous;}
 });
 it('clamps markers around all screen edges and keeps the sight center clear',()=>{
  for(const [x,y,front]of [[-1000,500,true],[1800,-300,true],[500,900,true],[400,200,false]] as const){const p=markerPosition(x,y,front,800,600);expect(p.x).toBeGreaterThanOrEqual(38);expect(p.x).toBeLessThanOrEqual(762);expect(p.y).toBeGreaterThanOrEqual(38);expect(p.y).toBeLessThanOrEqual(562);expect(p.edge).toBe(true);}
  expect(markerPosition(400,300,true,800,600).y).toBe(236);
  expect(markerPosition(1200,300,true,800,600).angle).toBeCloseTo(-Math.PI/2);
  expect(markerPosition(-100,300,true,800,600).angle).toBeCloseTo(Math.PI/2);
  expect(markerPosition(400,-100,true,800,600).angle).toBeCloseTo(-Math.PI);
  expect(markerPosition(400,900,true,800,600).angle).toBeCloseTo(0);
 });
});

for(const [id,data]of Object.entries(WORLDS))it(`authored ${id} objectives have flat clear footprints, separated routes and no spawn overlap`,()=>{
 const zones=ZONE_MAPS[id as keyof typeof WORLDS];if(!zoneEligible(id as keyof typeof WORLDS)){expect(zones).toHaveLength(0);expect(validSetup({name:'Room',privacy:'public',mapId:id,mode:'zone-control',maxPlayers:6})).toBe(false);return;}expect(zones).toHaveLength(3);const nav=new PracticeNavigation(data.world,data.layout),components=new Set<number>();
 for(const z of zones){const [x,y,z0]=z.position;
  for(let dx=-1.8;dx<=1.81;dx+=.3)for(let dz=-1.8;dz<=1.81;dz+=.3){expect(data.world.groundHeight(x+dx,z0+dz,.1,y+.15)).toBeCloseTo(y,2);expect(data.world.overlapsCylinder(x+dx,z0+dz,.17,y+.05,y+2)).toBe(false);}
  expect(data.layout.spawns.every(s=>Math.hypot(s.pos[0]-x,s.pos[2]-z0)>=5)).toBe(true);
  expect(data.world.raycast(x,y+.1,z0,0,1,0,40)).toBeNull();
  expect(data.layout.buildings.some(b=>x+1.8>b.rect[0]&&x-1.8<b.rect[2]&&z0+1.8>b.rect[1]&&z0-1.8<b.rect[3])).toBe(false);
  expect(data.environment.bodies.some(b=>Math.abs(x-b.position[0])<1.8+b.radius+.2&&Math.abs(z0-b.position[2])<1.8+b.radius+.2)).toBe(false);
  const center={x,y,z:z0},n=nav.nearest(center)!;expect(Math.hypot(n.x-x,n.z-z0)).toBeLessThan(.65);components.add(n.component);
  // Each objective can be approached from at least two orthogonal directions.
  expect([[1,0],[-1,0],[0,1],[0,-1]].filter(([a,b])=>nav.walkable(center,{x:x+a*2.5,y,z:z0+b*2.5})).length).toBeGreaterThanOrEqual(2);
 }
 expect(components.size).toBe(1);
 for(let i=0;i<3;i++)expect(Math.hypot(zones[i].position[0]-zones[(i+1)%3].position[0],zones[i].position[2]-zones[(i+1)%3].position[2])).toBeGreaterThan(18);
},20000);
