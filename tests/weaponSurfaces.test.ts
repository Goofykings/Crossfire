import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

// Read the actual shipping meshes: an enabled mesh alone cannot detect an
// inside-out stock cap. Large planar side faces must point out of the gun.
const files=['rifle','shotgun','sniper','smg','semi_sniper'].map(id=>`models/shared/weapons/${id}.glb`)
  .concat(['ar/verdant-relay','shotgun/crimson-forge','sniper/aurum-meridian','smg/blue-current'].map(id=>`cosmetics/${id}/model.glb`));
describe.each(files)('%s',file=>{
  it('renders both sides of its stock, receiver, grip and moving furniture with face culling enabled',()=>{
    const buffer=readFileSync(`public/assets/${file}`),length=buffer.readUInt32LE(12);
    const doc=JSON.parse(buffer.toString('utf8',20,20+length)),binary=28+length;
    const read=(index:number):number[][]=>{
      const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];
      const components=a.type==='VEC3'?3:1,bytes=a.componentType===5123?2:4;
      return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,c)=>{
        const offset=binary+(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??components*bytes)+c*bytes;
        return a.componentType===5126?buffer.readFloatLE(offset):bytes===2?buffer.readUInt16LE(offset):buffer.readUInt32LE(offset);
      }));
    };
    let left=0,right=0;const reversed:string[]=[];
    const faces:{a:number[];b:number[];c:number[];normal:number;mesh:string}[]=[];
    for(const mesh of doc.meshes)for(const p of mesh.primitives){
      const positions=read(p.attributes.POSITION),indices=read(p.indices).flat();
      for(let i=0;i<indices.length;i+=3){
        const [a,b,c]=indices.slice(i,i+3).map(index=>positions[index]);
        if(Math.abs(a[0]-b[0])>1e-7||Math.abs(a[0]-c[0])>1e-7)continue;
        const normal=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
        if(Math.abs(normal)>1e-10)faces.push({a,b,c,normal,mesh:mesh.name});
      }
    }
    for(const f of faces){
      if(Math.abs(f.normal)/2<.0008)continue;
      if(f.a[0]<0)left++;else right++;
      if(f.normal*f.a[0]>=0)continue;
      const y=(f.a[1]+f.b[1]+f.c[1])/3,z=(f.a[2]+f.b[2]+f.c[2])/3;
      // Optic hoods and decorative inserts legitimately have inward *interior*
      // faces. Accept them only if a real outward cap covers that side farther
      // out, rather than hiding an exposed inside-out surface with two-sided shading.
      const covered=faces.some(g=>{
        if(g.normal*g.a[0]<=0||g.a[0]*f.a[0]<=0||Math.abs(g.a[0])<=Math.abs(f.a[0])+1e-5)return false;
        const edge=(a:number[],b:number[])=>(b[1]-a[1])*(z-a[2])-(b[2]-a[2])*(y-a[1]);
        const signs=[edge(g.a,g.b),edge(g.b,g.c),edge(g.c,g.a)];
        return signs.every(n=>n>=-1e-9)||signs.every(n=>n<=1e-9);
      });
      if(!covered)reversed.push(`${f.mesh}: x=${f.a[0].toFixed(4)} z=${f.a[2].toFixed(4)}`);
    }
    expect(left).toBeGreaterThan(0);expect(right).toBeGreaterThan(0);
    expect(reversed).toEqual([]);
  });
});
