import { Matrix4, Quaternion, Vector3 } from 'three';
import type { model } from 'war3-model';

export interface AnimationClock {
  frame: number;
  interval: ArrayLike<number>;
  elapsed: number;
  globalSequences: number[];
  nonLooping?: boolean;
}

/** MDX tracks only contribute keys within the active sequence. A missing track
 * uses the property's default, never a key from a different animation. */
export function sampleTrack(track: model.AnimVector | undefined, clock: AnimationClock,
  fallback: readonly number[], rotation = false): number[] {
  if (!track?.Keys.length) return [...fallback];
  let [from, to] = Array.from(clock.interval), frame = clock.frame;
  if (typeof track.GlobalSeqId === 'number') {
    from = 0;
    to = clock.globalSequences[track.GlobalSeqId] ?? 0;
    if(to<=0)return Array.from(track.Keys[0].Vector);
    frame = clock.elapsed % to;
  }
  const keys = track.Keys;
  let lo = 0, hi = keys.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (keys[mid].Frame <= frame) lo = mid + 1; else hi = mid; }
  let left = keys[lo - 1], right = keys[lo];
  if (!left || left.Frame < from) left = right;
  if (!right || right.Frame > to) right = left;
  if (!left || !right || left.Frame < from || right.Frame > to) return [...fallback];
  if (left === right || track.LineType === 0) return Array.from(left.Vector);
  const t = Math.max(0, Math.min(1, (frame - left.Frame) / (right.Frame - left.Frame)));
  if (rotation) {
    const a = new Quaternion().fromArray(left.Vector), b = new Quaternion().fromArray(right.Vector);
    if (track.LineType > 1 && left.OutTan && right.InTan) {
      const tangent = new Quaternion().fromArray(left.OutTan).slerp(new Quaternion().fromArray(right.InTan), t);
      return a.slerp(b, t).slerp(tangent, 2 * t * (1 - t)).normalize().toArray();
    }
    return a.slerp(b, t).normalize().toArray();
  }
  return Array.from(left.Vector, (a, i) => {
    const b = right.Vector[i], out = left.OutTan?.[i] ?? a, input = right.InTan?.[i] ?? b;
    if (track.LineType === 2) return (2*t*t*t-3*t*t+1)*a+(t*t*t-2*t*t+t)*out+(-2*t*t*t+3*t*t)*b+(t*t*t-t*t)*input;
    if (track.LineType === 3) return (1-t)**3*a+3*t*(1-t)**2*out+3*t*t*(1-t)*input+t**3*b;
    return a+(b-a)*t;
  });
}

export function sampleNumber(value: number | model.AnimVector | undefined, clock: AnimationClock, fallback = 1) {
  if(typeof value==='number')return value;
  if(!value?.Keys.length)return fallback;
  return sampleTrack(value, clock, [fallback])[0];
}

/** Warcraft nodes rotate about absolute model-space pivots; parent transforms
 * compose afterwards. Standard glTF local-joint translations are not equivalent. */
const nodeTranslation=new Vector3(),nodeRotation=new Quaternion(),nodeScale=new Vector3();
export function nodeMatrix(node: model.Node, clock: AnimationClock, out = new Matrix4()): Matrix4 {
  const pivot=node.PivotPoint,px=pivot?.[0]??0,py=pivot?.[1]??0,pz=pivot?.[2]??0;
  if(node.Translation)nodeTranslation.fromArray(sampleTrack(node.Translation,clock,[0,0,0]));else nodeTranslation.set(0,0,0);
  if(node.Rotation)nodeRotation.fromArray(sampleTrack(node.Rotation,clock,[0,0,0,1],true));else nodeRotation.identity();
  if(node.Scaling)nodeScale.fromArray(sampleTrack(node.Scaling,clock,[1,1,1]));else nodeScale.set(1,1,1);
  out.compose(nodeTranslation,nodeRotation,nodeScale);
  const e=out.elements;
  e[12]+=px-e[0]*px-e[4]*py-e[8]*pz;
  e[13]+=py-e[1]*px-e[5]*py-e[9]*pz;
  e[14]+=pz-e[2]*px-e[6]*py-e[10]*pz;
  return out;
}
