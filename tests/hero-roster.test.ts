import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseMDX,decodeBLP,getBLPImageData} from 'war3-model';
import {HEROES,assets,type HeroId} from '../src/classic/battle/definitions';
import {SELECTION_HEROES,playableSelection} from '../src/classic/battle/selection-roster';

const resource=(path:string)=>readFileSync(new URL('../public/assets/imba/resources/'+path,import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../artifacts/imba-playable/assets.json',import.meta.url),'utf8'));

test('all twelve altar heroes resolve to playable definitions and the same battle models',()=>{
  assert.equal(SELECTION_HEROES.length,12);
  assert.equal(new Set(SELECTION_HEROES.map(hero=>hero.id)).size,12);
  assert.deepEqual(new Set(SELECTION_HEROES.map(hero=>hero.playable)),new Set(Object.keys(HEROES)));
  for(const hero of SELECTION_HEROES){
    assert.equal(playableSelection(hero.id),hero.id);
    assert.equal(HEROES[hero.playable].name,hero.name);
    assert.equal(hero.model,assets.models[hero.playable]);
  }
  assert.equal(playableSelection('missing'),undefined);
  assert.equal(playableSelection('circle'),undefined);
});

test('each playable hero has renderable original models, textures, portraits and three skill icons in the prepared package',()=>{
  const checked=new Set<string>();
  function verified(path:string){
    const bytes=resource(path);
    if(!checked.has(path)){
      assert.ok(manifest.files[path],'asset absent from prepared manifest: '+path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.files[path].sha256,path);
      checked.add(path);
    }
    return bytes;
  }
  for(const id of Object.keys(HEROES) as HeroId[]){
    const hero=HEROES[id],model=parseMDX(new Uint8Array(verified(assets.models[id])).buffer);
    assert.equal(model.Version,800,id+' retains the original MDX format');
    for(const action of ['stand','walk','attack','death'])assert.ok(model.Sequences.some(sequence=>sequence.Name.toLowerCase().split(/[\s-]+/).includes(action)),id+' has '+action+' animation');
    for(const texture of model.Textures){
      if(texture.Image)verified(texture.Image.replaceAll('\\','/').toLowerCase());
      else assert.ok([1,2].includes(texture.ReplaceableId??0),id+' has a supported team texture');
    }
    for(const icon of [assets.icons[id],...Object.values(hero.skills).map(skill=>assets.icons[skill.id])]){
      const pixels=getBLPImageData(decodeBLP(new Uint8Array(verified(icon)).buffer),0);
      assert.ok(pixels.width>=32&&pixels.height>=32,id+' has a usable original icon');
    }
  }
});

test('all twelve heroes expose affordable basic abilities and level-three ultimates without missing targeting metadata',()=>{
  const ids=new Set<string>();
  for(const hero of Object.values(HEROES)){
    assert.deepEqual(Object.keys(hero.skills),['q','w','r']);
    for(const [slot,skill]of Object.entries(hero.skills)){
      assert.equal(skill.level,slot==='r'?3:1);
      assert.ok(skill.mana>0&&skill.mana<=hero.mana);
      assert.ok(skill.cooldown>0);
      assert.ok(skill.name&&skill.description);
      assert.ok(['self','point','enemy'].includes(skill.target));
      assert.equal(skill.range===0,skill.target==='self',hero.id+' '+skill.id);
      assert.ok(skill.radius>=0);
      assert.ok(assets.icons[skill.id]);
      assert.ok(!ids.has(skill.id),'ability identifiers must remain unambiguous for simulation dispatch');
      ids.add(skill.id);
    }
  }
  assert.equal(ids.size,36);
});
