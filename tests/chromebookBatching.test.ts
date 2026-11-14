import {expect,it} from 'vitest';
import {Matrix,MeshBuilder,NullEngine,Scene,StandardMaterial} from '@babylonjs/core';
import {GeometryBatcher} from '../src/rendering/StaticBatcher';
import {CHROMEBOOK_PRESET,GRAPHICS_PRESETS} from '../src/rendering/quality';

it('coarser Chromebook batches reduce submissions without removing or changing static geometry',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const source=MeshBuilder.CreateBox('source',{size:1},scene),material=new StandardMaterial('shared',scene);
  const build=(cell:number)=>{
   const b=new GeometryBatcher(scene,cell);
   for(const x of [12,44,76,108])b.add(source,Matrix.Translation(x,0,12),{material,name:'crate',tint:[1,1,1]});
   return b.build();
  };
  const low=build(GRAPHICS_PRESETS.low.batchCell),lite=build(CHROMEBOOK_PRESET.batchCell);
  expect(lite.length).toBeLessThan(low.length);
  const vertices=(all:typeof low)=>all.flatMap(m=>{
   const p=m.getVerticesData('position')!;const out:string[]=[];
   for(let i=0;i<p.length;i+=3)out.push(`${p[i]},${p[i+1]},${p[i+2]}`);
   return out;
  }).sort();
  expect(vertices(lite)).toEqual(vertices(low));
  expect(lite.reduce((n,m)=>n+m.getTotalIndices(),0)).toBe(low.reduce((n,m)=>n+m.getTotalIndices(),0));
  for(const m of lite){expect(m.material).toBe(material);expect(m.isWorldMatrixFrozen).toBe(true);expect(m.scaling.asArray()).toEqual([1,1,1]);}
  expect(GRAPHICS_PRESETS.low.batchCell).toBe(40);
 }finally{scene.dispose();engine.dispose();}
});
