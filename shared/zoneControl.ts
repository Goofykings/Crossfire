import type {MapId} from './maps';
import type {PlayerTeam} from './combat';
import type {Vec3} from '../src/player/PlayerController';

export const ZONE_IDS=['A','B','C'] as const;
export type ZoneId=typeof ZONE_IDS[number];
export type ZoneTeam=Exclude<PlayerTeam,null>;
export const ZONE_SIZE=3.6;
export const CAPTURE_MS=10000;
export interface ZoneDefinition {id:ZoneId;position:readonly [number,number,number]}
/** Authored coordinates, never independently randomized by a renderer. An empty
 * list explicitly excludes a map from this mode. Validated against real solids. */
export const ZONE_MAPS:Record<MapId,readonly ZoneDefinition[]>={
 // Town cannot fit three separated outdoor squares without using its narrow
 // lanes/interior footprints. Keep its existing other modes unchanged.
 'european-town':[],
 'industrial-complex':[{id:'A',position:[-13,0,-15]},{id:'B',position:[-15,0,19]},{id:'C',position:[17,0,11]}],
 'modern-city':[{id:'A',position:[-15,0,-15]},{id:'B',position:[5,0,19]},{id:'C',position:[21,0,-9]}],
 farmstead:[{id:'A',position:[-33,0,1]},{id:'B',position:[25,0,-39]},{id:'C',position:[29,0,31]}],
};
export const zoneEligible=(id:MapId):boolean=>ZONE_MAPS[id].length===3;
export interface ZoneState {
 id:ZoneId;owner:ZoneTeam|null;capturing:ZoneTeam|null;progress:number;
 blue:number;red:number;contested:boolean;
}
export interface ZoneControlState {
 roundId:number;mapId:MapId;updatedAt:number;endsAt:number;
 /** Integer owned milliseconds accumulate across all objectives for each team.
  * Display floor(ms/1000), avoiding fractional point drift or repeated ticks. */
 ownedMs:{blue:number;red:number};zones:ZoneState[];
}
export interface ZoneParticipant {alive:boolean;connected:boolean;team:PlayerTeam;position:Vec3}
export function createZoneControl(mapId:MapId,roundId:number,at:number,endsAt:number):ZoneControlState {
 if(!zoneEligible(mapId))throw Error('Map does not support Zone Control');
 return {roundId,mapId,updatedAt:at,endsAt,ownedMs:{blue:0,red:0},zones:ZONE_MAPS[mapId].map(({id})=>({id,owner:null,capturing:null,progress:0,blue:0,red:0,contested:false}))};
}
export function insideZone(zone:ZoneDefinition,p:Vec3):boolean {
 const [x,y,z]=zone.position;
 return Math.abs(p.x-x)<=ZONE_SIZE/2+1e-6&&Math.abs(p.z-z)<=ZONE_SIZE/2+1e-6&&Math.abs(p.y-y)<=.3;
}
export const zoneScores=(state:ZoneControlState)=>({blue:Math.floor(state.ownedMs.blue/1000),red:Math.floor(state.ownedMs.red/1000)});

/** Integrate previously sampled authoritative occupants up to now, splitting at
 * exact capture/decay boundaries. Sample the new occupants only after advancing,
 * so joining/teleporting cannot retroactively claim time. Millisecond arithmetic
 * stays integer (three players complete at 3334 ms). No per-player timers. */
export function advanceZoneControl(s:ZoneControlState,at:number,players:readonly ZoneParticipant[]):void {
 const until=Math.min(s.endsAt,Math.max(s.updatedAt,Math.floor(at)));
 const elapsed=until-s.updatedAt;
 for(const zone of s.zones){
  let remaining=elapsed,work=Math.round(zone.progress*CAPTURE_MS);
  const accrue=(ms:number)=>{if(zone.owner)s.ownedMs[zone.owner]+=ms;};
  while(remaining>0){
   if(zone.contested){accrue(remaining);break;}
   const team:ZoneTeam|null=zone.blue?'blue':zone.red?'red':null;
   if(zone.capturing&&team!==zone.capturing){
    const spent=Math.min(remaining,work);accrue(spent);work-=spent;remaining-=spent;
    if(work===0)zone.capturing=null;
    continue;
   }
   if(!team||team===zone.owner){accrue(remaining);break;}
   zone.capturing=team;
   const n=zone[team],spent=Math.min(remaining,Math.ceil((CAPTURE_MS-work)/n));
   accrue(spent);work=Math.min(CAPTURE_MS,work+spent*n);remaining-=spent;
   if(work===CAPTURE_MS){zone.owner=team;zone.capturing=null;work=0;}
  }
  zone.progress=work/CAPTURE_MS;
 }
 s.updatedAt=until;
 for(const zone of s.zones){
  const definition=ZONE_MAPS[s.mapId].find(d=>d.id===zone.id)!;
  zone.blue=zone.red=0;
  if(until<s.endsAt)for(const p of players)if(p.alive&&p.connected&&p.team&&insideZone(definition,p.position))zone[p.team]++;
  zone.contested=zone.blue>0&&zone.red>0;
 }
}

const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const natural=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const team=(x:unknown)=>x===null||x==='blue'||x==='red';
export function validZoneControl(x:unknown,mapId:MapId,roundId:number,endsAt:number):x is ZoneControlState {
 if(!record(x)||!zoneEligible(mapId)||x.mapId!==mapId||x.roundId!==roundId||x.endsAt!==endsAt||!natural(x.endsAt)||!natural(x.updatedAt)||x.updatedAt>endsAt
  ||!record(x.ownedMs)||!natural(x.ownedMs.blue)||!natural(x.ownedMs.red)||x.ownedMs.blue+x.ownedMs.red>3*600000
  ||!Array.isArray(x.zones)||x.zones.length!==3)return false;
 return x.zones.every((z,i)=>record(z)&&z.id===ZONE_IDS[i]&&team(z.owner)&&team(z.capturing)
  &&typeof z.progress==='number'&&Number.isFinite(z.progress)&&z.progress>=0&&z.progress<1
  &&(z.capturing===null?z.progress===0:z.capturing!==z.owner)
  &&natural(z.blue)&&z.blue<=10&&natural(z.red)&&z.red<=10&&z.blue+z.red<=10
  &&z.contested===(z.blue>0&&z.red>0));
}
