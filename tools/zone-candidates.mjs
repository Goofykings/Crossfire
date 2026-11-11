/** Offline placement diagnostic against the actual shared map/collision pipeline. */
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
try{
 const {WORLDS}=await vite.ssrLoadModule('/server/src/world.ts');
 const {PracticeNavigation}=await vite.ssrLoadModule('/src/practice/Navigation.ts');
 for(const [id,{world,layout,environment}]of Object.entries(WORLDS)){
  const points=[],h=1.8,[x0,z0,x1,z1]=layout.playArea,nav=new PracticeNavigation(world,layout);
  for(let x=Math.ceil(x0+4);x<x1-4;x+=2)for(let z=Math.ceil(z0+4);z<z1-4;z+=2){
   const y=world.groundHeight(x,z,.34,1);
   if(!Number.isFinite(y)||y<0||y>.25||world.raycast(x,y+.1,z,0,1,0,40)||layout.spawns.some(s=>Math.hypot(s.pos[0]-x,s.pos[2]-z)<5))continue;
   if(layout.buildings.some(b=>x+h>b.rect[0]&&x-h<b.rect[2]&&z+h>b.rect[1]&&z-h<b.rect[3]))continue;
   if(environment.bodies.some(b=>Math.abs(x-b.position[0])<h+b.radius+.2&&Math.abs(z-b.position[2])<h+b.radius+.2))continue;
   let clear=true;for(let dx=-h;dx<=h+.01;dx+=.3)for(let dz=-h;dz<=h+.01;dz+=.3){
    if(Math.abs(world.groundHeight(x+dx,z+dz,.1,y+.15)-y)>.03||world.overlapsCylinder(x+dx,z+dz,.17,y+.05,y+2))clear=false;
   }
   if(clear&&[[1,0],[-1,0],[0,1],[0,-1]].filter(([a,b])=>nav.walkable({x,y,z},{x:x+a*2.5,y,z:z+b*2.5})).length>=2)points.push([x,y,z]);
  }
  let best=[],score=-Infinity;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
   const p=[points[i],points[j],points[k]],d=p.map((a,t)=>Math.hypot(a[0]-p[(t+1)%3][0],a[2]-p[(t+1)%3][2]));
   const area=Math.abs((p[1][0]-p[0][0])*(p[2][2]-p[0][2])-(p[2][0]-p[0][0])*(p[1][2]-p[0][2]));
   const rank=Math.min(...d)+Math.min(area/100,10)-Math.abs(Math.max(...d)-Math.min(...d))*.2;
   if(rank>score){score=rank;best=p;}
  }
  console.log(id,JSON.stringify({candidates:points.length,best,score}));
 }
}finally{await vite.close();}
