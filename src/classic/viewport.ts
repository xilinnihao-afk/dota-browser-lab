/** Logical game coordinates. Only the minitool enables the rotated stage. */
let rotated=false;
export const gameViewport={get width(){return rotated?innerHeight:innerWidth;},get height(){return rotated?innerWidth:innerHeight;},get rotated(){return rotated;}};
export function setGameRotation(value:boolean){rotated=value;}
export function rotatePoint(x:number,y:number,physicalWidth:number,turn:boolean){return turn?{x:y,y:physicalWidth-x}:{x,y};}
export function rotateRect(r:{left:number;top:number;width:number;height:number},physicalWidth:number,turn:boolean){
 const left=turn?r.top:r.left,top=turn?physicalWidth-r.left-r.width:r.top,width=turn?r.height:r.width,height=turn?r.width:r.height;
 return {left,top,width,height,right:left+width,bottom:top+height};
}
export function gamePoint(e:{clientX:number;clientY:number}){return rotatePoint(e.clientX,e.clientY,innerWidth,rotated);}
export function gameRect(element:Element){return rotateRect(element.getBoundingClientRect(),innerWidth,rotated);}
// OrbitControls also creates plain objects from coordinates already normalized
// by its native event handlers. Those internal events must not rotate twice.
export function gameControlPoint(e:any,kind:'client'|'page'='client'){
 const x=e[kind+'X'],y=e[kind+'Y'];return rotatePoint(x,y,innerWidth,rotated&&e instanceof Event);
}
