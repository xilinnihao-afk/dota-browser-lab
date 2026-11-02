import test from 'node:test';
import assert from 'node:assert/strict';
import {heightAt,atlasCell,type MapData,type Corner} from '../src/classic/map-data';
// @ts-expect-error This build-time ESM module is deliberately not shipped in the browser bundle.
import {staticUnits} from '../scripts/lib/jass-static.mjs';

test('W3E sampling keeps Z-up offset, tile scale, triangle diagonal and bilinear cliff deformation',()=>{
  const map={width:2,height:2,offset:[-128,256],corners:[0,128,256,512].map(z=>[z,0,0,0,2,0,0,0,0,0,z,0] as Corner)} as MapData;
  assert.equal(heightAt(map,-128,256),0);assert.equal(heightAt(map,-96,288),96);
  assert.equal(heightAt(map,-32,352),352);assert.equal(heightAt(map,-64,320,true),224);
});
test('classic terrain atlas selects extended variations and standard transition cells',()=>{
  assert.deepEqual(atlasCell(0,true),[4,0]);assert.deepEqual(atlasCell(15,true),[7,3]);
  assert.deepEqual(atlasCell(16,true),[3,3]);assert.deepEqual(atlasCell(17,true),[0,0]);
  assert.deepEqual(atlasCell(0,false),[0,0]);assert.deepEqual(atlasCell(1,false),[3,3]);
});
test('static JASS reconstruction follows literal owners, removes old towers and preserves replacement coordinates',()=>{
  const result=staticUnits(`function main takes nothing returns nothing\rset p=Player(6)\rset tower=CreateUnit(p,'u00M',100.0,-200.0,270)\rset x=GetUnitX(tower)\rset y=GetUnitY(tower)\rcall RemoveUnit(tower)\rset upgraded=CreateUnit(p,'u00T',x,y-33,90)\rcall SetUnitColor(upgraded,ConvertPlayerColor(2))\rendfunction`);
  assert.equal(result.created,2);assert.equal(result.removed,1);assert.equal(result.units.length,1);
  assert.equal(result.units[0].id,'u00T');assert.deepEqual(result.units[0].position,[100,-233,0]);assert.equal(result.units[0].team,2);assert.equal(result.units[0].angle,Math.PI/2);
});
test('static reconstruction never guesses dynamic spawns or executes functions and conditionals',()=>{
  const result=staticUnits(`function unrelated takes nothing returns nothing\nset a=CreateUnit(Player(0),'hfoo',0,0,0)\nendfunction\nfunction main takes nothing returns nothing\nif IsPlaying() then\nset a=CreateUnit(Player(0),'hfoo',0,0,0)\nendif\nloop\nset a=CreateUnit(Player(0),'hfoo',1,1,0)\nendloop\nset x=GetRandomReal(0,100)\nset b=CreateUnit(Player(0),'hfoo',x,0,0)\nendfunction`);
  assert.equal(result.units.length,0);assert.equal(result.unresolved.length,3);
});
