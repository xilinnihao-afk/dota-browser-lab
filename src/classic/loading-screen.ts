import {gameViewport} from './viewport';
import './loading-screen.css';

let current:ReturnType<typeof createLoadingScreen>|undefined;
export function mapLoading(){return current??=createLoadingScreen();}

function createLoadingScreen(){
  const root=document.createElement('section');root.className='map-loading';root.setAttribute('aria-label','载入 IMBA 3.83d AI');
  root.innerHTML=`<div class="loading-art" aria-hidden="true"><img src="${import.meta.env.BASE_URL}assets/presentation/dota-heroes.jpg" alt="" fetchpriority="high"><img src="${import.meta.env.BASE_URL}assets/presentation/dota-allstars.jpg" alt=""></div>
    <div class="loading-vignette"></div><div class="loading-caption"><span>WARCRAFT III · DEFENSE OF THE ANCIENTS</span><h1>IMBA <small>3.83d AI</small></h1><p>近卫与天灾 · 战火再起</p></div>
    <div class="loading-footer"><div class="loading-progress-heading"><span id="load-stage" role="status">正在读取原地图</span><strong id="load-percent">0%</strong></div><progress id="load-progress" max="100" value="0" aria-label="游戏加载进度"></progress><p class="loading-tip">WASD 移动 · 左键点击敌军攻击 · 按住左键拖动地图</p><button class="loading-retry" hidden>重新加载</button></div>`;
  document.body.append(root);
  if(matchMedia('(any-pointer: coarse)').matches||gameViewport.width<=900)root.querySelector('.loading-tip')!.textContent='建议横屏 · 左侧摇杆移动 · 右侧技能拖动瞄准，松手释放';
  const progress=root.querySelector('progress')!,percent=root.querySelector<HTMLElement>('#load-percent')!,stage=root.querySelector<HTMLElement>('#load-stage')!;
  let value=0,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
  const set=(next:number,message:string)=>{if(finished)return;value=Math.max(value,Math.min(100,Math.floor(next)));progress.value=value;percent.textContent=`${value}%`;stage.textContent=message;};
  root.querySelector<HTMLButtonElement>('.loading-retry')!.onclick=()=>location.reload();
  return {set,complete(){set(100,'准备就绪');finished=true;timer=setTimeout(()=>{root.remove();},250);},fail(error:unknown){if(timer)clearTimeout(timer);finished=true;root.classList.add('loading-failed');stage.textContent='加载未完成，请重试';const tip=root.querySelector<HTMLElement>('.loading-tip')!;tip.textContent=error instanceof Error?error.message:String(error);root.querySelector<HTMLButtonElement>('.loading-retry')!.hidden=false;},dispose(){if(timer)clearTimeout(timer);root.remove();}};
}
