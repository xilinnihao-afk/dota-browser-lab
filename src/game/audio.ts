import type { GameEvent } from './types';
/** Original, synthesized prototype feedback. No external recordings or assets. */
export class GameAudio {
  muted=false;
  private context:AudioContext|null=null;
  private gain:GainNode|null=null;
  unlock(){if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=.14;this.gain.connect(this.context.destination);}if(this.context.state==='suspended')void this.context.resume().catch(()=>{});}
  toggle(){this.muted=!this.muted;}
  event(event:GameEvent){
    if(this.muted||!this.context||this.context.state!=='running'||!this.gain)return;
    const notes:Partial<Record<GameEvent['type'],[number,number,number]>>={command:[480,300,.045],hit:[155,60,.1],kill:[480,780,.18],win:[620,960,.5],lose:[180,70,.45]};
    const note=notes[event.type];if(!note)return;
    const osc=this.context.createOscillator(),env=this.context.createGain(),now=this.context.currentTime;
    osc.type=event.type==='hit'?'triangle':'sine';osc.frequency.setValueAtTime(note[0],now);osc.frequency.exponentialRampToValueAtTime(note[1],now+note[2]);
    env.gain.setValueAtTime(.0001,now);env.gain.linearRampToValueAtTime(event.type==='command'?.15:.5,now+.008);env.gain.exponentialRampToValueAtTime(.0001,now+note[2]);
    osc.connect(env).connect(this.gain);osc.start(now);osc.stop(now+note[2]+.02);osc.onended=()=>{osc.disconnect();env.disconnect();};
  }
  dispose(){void this.context?.close();}
}
