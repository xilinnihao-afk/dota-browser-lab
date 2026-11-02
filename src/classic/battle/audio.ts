import {assets,type HeroId} from './definitions';
import type {CombatEvent} from './simulation';
import type {Point} from './navigation';

export async function createBattleAudio(){
  const files=await Promise.all(Object.entries(assets.audio).map(async([id,path])=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}assets/imba/resources/${path}`);
    if(!response.ok)throw new Error(`缺少原版音效：${path}`);
    return [id,await response.arrayBuffer()]as const;
  }));
  let context:AudioContext|undefined,master:GainNode|undefined,analyser:AnalyserNode|undefined;
  let muted=false,paused=false,disposed=false,epoch=0,played=0,peak=0,decoded=0;
  const buffers=new Map<string,Promise<AudioBuffer>>(),sources=new Set<AudioBufferSourceNode>(),last=new Map<string,number>(),failures:string[]=[];
  const playing=new Map<AudioBufferSourceNode,{id:string;priority:number}>(),playedById:Record<string,number>={},deaths=new Set<number>();
  let ready=Promise.resolve(false),unlockError='',primed=false,primer:AudioBufferSourceNode|undefined;
  let session:{type:string}|undefined,previousSession='',removeGestures=()=>{};
  function playbackSession(active:boolean){
    try{
      if(active&&!session){const value=(globalThis.navigator as Navigator&{audioSession?:{type:string}}|undefined)?.audioSession;if(value){previousSession=value.type;value.type='playback';session=value;}}
      else if(!active&&session){if(session.type==='playback')session.type=previousSession;session=undefined;}
    }catch{/* Older WebViews may expose a read-only audio session. */}
  }
  function stopPrimer(){const source=primer;primer=undefined;if(source){try{source.stop();}catch{}source.disconnect();}}
  function unlock(){
    if(disposed||muted||paused)return Promise.resolve(false);
    try{
    playbackSession(true);
    if(!context||context.state==='closed'){
      const Audio=globalThis.AudioContext??(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Audio)throw new Error('当前浏览器不支持游戏声音');
      clear();buffers.clear();decoded=0;primed=false;
      context=new Audio({latencyHint:'interactive'});master=context.createGain();master.gain.value=.55;analyser=context.createAnalyser();analyser.fftSize=256;master.connect(analyser);analyser.connect(context.destination);
      const ctx=context;
      ctx.onstatechange=()=>{if(ctx!==context||disposed)return;if(ctx.state==='running')unlockError='';else {clear();playbackSession(false);}};
      for(const[id,data]of files)buffers.set(id,context.decodeAudioData(data.slice(0)).then(buffer=>{decoded++;return buffer;}).catch(error=>{failures.push(id+': '+String(error));throw error;}));
      // Record decode failures without leaving a rejected preload promise unhandled.
      for(const buffer of buffers.values())void buffer.catch(()=>{});
    }
    const ctx=context,needsResume=ctx.state!=='running';
    // Resume and start a silent frame in the actual gesture, before any await.
    // Retry on touch release as well: touch pointerdown alone may not activate iOS.
    const resumed=needsResume?ctx.resume():Promise.resolve();
    ready=new Promise<boolean>(resolve=>{
      const timer=setTimeout(()=>{if(ctx.state!=='running')unlockError='请轻触开启声音';resolve(false);},1500);
      Promise.resolve(resumed).then(()=>{clearTimeout(timer);const running=!disposed&&!muted&&!paused&&ctx===context&&ctx.state==='running';if(running)unlockError='';resolve(running);},error=>{clearTimeout(timer);unlockError=String(error);resolve(false);});
    });
    if(needsResume||!primed){
      stopPrimer();const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,ctx.sampleRate);source.connect(master!);
      primer=source;source.onended=()=>{source.disconnect();if(primer===source)primer=undefined;};source.start(0);primed=true;
    }
    return ready;
    }catch(error){unlockError=String(error);playbackSession(false);return ready=Promise.resolve(false);}
  }
  function bindGestures(target:EventTarget){
    removeGestures();
    const gesture=(event:Event)=>{
      const element=event.target as Element|null;
      if(event.isTrusted===false||element?.closest?.('ihca-feedback,input,textarea,select,[contenteditable="true"],#battle-sound'))return;
      if(!context||context.state!=='running')void unlock();
    };
    const events=['pointerdown','pointerup','touchend','click','keydown'];
    for(const type of events)target.addEventListener(type,gesture,{capture:true,passive:true});
    removeGestures=()=>{for(const type of events)target.removeEventListener(type,gesture,true);};
    return removeGestures;
  }
  function play(id:string,volume=.6,point?:Point,listener?:Point,gate=.12,rate=1,priority=0){
    if(disposed||paused||muted||!context||!master||!buffers.has(id))return;
    const now=performance.now()/1000;if(now-(last.get(id)??-Infinity)<gate)return;last.set(id,now);
    const distance=point&&listener?Math.hypot(point.x-listener.x,point.y-listener.y):0,attenuation=Math.max(0,1-distance/2600),panning=point&&listener?Math.max(-.75,Math.min(.75,(point.x-listener.x)/1600)):0;
    const generation=epoch,ctx=context;void Promise.all([buffers.get(id)!,ready]).then(([buffer,running])=>{
      if(!running||disposed||paused||muted||generation!==epoch||ctx.state!=='running'||attenuation<=0||performance.now()/1000-now>1.5)return;
      if(priority===2){const hero=id.split('_')[0];for(const[s,info]of playing)if(info.id.startsWith(hero+'_')){s.stop();sources.delete(s);playing.delete(s);}}
      if(sources.size>=20){const victim=[...playing].find(([,info])=>info.priority<priority)?.[0];if(!victim)return;victim.stop();sources.delete(victim);playing.delete(victim);}
      const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=volume*attenuation;pan.pan.value=panning;
      source.connect(gain);gain.connect(pan);pan.connect(master!);sources.add(source);playing.set(source,{id,priority});source.onended=()=>{sources.delete(source);playing.delete(source);source.disconnect();gain.disconnect();pan.disconnect();};source.start();played++;playedById[id]=(playedById[id]??0)+1;
    }).catch(()=>{});
  }
  function event(e:CombatEvent,listener:Point){
    if(e.kind==='kill'&&e.heroId){
      if(deaths.has(e.id))return;deaths.add(e.id);if(deaths.size>128)deaths.delete(deaths.values().next().value!);
      // New heroes retain neutral combat feedback until their own voice assets are available.
      const voice=`${e.heroId}_death`;
      play(voice in assets.audio?voice:'rockHit',voice in assets.audio?1:.5,e.target==='hero'?undefined:e,listener,0,1,2);
    }
    else if(e.kind==='gold'||e.kind==='purchase')play('gold',.55,undefined,undefined,.25);
    else if(e.kind==='level')play('level',.6,undefined,undefined,1);
    else if(e.kind==='spell'){const key=e.effect==='frost'||e.effect==='blizzard'?'frost':e.effect==='stomp'||e.effect==='impact'?'stomp':e.effect==='ward'||e.effect==='heal'?'heal':'stomp';if(key)play(key,.35,e,listener,.35);}
    else if(e.kind==='attack'&&(e.effect==='rock'||e.effect==='spirit'))play('rockHit',.28,e,listener,.22);
    else if(e.kind==='impact'){
      const id=e.effect==='impact'?'rockHit':e.effect==='frost'?'frost':'hit';
      // Contact audio follows damage, not mouse presses or the windup. Keep
      // the original slices distinct from the frost missile's icy impact.
      play(id,e.source==='hero'?(id==='frost'?.28:.42):.15,e,listener,.08,e.effect==='axe'?.86:e.effect==='blade'?1.08:1);
    }
  }
  function clear(){epoch++;last.clear();deaths.clear();stopPrimer();for(const source of sources)try{source.stop();}catch{}sources.clear();playing.clear();}
  return {unlock,bindGestures,event,voice(hero:HeroId,action:'select'|'move'|'attack'){void unlock();play(`${hero}_${action}`,.8,undefined,undefined,2.1,1,1);},clear,
    toggle(){if(!muted&&!paused&&(!context||context.state!=='running')){void unlock();return false;}muted=!muted;if(master)master.gain.value=muted?0:.55;if(muted){clear();playbackSession(false);}else void unlock();return muted;},
    setPaused(value:boolean){if(paused===value)return;paused=value;if(value){clear();playbackSession(false);void context?.suspend().catch(()=>{});}else if(context)void unlock();},
    get muted(){return muted;},get buttonLabel(){return muted?'音效：关':!context?'开启声音':context.state==='running'||paused?'音效：开':'恢复声音';},
    get diagnostics(){if(analyser){const samples=new Float32Array(256);analyser.getFloatTimeDomainData(samples);peak=Math.max(peak,...samples.map(Math.abs));}return {state:context?.state??'locked',decoded,total:files.length,played,playedById:{...playedById},active:sources.size,muted,peak,unlockError,session:session?.type??'default',failures:[...failures]};},
    dispose(){disposed=true;removeGestures();clear();playbackSession(false);void context?.close().catch(()=>{});buffers.clear();}
  };
}
