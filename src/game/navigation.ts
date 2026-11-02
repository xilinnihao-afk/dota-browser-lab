import { HALF_MAP, MAP_SIZE, walkableSurface } from './map';
import type { MapDefinition, Point } from './types';

/** Static navigation is independent of renderer and reproducible on a server. */
export class Navigation {
  readonly cellSize = 1.2;
  readonly width = Math.round(MAP_SIZE / this.cellSize);
  readonly blocked: Uint8Array;
  constructor(readonly map: MapDefinition, readonly radius = .7) {
    this.blocked = new Uint8Array(this.width * this.width);
    for (let z=0;z<this.width;z++) for(let x=0;x<this.width;x++) {
      const p=this.center(x,z);
      this.blocked[z*this.width+x] = this.isFree(p.x,p.z) ? 0 : 1;
    }
  }
  isFree(x: number, z: number, radius = this.radius): boolean {
    return walkableSurface(x,z,radius) && !this.map.obstacles.some(o=>(o.x-x)**2+(o.z-z)**2<(o.radius+radius)**2);
  }
  center(x: number,z: number): Point { return {x:(x+.5)*this.cellSize-HALF_MAP,z:(z+.5)*this.cellSize-HALF_MAP}; }
  cell(p: Point) { return {x:Math.max(0,Math.min(this.width-1,Math.floor((p.x+HALF_MAP)/this.cellSize))),z:Math.max(0,Math.min(this.width-1,Math.floor((p.z+HALF_MAP)/this.cellSize)))}; }
  private isCellFree(x:number,z:number):boolean {return x>=0 && z>=0 && x<this.width && z<this.width && !this.blocked[z*this.width+x];}
  lineFree(a: Point,b: Point): boolean {
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.3));
    for(let i=0;i<=steps;i++){const t=i/steps;if(!this.isFree(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t)) return false;}
    return true;
  }
  nearestFree(p:Point): Point {
    if(this.isFree(p.x,p.z)) return {...p};
    const c=this.cell(p);
    for(let r=0;r<this.width;r++) {
      let best:Point|null=null, distance=Infinity;
      for(let z=c.z-r;z<=c.z+r;z++) for(let x=c.x-r;x<=c.x+r;x++) {
        if(Math.max(Math.abs(x-c.x),Math.abs(z-c.z))!==r || !this.isCellFree(x,z)) continue;
        const v=this.center(x,z),d=Math.hypot(v.x-p.x,v.z-p.z);
        if(d<distance){best=v;distance=d;}
      }
      if(best) return best;
    }
    return {x:0,z:0};
  }
  findPath(from: Point, requested: Point): Point[] {
    const goal=this.nearestFree(requested);
    if(this.lineFree(from,goal)) return [goal];
    // A free continuous position can lie in a cell whose center is obstructed.
    // Connect both endpoints to a center through a verified free segment.
    const connectedCell=(point:Point)=>{
      const base=this.cell(point);
      for(let r=0;r<5;r++)for(let z=base.z-r;z<=base.z+r;z++)for(let x=base.x-r;x<=base.x+r;x++){
        if(Math.max(Math.abs(x-base.x),Math.abs(z-base.z))!==r||!this.isCellFree(x,z))continue;
        if(this.lineFree(point,this.center(x,z)))return {x,z};
      }
      return null;
    };
    const start=connectedCell(from),end=connectedCell(goal),n=this.width*this.width;
    if(!start||!end)return [];
    const startId=start.z*this.width+start.x, endId=end.z*this.width+end.x;
    const g=new Float64Array(n).fill(Infinity),parents=new Int32Array(n).fill(-1),closed=new Uint8Array(n);
    const heap: {id:number;f:number}[]=[];
    const push=(id:number,f:number)=>{let i=heap.length;heap.push({id,f});while(i>0){const p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;}heap[i]={id,f};};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length && heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first.id;};
    const h=(x:number,z:number)=>{const dx=Math.abs(end.x-x),dz=Math.abs(end.z-z);return Math.max(dx,dz)+(Math.SQRT2-1)*Math.min(dx,dz);};
    g[startId]=0;push(startId,h(start.x,start.z));
    while(heap.length) {
      const id=pop();if(closed[id])continue;closed[id]=1;
      if(id===endId) {
        const raw:Point[]=[];let p=id;
        while(p!==startId && p!==-1){raw.push(this.center(p%this.width,Math.floor(p/this.width)));p=parents[p];}
        raw.push(this.center(start.x,start.z));raw.reverse();raw.push(goal);
        const result:Point[]=[];let anchor=from,index=0;
        while(index<raw.length){let far=index;while(far+1<raw.length && this.lineFree(anchor,raw[far+1]))far++;result.push(raw[far]);anchor=raw[far];index=far+1;}
        return result;
      }
      const x=id%this.width,z=Math.floor(id/this.width);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dz)continue;const nx=x+dx,nz=z+dz;
        if(!this.isCellFree(nx,nz) || (dx&&dz&&(!this.isCellFree(x+dx,z)||!this.isCellFree(x,z+dz))))continue;
        // Circle obstacles may intersect the edge even when both centers are free.
        if(!this.lineFree(this.center(x,z),this.center(nx,nz)))continue;
        const ni=nz*this.width+nx;if(closed[ni])continue;
        const ng=g[id]+(dx&&dz?Math.SQRT2:1);
        if(ng<g[ni]){g[ni]=ng;parents[ni]=id;push(ni,ng+h(nx,nz));}
      }
    }
    return [];
  }
}
