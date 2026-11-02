import {installLayout,setSafeInsets,resetSafeInsets} from './layout';
type Host={launchOptions?:{miniToolEnv?:{buildVersion?:number}};miniTool?:Record<string,any>};
const host=()=>((window as any).xhs??{})as Host;
const values=new Map<string,string>();let version=0,native=false,writes=Promise.resolve();
export const storage={getItem:(key:string)=>values.get(key)??null,setItem(key:string,value:string){values.set(key,value);if(native)writes=writes.then(()=>host().miniTool!.setStorage({key,data:JSON.stringify(value)})).catch(()=>{});else try{localStorage.setItem(key,value);}catch{}}};
export async function bootstrap(){
 let launch=host().launchOptions;try{if(!launch&&typeof host().miniTool?.getLaunchOptions==='function')launch=await host().miniTool!.getLaunchOptions();}catch{}
 version=Math.floor(Number(launch?.miniToolEnv?.buildVersion??0)/1000);
 const api=host().miniTool;native=version>=9460&&typeof api?.getStorage==='function'&&typeof api?.setStorage==='function';
 const key='dota-mobile-quality';try{if(native){const data=(await api!.getStorage({key})).data;if(data!=null)values.set(key,JSON.parse(data));}else{const value=localStorage.getItem(key);if(value)values.set(key,value);}}catch{}
 installLayout();await updateWindow();window.addEventListener('resize',()=>{void updateWindow();});
 const flex=document.createElement('div');flex.style.cssText='position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';flex.append(document.createElement('div'),document.createElement('div'));document.body.appendChild(flex);document.documentElement.classList.toggle('no-flex-gap',flex.scrollHeight!==1);flex.remove();
}
let ticket=0;
async function updateWindow(){
 const current=++ticket;resetSafeInsets();
 const api=host().miniTool;if(version<9490||typeof api?.getWindowInfo!=='function')return;
 try{const info=await api.getWindowInfo();if(current!==ticket||!(info.windowWidth>0)||!(info.windowHeight>0))return;const scale=innerWidth/info.windowWidth;let top=info.safeArea?.top??0;
  for(const r of Object.values(info.menuButtons??{})as any[])if(r)top=Math.max(top,r.bottom+6);
  const safe=info.safeArea;
  setSafeInsets({top:Math.max(0,(safe?.top??0)*scale),left:Math.max(0,(safe?.left??0)*scale),right:Math.max(0,(info.windowWidth-(safe?.right??info.windowWidth))*scale),bottom:Math.max(0,(info.windowHeight-(safe?.bottom??info.windowHeight))*scale)},Math.max(0,top*scale));
 }catch{/* CSS safe-area values remain the fallback. */}
}
