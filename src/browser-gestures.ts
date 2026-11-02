/** Keep rapid clicks available to the game while cancelling native double-tap zoom. */
export function installBrowserGestureGuard(target:EventTarget):()=>void{
  const cancelZoom=(event:Event)=>{if(event.cancelable)event.preventDefault();};
  target.addEventListener('dblclick',cancelZoom,{capture:true,passive:false});
  return ()=>target.removeEventListener('dblclick',cancelZoom,{capture:true});
}
