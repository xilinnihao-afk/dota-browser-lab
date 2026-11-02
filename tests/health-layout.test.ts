import {test} from 'node:test';
import assert from 'node:assert/strict';
import {labelBounds,labelVisible} from '../src/classic/battle/label-layout';
import {rotatePoint,rotateRect,gameControlPoint,setGameRotation} from '../src/classic/viewport';
import {rotateInsets,layoutQuery} from '../minitool/runtime/layout';
const top={top:6,bottom:50,width:300,height:44};
test('mobile display:contents HUD never hides healthy minions or enemy heroes',()=>{
 const b=labelBounds(390,{top:0,bottom:0,width:0,height:0},top);
 assert.deepEqual(b,{top:62,bottom:380});
 for(const hp of [550,1500,1])assert.equal(labelVisible(hp,350,180,.9,844,b),true);
});
test('desktop and hidden selection HUD bounds update independently of viewport size',()=>{
 const hud={top:600,bottom:780,width:1200,height:180};
 assert.equal(labelBounds(780,hud,top).bottom,590);
 assert.equal(labelBounds(780,{...hud,width:0,height:0},top).bottom,770);
 for(const [hp,x,y,z]of [[0,350,180,.9],[1,-2,180,.9],[1,400,20,.9],[1,400,700,.9],[1,400,180,1.01]])assert.equal(labelVisible(hp,x,y,z,1200,labelBounds(780,hud,top)),false);
});
test('clockwise viewport maps screen corners and hit boxes exactly',()=>{
 assert.deepEqual(rotatePoint(390,0,390,true),{x:0,y:0});
 assert.deepEqual(rotatePoint(0,844,390,true),{x:844,y:390});
 const r=rotateRect({left:30,top:100,width:80,height:120},390,true);
 assert.deepEqual(r,{left:100,top:280,width:120,height:80,right:220,bottom:360});
 const center=rotatePoint(70,160,390,true);assert.equal(center.x,r.left+r.width/2);assert.equal(center.y,r.top+r.height/2);
 assert.deepEqual(rotatePoint(42,84,390,false),{x:42,y:84});
});
test('logical joystick and aim directions remain aligned with rotated display',()=>{
 const start=rotatePoint(210,70,390,true),right=rotatePoint(210,110,390,true),up=rotatePoint(250,70,390,true);
 assert.deepEqual({x:right.x-start.x,y:right.y-start.y},{x:40,y:0});assert.deepEqual({x:up.x-start.x,y:up.y-start.y},{x:0,y:-40});
 assert.deepEqual(rotateInsets({top:44,right:0,bottom:34,left:0},true),{top:0,right:34,bottom:0,left:44});
});
test('media rules follow logical landscape size while keeping native preferences',()=>{
 const native=(q:string)=>!q.includes('(max-width:-1px)')&&!q.includes('prefers-reduced-motion');
 assert.equal(layoutQuery('(orientation:landscape) and (max-width:900px)',844,390,native),true);
 assert.equal(layoutQuery('(orientation:portrait)',844,390,native),false);
 assert.equal(layoutQuery('(max-width:700px)',844,390,native),false);
 assert.equal(layoutQuery('(max-width:700px), (max-height:400px)',844,390,native),true);
 assert.equal(layoutQuery('(orientation:landscape) and (prefers-reduced-motion:reduce)',844,390,native),false);
});

test('OrbitControls internal continuation events are not rotated twice',()=>{
 Object.defineProperty(globalThis,'innerWidth',{configurable:true,value:390});setGameRotation(true);
 try{const event=new Event('pointermove');Object.assign(event,{pageX:210,pageY:70});assert.deepEqual(gameControlPoint(event,'page'),{x:70,y:180});assert.deepEqual(gameControlPoint({pageX:70,pageY:180},'page'),{x:70,y:180});}
 finally{setGameRotation(false);Reflect.deleteProperty(globalThis,'innerWidth');}
});
