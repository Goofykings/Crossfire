import type {PracticeSimulation} from './PracticeSimulation';
import type {Vec3} from '../player/PlayerController';

/** Development-only, event-enabled top-down diagnostics. Never loaded by production. */
export class PracticeDebug {
 private readonly canvas=document.createElement('canvas');private readonly backdrop=document.createElement('canvas');
 private at=0;private simulation:PracticeSimulation|null=null;
 constructor(){this.canvas.width=this.backdrop.width=420;this.canvas.height=650;this.backdrop.height=360;this.canvas.className='practice-debug';this.canvas.setAttribute('aria-label','Practice navigation diagnostics');document.body.append(this.canvas);}
 update(sim:PracticeSimulation,fps:number){
  if(performance.now()<this.at&&sim===this.simulation)return;this.at=performance.now()+200;
  const [x0,z0,x1,z1]=sim.data.layout.playArea,scale=Math.min(390/(x1-x0),330/(z1-z0));
  const xy=(p:Vec3)=>[15+(p.x-x0)*scale,15+(p.z-z0)*scale] as const;
  if(sim!==this.simulation){
   this.simulation=sim;const b=this.backdrop.getContext('2d')!;b.clearRect(0,0,420,360);
   for(const box of sim.data.world.all())if(box.solid){
    const [x,z]=xy({x:box.cx,y:0,z:box.cz});b.save();b.translate(x,z);b.rotate(-box.yaw);b.fillStyle=box.hy<.25?'#33414b':'#52616c';b.fillRect(-box.hx*scale,-box.hz*scale,2*box.hx*scale,2*box.hz*scale);b.restore();
   }
   for(const n of sim.nav.nodes){const [x,z]=xy(n);b.fillStyle=n.y>2?'#ffd585':n.y<-.5?'#b996ef':'#86bdba';b.fillRect(x-1,z-1,2,2);}
  }
  const c=this.canvas.getContext('2d')!;c.clearRect(0,0,420,650);c.drawImage(this.backdrop,0,0);
  for(const a of sim.actors){
   const [x,z]=xy(a.controller.position),brain=a.brain;c.fillStyle=!a.state.alive?'#888':a.state.team==='blue'||!brain?'#69b6ff':'#ff8787';c.beginPath();c.arc(x,z,4,0,Math.PI*2);c.fill();
   if(!brain)continue;c.strokeStyle='#7cdbf8';c.lineWidth=1;c.beginPath();c.moveTo(x,z);for(const n of brain.path.slice(brain.pathIndex))c.lineTo(...xy(n));c.stroke();
   const target=sim.actors.find(t=>t.state.id===brain.targetId);if(target&&brain.visible){c.strokeStyle='#ff8c67';c.beginPath();c.moveTo(x,z);c.lineTo(...xy(target.controller.position));c.stroke();}
  }
  const invalid=[...sim.data.world.all()].filter(b=>![b.cx,b.cy,b.cz,b.hx,b.hy,b.hz,b.yaw].every(Number.isFinite)||b.hx<=0||b.hy<=0||b.hz<=0).length;
  c.font='12px monospace';c.fillStyle='#fff';let y=378;const line=(text:string)=>{c.fillText(text,12,y);y+=17;};
  line(`F4 navigation | F2 collision | F3 FPS ${fps.toFixed(0)}`);line(`Map ${sim.data.revision.slice(0,42)}`);line(`${sim.nav.nodes.length} nodes | invalid solids ${invalid}`);line('Dots: street / gold upper / purple underground');line('Cyan: path | orange: visible target (LOS)');
  for(const a of sim.actors.slice(1)){const b=a.brain!;line(`${a.state.name}: ${b.state} HP ${Math.round(a.state.health)}`);line(`  stuck ${b.stuckFor.toFixed(1)}s recoveries ${b.recoveries}`);}
 }
 dispose(){this.canvas.remove();}
}
