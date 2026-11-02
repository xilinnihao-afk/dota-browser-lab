// W3E corner: final Z, water Z, ground tile, variation, cliff level,
// cliff texture, cliff variation, ramp, blight, water, raw ground Z, boundary.
export type Corner = [number,number,number,number,number,number,number,number,number,number,number,number];
export interface Placement {
  kind:'doodad'|'unit';id:string;model:string;position:[number,number,number];angle:number;
  scale:[number,number,number];color:[number,number,number];team:number;replacements:Record<number,string>;
  sequence:string;moveHeight?:number;editorId?:number;sourceLine?:number;
  splat?:{path:string;scale:number};
}
export interface MapData {
  source:{name:string;file:string;sha256:string};width:number;height:number;offset:[number,number];
  tiles:{id:string;path:string;width:number;height:number}[];
  cliffs:{id:string;path:string;modelDir:string;ground:number}[];
  water:{paths:string[];height:number;rate:number;parameters:Record<string,string>;baseColor:number[]};
  corners:Corner[];cliffInstances:{x:number;y:number;sx?:number;sy?:number;base:number;type:number;path:string}[];rampTiles:number[];
  rampInstances:{x:number;y:number;sx:number;sy:number;base:number;type:number;path:string;cells:number[]}[];rampCells:number[];raisedRampCorners:number[];
  lighting:{terrain:string;unit:string;initialHour:number;timeScale:number};
  placements:Placement[];resources:string[];
  stats:{sourceDoodads:number;visibleDoodads:number;units:number;cliffs:number;ramps:number;rampTransitions:number};
  missing:{path?:string;reason:string}[];
  shadow?:{path:string;width:number;height:number};
}
export function cornerAt(map:MapData,x:number,y:number){return map.corners[Math.max(0,Math.min(map.height-1,y))*map.width+Math.max(0,Math.min(map.width-1,x))];}
export function heightAt(map:MapData,x:number,y:number,raw=false){
  const gx=Math.max(0,Math.min(map.width-1.0001,(x-map.offset[0])/128));
  const gy=Math.max(0,Math.min(map.height-1.0001,(y-map.offset[1])/128));
  const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,k=raw?10:0;
  const a=cornerAt(map,ix,iy)[k],b=cornerAt(map,ix+1,iy)[k],c=cornerAt(map,ix,iy+1)[k],d=cornerAt(map,ix+1,iy+1)[k];
  return raw?(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy:
    fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
}
export function atlasCell(variation:number,extended:boolean){
  const index=extended?(variation<16?16+variation:variation===16?15:0):(variation===0?0:15);
  return [index<16?index%4:4+(index-16)%4,index<16?Math.floor(index/4):Math.floor((index-16)/4)];
}
