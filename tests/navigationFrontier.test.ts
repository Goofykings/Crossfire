import {expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {NavFrontier} from '../src/practice/NavFrontier';
import {PracticeNavigation,type NavNode} from '../src/practice/Navigation';
import {WORLDS} from '../server/src/world';
import {MAP_IDS} from '../shared/maps';
const gap=(a:NavNode,b:NavNode)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// Original implementation retained only as a route/cost oracle and benchmark.
function scanPath(nav:PracticeNavigation,a:NavNode,b:NavNode):number[]{
 const cost=new Float64Array(nav.nodes.length).fill(Infinity),came=new Int32Array(nav.nodes.length).fill(-1),open=new Set([a.id]);cost[a.id]=0;
 for(let visited=0;open.size&&visited<nav.nodes.length;visited++){
  let id=-1,rank=Infinity;for(const v of open){const f=cost[v]+gap(nav.nodes[v],b);if(f<rank){rank=f;id=v;}}
  if(id<0)break;if(id===b.id){const path:number[]=[];for(let n=id;n>=0;n=came[n])path.push(n);return path.reverse();}
  open.delete(id);for(const next of nav.nodes[id].edges){const d=cost[id]+gap(nav.nodes[id],nav.nodes[next]);if(d<cost[next]){cost[next]=d;came[next]=id;open.add(next);}}
 }return [];
}
it('indexed frontier preserves ties, decreases and reopen order without duplicate entries',()=>{
 const heap=new NavFrontier(120),oracle=new Map<number,number>();let seed=731;
 const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let step=0;step<5000;step++){
  if(!oracle.size||rand()<.7){const id=Math.floor(rand()*120),rank=(oracle.get(id)??100)-Math.floor(rand()*4);oracle.set(id,rank);heap.set(id,rank);}
  else{let expected=-1,best=Infinity;for(const [id,rank]of oracle)if(rank<best){best=rank;expected=id;}expect(heap.pop()).toBe(expected);oracle.delete(expected);}
  expect(heap.size).toBe(oracle.size);
 }
 while(oracle.size){let expected=-1,best=Infinity;for(const [id,rank]of oracle)if(rank<best){best=rank;expected=id;}expect(heap.pop()).toBe(expected);oracle.delete(expected);}expect(heap.size).toBe(0);
});
it('real map paths match the old A* route exactly, including deterministic ties',()=>{
 const rows=[];
 for(const map of MAP_IDS){
  const data=WORLDS[map],nav=new PracticeNavigation(data.world,data.layout),pairs=[];
  const components=new Map<number,NavNode[]>();for(const n of nav.nodes){const group=components.get(n.component)??[];group.push(n);components.set(n.component,group);}
  const largest=[...components.values()].sort((a,b)=>b.length-a.length)[0];
  for(let i=0;i<12;i++)pairs.push([largest[(i*997)%largest.length],largest[(i*1511+Math.floor(largest.length*.6))%largest.length]]);
  let started=performance.now();const old=pairs.map(([a,b])=>scanPath(nav,a,b)),before=performance.now()-started;
  started=performance.now();const current=pairs.map(([a,b])=>nav.path(a,b).map(n=>n.id)),after=performance.now()-started;
  expect(current,map).toEqual(old);expect(current.every(p=>p.length>0)).toBe(true);
  const queries=Array.from({length:160},(_,i)=>{const n=nav.nodes[(i*449)%nav.nodes.length];return{p:{x:n.x+(i%5-2)*.2,y:n.y+(i%3-1)*.24,z:n.z+(i%7-3)*.15},component:i%3===0?n.component:undefined};});
  for(const p of [{x:0,y:0,z:0},{x:.4,y:1.5,z:-.4},{x:10000,y:0,z:0},{x:NaN,y:0,z:0},{x:Infinity,y:0,z:0}])queries.push({p,component:undefined});
  // Distant small components must use an exact bounded fallback, not sweep an
  // entire mostly empty map grid. Compare against the same global-scan oracle.
  for(let i=0;i<30;i++)queries.push({p:largest[(i*431)%largest.length],component:nav.nodes[(i*619)%nav.nodes.length].component});
  const nearestScan=(p:{x:number;y:number;z:number},component?:number)=>{let best:NavNode|undefined,cost=Infinity;for(const n of nav.nodes){if(component!==undefined&&n.component!==component||Math.abs(n.y-p.y)>1.5)continue;const d=Math.hypot(n.x-p.x,n.y-p.y,n.z-p.z);if(d<cost){best=n;cost=d;}}return best;};
  started=performance.now();const expected=queries.map(q=>nearestScan(q.p,q.component)?.id),nearestScanMs=performance.now()-started;
  started=performance.now();const actual=queries.map(q=>nav.nearest(q.p,q.component)?.id),nearestGridMs=performance.now()-started;
  expect(actual,map+' exact nearest including floors/components/borders').toEqual(expected);expect(nav.nearest({x:0,y:0,z:0},-1)).toBeUndefined();
  rows.push({map,nodes:nav.nodes.length,paths:pairs.length,scanMs:before,heapMs:after,nearestQueries:queries.length,nearestScanMs,nearestGridMs});
 }
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/audit-navigation.json',JSON.stringify(rows,null,2));console.log('Navigation comparison',JSON.stringify(rows));
},60000);
