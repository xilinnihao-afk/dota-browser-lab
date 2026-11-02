import type {MapData} from '../map-data';
import {MapVision} from './vision';
export interface Point {x:number;y:number}
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Original WPM bit 0x02 forbids walking. Z remains owned by the W3E renderer. */
export class MapNavigation {
  readonly size=64;
  readonly width:number;readonly height:number;
  readonly blocked:Uint8Array;
  private readonly vision:MapVision;
  private source:Uint8Array;private sourceWidth:number;private sourceHeight:number;
  constructor(readonly map:MapData,wpm:ArrayBuffer|Uint8Array,readonly radius=22){
    this.vision=new MapVision(map);
    const b=wpm instanceof Uint8Array?wpm:new Uint8Array(wpm),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(String.fromCharCode(...b.slice(0,4))!=='MP3W')throw new Error('原地图寻路文件格式错误');
    this.sourceWidth=v.getUint32(8,true);this.sourceHeight=v.getUint32(12,true);
    if(b.length!==16+this.sourceWidth*this.sourceHeight||this.sourceWidth!==(map.width-1)*4||this.sourceHeight!==(map.height-1)*4)throw new Error('寻路网格与地图尺寸不符');
    this.source=b.slice(16);this.width=this.sourceWidth/2;this.height=this.sourceHeight/2;
    // Source WPM records terrain; add footprints for placed trees and buildings.
    for(const p of map.placements){const tree=/\/terrain\/.*tree/.test(p.model),base=p.kind==='unit'&&(p.id==='etol'||p.id==='unpl'),building=p.kind==='unit'&&(p.model.startsWith('buildings/')||base);if(!tree&&!building)continue;
      const radius=(tree?38:base?160:105)*Math.max(p.scale[0],p.scale[1]),[x,y]=p.position;
      const cx=Math.floor((x-map.offset[0])/32),cy=Math.floor((y-map.offset[1])/32),r=Math.ceil(radius/32);
      for(let yy=cy-r;yy<=cy+r;yy++)for(let xx=cx-r;xx<=cx+r;xx++)if(xx>=0&&yy>=0&&xx<this.sourceWidth&&yy<this.sourceHeight&&Math.hypot(map.offset[0]+(xx+.5)*32-x,map.offset[1]+(yy+.5)*32-y)<radius)this.source[yy*this.sourceWidth+xx]|=2;
    }
    this.blocked=new Uint8Array(this.width*this.height);
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){const p=this.center(x,y);this.blocked[y*this.width+x]=Number(!this.isFree(p));}
  }
  center(x:number,y:number):Point{return{x:this.map.offset[0]+(x+.5)*this.size,y:this.map.offset[1]+(y+.5)*this.size};}
  cell(p:Point){return{x:Math.floor((p.x-this.map.offset[0])/this.size),y:Math.floor((p.y-this.map.offset[1])/this.size)};}
  lineVisible(a:Point,b:Point){return this.vision.lineVisible(a,b);}
  private rawFree(x:number,y:number){const cx=Math.floor((x-this.map.offset[0])/32),cy=Math.floor((y-this.map.offset[1])/32);return cx>=0&&cy>=0&&cx<this.sourceWidth&&cy<this.sourceHeight&&!(this.source[cy*this.sourceWidth+cx]&2);}
  isFree(p:Point){const r=this.radius;return this.rawFree(p.x,p.y)&&this.rawFree(p.x-r,p.y)&&this.rawFree(p.x+r,p.y)&&this.rawFree(p.x,p.y-r)&&this.rawFree(p.x,p.y+r)&&this.rawFree(p.x-r*.7,p.y-r*.7)&&this.rawFree(p.x+r*.7,p.y+r*.7)&&this.rawFree(p.x-r*.7,p.y+r*.7)&&this.rawFree(p.x+r*.7,p.y-r*.7);}
  private cellFree(x:number,y:number){return x>=0&&y>=0&&x<this.width&&y<this.height&&!this.blocked[y*this.width+x];}
  lineFree(a:Point,b:Point){
    // Visit every crossed WPM cell. Fixed-distance samples can skip a thin
    // blocked interval at a tree corner, producing paths movement cannot follow.
    const r=this.radius;
    for(const [ox,oy]of [[0,0],[-r,0],[r,0],[0,-r],[0,r],[-r*.7,-r*.7],[r*.7,r*.7],[-r*.7,r*.7],[r*.7,-r*.7]]){
      const ax=(a.x+ox-this.map.offset[0])/32,ay=(a.y+oy-this.map.offset[1])/32,bx=(b.x+ox-this.map.offset[0])/32,by=(b.y+oy-this.map.offset[1])/32;
      let x=Math.floor(ax),y=Math.floor(ay);const endX=Math.floor(bx),endY=Math.floor(by),dx=bx-ax,dy=by-ay,sx=Math.sign(dx),sy=Math.sign(dy),stepX=dx?1/Math.abs(dx):Infinity,stepY=dy?1/Math.abs(dy):Infinity;
      let tx=dx?((sx>0?x+1:x)-ax)/dx:Infinity,ty=dy?((sy>0?y+1:y)-ay)/dy:Infinity;
      for(;;){
        if(x<0||y<0||x>=this.sourceWidth||y>=this.sourceHeight||(this.source[y*this.sourceWidth+x]&2))return false;
        if(x===endX&&y===endY)break;
        if(tx<ty){x+=sx;tx+=stepX;}else if(ty<tx){y+=sy;ty+=stepY;}else{x+=sx;y+=sy;tx+=stepX;ty+=stepY;}
      }
    }
    return true;
  }
  nearest(p:Point):Point {if(this.isFree(p))return{...p};const c=this.cell(p);for(let r=0;r<Math.max(this.width,this.height);r++){let best:Point|undefined,d=Infinity;for(let y=c.y-r;y<=c.y+r;y++)for(let x=c.x-r;x<=c.x+r;x++){if(Math.max(Math.abs(x-c.x),Math.abs(y-c.y))!==r||!this.cellFree(x,y))continue;const point=this.center(x,y),value=distance(p,point);if(value<d){d=value;best=point;}}if(best)return best;}throw new Error('地图没有可行走区域');}
  findPath(from:Point,requested:Point):Point[]{
    const goal=this.nearest(requested);if(this.lineFree(from,goal))return[goal];
    const connected=(p:Point)=>{const c=this.cell(p);for(let r=0;r<5;r++)for(let y=c.y-r;y<=c.y+r;y++)for(let x=c.x-r;x<=c.x+r;x++)if(Math.max(Math.abs(x-c.x),Math.abs(y-c.y))===r&&this.cellFree(x,y)&&this.lineFree(p,this.center(x,y)))return{x,y};return null;};
    const a=connected(from),b=connected(goal);if(!a||!b)return[];
    const n=this.width*this.height,start=a.y*this.width+a.x,end=b.y*this.width+b.x,g=new Float32Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap:{id:number;f:number}[]=[];
    const push=(id:number,f:number)=>{let i=heap.length;heap.push({id,f});while(i){const p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;}heap[i]={id,f};};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first.id;};
    const h=(x:number,y:number)=>{const dx=Math.abs(b.x-x),dy=Math.abs(b.y-y);return Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy);};
    g[start]=0;push(start,h(a.x,a.y));let visited=0;
    while(heap.length&&visited++<24000){const id=pop();if(closed[id])continue;closed[id]=1;if(id===end){const raw:Point[]=[goal];let at=id;while(at!==start&&at>=0){raw.push(this.center(at%this.width,Math.floor(at/this.width)));at=parent[at];}raw.push(this.center(a.x,a.y));raw.reverse();const result:Point[]=[];let anchor=from;for(let i=0;i<raw.length;){let far=i;while(far+1<raw.length&&this.lineFree(anchor,raw[far+1]))far++;result.push(raw[far]);anchor=raw[far];i=far+1;}return result;}
      const x=id%this.width,y=Math.floor(id/this.width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,ni=ny*this.width+nx;if(!this.cellFree(nx,ny)||closed[ni]||(dx&&dy&&(!this.cellFree(x+dx,y)||!this.cellFree(x,y+dy))))continue;if(!this.lineFree(this.center(x,y),this.center(nx,ny)))continue;const ng=g[id]+(dx&&dy?Math.SQRT2:1);if(ng<g[ni]){g[ni]=ng;parent[ni]=id;push(ni,ng+h(nx,ny));}}
    }return[];
  }
}
