import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../src/classic/battle/audio';
import type {CombatEvent} from '../src/classic/battle/simulation';

// Exercise real event routing and async cancellation; only the browser's
// WebAudio/fetch boundary is substituted. Native WAV decoding is checked in UI.
class Node {
  gain={value:0};pan={value:0};playbackRate={value:0};buffer:unknown;onended?:()=>void;
  connect(){}disconnect(){}start(){}stop(){this.onended?.();}
  getFloatTimeDomainData(samples:Float32Array){samples.fill(.1);}
}
class Context {
  state='running';destination=new Node();sampleRate=44100;
  createBuffer(){return {};}
  async decodeAudioData(){return {};}
  createGain(){return new Node();}createAnalyser(){return new Node();}createStereoPanner(){return new Node();}createBufferSource(){return new Node();}
  async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const death=(id:number,heroId:'axe'|'maiden'|'juggernaut',target='hero',x=0):CombatEvent=>({id,kind:'kill',heroId,target,x,y:0});
test('hero death cues deduplicate, preempt a full combat mixer and respect distance, mute, pause and restart',async t=>{
  let now=0;t.mock.method(performance,'now',()=>now+=300);
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(8)));
  const original=globalThis.AudioContext;globalThis.AudioContext=Context as unknown as typeof AudioContext;
  t.after(()=>{globalThis.AudioContext=original;});
  const audio=await createBattleAudio();t.after(()=>audio.dispose());audio.unlock();await flush();
  for(let i=0;i<20;i++){audio.event({id:i,kind:'impact',x:0,y:0},{x:0,y:0});await flush();}
  assert.equal(audio.diagnostics.active,20);audio.event(death(50,'axe'),{x:0,y:0});audio.event(death(50,'axe'),{x:0,y:0});await flush();
  assert.equal(audio.diagnostics.playedById.axe_death,1);assert.equal(audio.diagnostics.active,20);
  audio.clear();audio.event(death(51,'maiden','rival',3000),{x:0,y:0});await flush();assert.equal(audio.diagnostics.playedById.maiden_death,undefined);
  audio.event(death(52,'maiden','rival',300),{x:0,y:0});await flush();assert.equal(audio.diagnostics.playedById.maiden_death,1);
  audio.toggle();audio.event(death(53,'maiden'),{x:0,y:0});await flush();assert.equal(audio.diagnostics.active,0);assert.equal(audio.diagnostics.playedById.maiden_death,1);
  audio.toggle();audio.event(death(54,'juggernaut'),{x:0,y:0});audio.setPaused(true);await flush();assert.equal(audio.diagnostics.playedById.juggernaut_death,undefined);
  audio.setPaused(false);audio.event(death(55,'juggernaut'),{x:0,y:0});await flush();assert.equal(audio.diagnostics.playedById.juggernaut_death,1);
  audio.clear();audio.event(death(55,'juggernaut'),{x:0,y:0});await flush();assert.equal(audio.diagnostics.playedById.juggernaut_death,2,'event IDs may restart in a new match');
});


test('the first hero cue waits for asynchronous mobile resume instead of disappearing',async t=>{
  let finish=()=>{};
  class MobileContext extends Context {
    state='suspended';
    resume(){return new Promise<void>(resolve=>{finish=()=>{this.state='running';resolve();};});}
  }
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(8)));
  const original=globalThis.AudioContext;globalThis.AudioContext=MobileContext as unknown as typeof AudioContext;
  t.after(()=>{globalThis.AudioContext=original;});
  const audio=await createBattleAudio();t.after(()=>audio.dispose());
  audio.voice('juggernaut','select');await flush();assert.equal(audio.diagnostics.played,0);
  finish();await flush();assert.equal(audio.diagnostics.playedById.juggernaut_select,1);
});

