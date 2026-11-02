import test from 'node:test';
import assert from 'node:assert/strict';
import {installBrowserGestureGuard} from '../src/browser-gestures';

test('double-click default is cancelled without swallowing either click or other handlers',()=>{
  const target=new EventTarget(),dispose=installBrowserGestureGuard(target);
  let clicks=0,doubles=0;
  target.addEventListener('click',()=>clicks++);
  target.addEventListener('dblclick',()=>doubles++);
  for(let i=0;i<2;i++)assert.equal(target.dispatchEvent(new Event('click',{cancelable:true})),true);
  assert.equal(target.dispatchEvent(new Event('dblclick',{cancelable:true})),false);
  assert.equal(clicks,2);assert.equal(doubles,1);dispose();
});
test('touch, pointer and wheel events remain available for two thumbs, scrolling and audio unlock',()=>{
  const target=new EventTarget(),dispose=installBrowserGestureGuard(target);
  for(const type of ['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','pointercancel','wheel']){
    const event=new Event(type,{cancelable:true});assert.equal(target.dispatchEvent(event),true,type);assert.equal(event.defaultPrevented,false,type);
  }
  dispose();
});
test('guard removes its capture listener when the entry is disposed',()=>{
  const target=new EventTarget(),registrations:Parameters<EventTarget['addEventListener']>[]=[],original=target.addEventListener.bind(target);
  target.addEventListener=(...args)=>{registrations.push(args);original(...args);};
  const dispose=installBrowserGestureGuard(target);
  assert.deepEqual(registrations[0][2],{capture:true,passive:false});
  dispose();assert.equal(target.dispatchEvent(new Event('dblclick',{cancelable:true})),true);
});
