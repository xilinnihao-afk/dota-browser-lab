interface Box {top:number;bottom:number;width:number;height:number}
/** display:contents / display:none have no box and cannot occlude the field. */
export function labelBounds(height:number,hud?:Box|null,top?:Box|null){
 const hasBox=(r?:Box|null)=>!!r&&r.width>0&&r.height>0;
 return {bottom:hasBox(hud)?Math.min(height,hud!.top)-10:height-10,top:hasBox(top)?Math.max(0,top!.bottom)+12:12};
}
export function labelVisible(hp:number,x:number,y:number,z:number,width:number,bounds:{top:number;bottom:number}){
 return hp>0&&z>=-1&&z<1&&x>0&&x<width&&y>bounds.top&&y<bounds.bottom;
}