test('the sound button retries a blocked context without switching the user to mute',async t=>{
  class BlockedContext extends Context {state='suspended';async resume(){throw new Error('Gesture required');}}
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(8)));
  const original=globalThis.AudioContext;globalThis.AudioContext=BlockedContext as unknown as typeof AudioContext;
  t.after(()=>{globalThis.AudioContext=original;});
  const audio=await createBattleAudio();t.after(()=>audio.dispose());audio.unlock();await flush();
  assert.equal(audio.toggle(),false);assert.equal(audio.muted,false);
});


test('Safari fallback, gesture priming, interrupted recovery and session ownership respect mute and disposal',async t=>{
  let ctx:SafariContext;const order:string[]=[],session={type:'ambient'};
  class SafariContext extends Context {
    state='suspended';onstatechange?:()=>void;
    constructor(){super();ctx=this;}
    resume(){order.push('resume');this.state='running';return Promise.resolve();}
    createBufferSource(){const source=new Node();source.start=()=>{order.push('start');};return source;}
  }
  const globals=globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext};
  const originals=new Map(['AudioContext','webkitAudioContext','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globals,key)]));
  Object.defineProperty(globals,'AudioContext',{value:undefined,writable:true,configurable:true});
  Object.defineProperty(globals,'webkitAudioContext',{value:SafariContext,writable:true,configurable:true});
  Object.defineProperty(globals,'navigator',{value:{audioSession:session},configurable:true});
  t.after(()=>{for(const[key,value]of originals){if(value)Object.defineProperty(globals,key,value);else Reflect.deleteProperty(globals,key);}});
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(8)));
  const audio=await createBattleAudio();t.after(()=>audio.dispose());
  const handlers=new Map<string,(event:unknown)=>void>();
  const target={addEventListener:(type:string,fn:(event:unknown)=>void)=>handlers.set(type,fn),removeEventListener:(type:string)=>handlers.delete(type)} as unknown as EventTarget;
  audio.bindGestures(target);
  handlers.get('touchend')!({isTrusted:true,target:null});
  assert.deepEqual(order,['resume','start'],'both calls occur synchronously in the gesture');
  await flush();assert.equal(session.type,'playback');assert.equal(audio.buttonLabel,'音效：开');
  audio.voice('juggernaut','select');await flush();assert.equal(audio.diagnostics.active,1);
  ctx!.state='interrupted';ctx!.onstatechange?.();assert.equal(audio.diagnostics.active,0);assert.equal(session.type,'ambient');assert.equal(audio.buttonLabel,'恢复声音');
  handlers.get('pointerup')!({isTrusted:true,target:null});await flush();assert.equal(ctx!.state,'running');assert.equal(session.type,'playback');
  assert.equal(audio.toggle(),true);assert.equal(session.type,'ambient');const count=order.length;
  handlers.get('touchend')!({isTrusted:true,target:null});assert.equal(order.length,count);assert.equal(audio.muted,true);
  audio.toggle();await flush();assert.equal(session.type,'playback');
  audio.setPaused(true);assert.equal(session.type,'ambient');assert.equal(audio.toggle(),true);assert.equal(audio.toggle(),false);audio.setPaused(false);await flush();assert.equal(session.type,'playback');
  audio.dispose();assert.equal(session.type,'ambient');assert.equal(handlers.size,0);assert.equal(ctx!.state,'closed');
});

test('pause cancels a cue waiting for resume; unsupported audio does not break gameplay',async t=>{
  let finish=()=>{};
  class PendingContext extends Context {state='suspended';resume(){return new Promise<void>(resolve=>{finish=()=>{this.state='running';resolve();};});}}
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(8)));
  const original=globalThis.AudioContext;globalThis.AudioContext=PendingContext as unknown as typeof AudioContext;
  t.after(()=>{globalThis.AudioContext=original;});
  const audio=await createBattleAudio();t.after(()=>audio.dispose());audio.voice('axe','select');audio.setPaused(true);finish();await flush();assert.equal(audio.diagnostics.played,0);
  globalThis.AudioContext=undefined as unknown as typeof AudioContext;
  const unavailable=await createBattleAudio();t.after(()=>unavailable.dispose());assert.equal(await unavailable.unlock(),false);assert.match(unavailable.diagnostics.unlockError,/不支持/);
});
