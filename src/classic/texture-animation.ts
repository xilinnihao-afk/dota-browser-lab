import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import type {model} from 'war3-model';
import {sampleTrack,type AnimationClock} from './animation';
/** MDX UV transforms use the texture origin, not Three.Texture's optional center. */
export function textureAnimationMatrix(animation:model.TVertexAnim,clock:AnimationClock,out=new Matrix3()){
  const m=new Matrix4().compose(new Vector3().fromArray(sampleTrack(animation.Translation,clock,[0,0,0])),new Quaternion().fromArray(sampleTrack(animation.Rotation,clock,[0,0,0,1],true)),new Vector3().fromArray(sampleTrack(animation.Scaling,clock,[1,1,1]))).elements;
  return out.set(m[0],m[4],m[12],m[1],m[5],m[13],0,0,1);
}
