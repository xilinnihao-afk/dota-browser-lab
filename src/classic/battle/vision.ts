import {heightAt,type MapData} from '../map-data';
import {distance,type Point} from './navigation';

/** Sight is separate from walking: water and pathing-only cells do not hide units. */
export class MapVision {
  private readonly width:number;
  private readonly height:number;
  private readonly opaque:Uint8Array;
  constructor(private readonly map:MapData){
    this.width=(map.width-1)*4;this.height=(map.height-1)*4;
    this.opaque=new Uint8Array(this.width*this.height);
    for(const p of map.placements){
      const tree=/\/terrain\/.*tree/.test(p.model),base=p.kind==='unit'&&(p.id==='etol'||p.id==='unpl');
      if(!tree&&!(p.kind==='unit'&&(p.model.startsWith('buildings/')||base)))continue;
      const radius=(tree?38:base?160:105)*Math.max(p.scale[0],p.scale[1]),[x,y]=p.position;
      const cx=Math.floor((x-map.offset[0])/32),cy=Math.floor((y-map.offset[1])/32),r=Math.ceil(radius/32);
      for(let yy=cy-r;yy<=cy+r;yy++)for(let xx=cx-r;xx<=cx+r;xx++){
        if(xx>=0&&yy>=0&&xx<this.width&&yy<this.height&&Math.hypot(map.offset[0]+(xx+.5)*32-x,map.offset[1]+(yy+.5)*32-y)<radius)this.opaque[yy*this.width+xx]=1;
      }
    }
  }
  lineVisible(a:Point,b:Point){
    const steps=Math.ceil(distance(a,b)/16),az=heightAt(this.map,a.x,a.y)+90,bz=heightAt(this.map,b.x,b.y)+90;
    for(let i=1;i<steps;i++){
      const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
      const cx=Math.floor((x-this.map.offset[0])/32),cy=Math.floor((y-this.map.offset[1])/32);
      if(cx<0||cy<0||cx>=this.width||cy>=this.height||this.opaque[cy*this.width+cx])return false;
      if(heightAt(this.map,x,y)>az+(bz-az)*t)return false;
    }
    return true;
  }
}
