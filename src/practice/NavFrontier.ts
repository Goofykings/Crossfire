/** Indexed A* frontier. Decreasing a score keeps its original insertion order,
 * matching the old Set scan's deterministic tie breaking. No stale heap entries. */
export class NavFrontier {
 private readonly heap:number[]=[];
 private readonly positions:Int32Array;
 private readonly ranks:Float64Array;
 private readonly orders:Float64Array;
 private serial=0;
 constructor(capacity:number){this.positions=new Int32Array(capacity).fill(-1);this.ranks=new Float64Array(capacity);this.orders=new Float64Array(capacity);}
 get size():number{return this.heap.length;}
 private before(a:number,b:number):boolean{return this.ranks[a]<this.ranks[b]||this.ranks[a]===this.ranks[b]&&this.orders[a]<this.orders[b];}
 private swap(a:number,b:number):void{const id=this.heap[a];this.heap[a]=this.heap[b];this.heap[b]=id;this.positions[this.heap[a]]=a;this.positions[id]=b;}
 set(id:number,rank:number):void{
  let index=this.positions[id];
  if(index<0){index=this.heap.length;this.positions[id]=index;this.heap.push(id);this.orders[id]=this.serial++;}
  this.ranks[id]=rank;
  // A* only calls set when the cost decreases (or a node is newly reopened).
  while(index>0){const parent=(index-1)>>1;if(!this.before(this.heap[index],this.heap[parent]))break;this.swap(index,parent);index=parent;}
 }
 pop():number{
  const id=this.heap[0],last=this.heap.pop()!;this.positions[id]=-1;
  if(this.heap.length){this.heap[0]=last;this.positions[last]=0;let index=0;
   for(;;){const left=index*2+1;if(left>=this.heap.length)break;const right=left+1,child=right<this.heap.length&&this.before(this.heap[right],this.heap[left])?right:left;
    if(!this.before(this.heap[child],this.heap[index]))break;this.swap(index,child);index=child;
   }
  }return id;
 }
}
