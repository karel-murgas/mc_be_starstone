import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,drain} from './runtimeFixture.mjs';
import {FACE_LIST,ARM_NAMES,worldOffset} from '../starstone_bp/scripts/surfaceFrame.js';
const {refreshAdapterVisuals,redstoneContactMask}=await import('../starstone_bp/scripts/redstoneAdapters.js');
const {applyPower}=await import('../starstone_bp/scripts/powerPropagation.js');

const geo=JSON.parse(readFileSync('starstone_rp/models/blocks/starstone_adapter.geo.json','utf8'))['minecraft:geometry'][0];
const bones=new Map(geo.bones.map(bone=>[bone.name,bone]));
assert.equal(bones.get('center').cubes.length,1,'center box has no permanent side tabs');
for(const kind of ['blue','red']) for(const [direction,origin,size] of [
  ['n',[-1,.02,-8.14],[2,.12,5.14]],['e',[-8.14,.02,-1],[5.14,.12,2]],
  ['s',[-1,.02,3],[2,.12,5.14]],['w',[3,.02,-1],[5.14,.12,2]]
]) {
  const arm=bones.get(`${kind}_${direction}`).cubes[0];
  assert.deepEqual(arm.origin,origin,`${kind}_${direction} aligns with cable centerline`);
  assert.deepEqual(arm.size,size,`${kind}_${direction} matches cable width, height and edge overlap`);
  if(kind==='red') for(const face of Object.values(arm.uv)) {
    assert.deepEqual(face.uv,[18,15],'red arms use saturated red pixel, not white center');
    assert.deepEqual(face.uv_size,[1,1],'every red face stays a single red pixel');
  }
}
for(const id of ['redstone_input','redstone_output']) {
  const block=JSON.parse(readFileSync(`starstone_bp/blocks/${id}.json`,'utf8'))['minecraft:block'];
  const visibility=block.components['minecraft:geometry'].bone_visibility;
  // Blue arms follow the Starstone signal and red arms the redstone signal:
  // the input senses redstone in `powered`; the output emits it while powered.
  const blueState=id==='redstone_input'?'starstone:star_powered':'starstone:powered';
  for(const blue of [false,true]) for(const red of [false,true]) {
    if(id==='redstone_output' && blue!==red) continue;
    const states={[blueState]:blue,'starstone:powered':red};
    let materials=block.components['minecraft:material_instances'], light=block.components['minecraft:light_emission'];
    for(const p of block.permutations) {
      const holds=[...p.condition.matchAll(/query\.block_state\('([a-z_:]+)'\) == (true|false|'[a-z]+')/g)]
        .every(([,name,value])=>name in states ? String(states[name])===value : true);
      if(holds && p.components['minecraft:material_instances']) {
        materials=p.components['minecraft:material_instances'];
        light=p.components['minecraft:light_emission'];
      }
    }
    assert.equal(materials.blue.texture,blue?'starstone:cable_arm_on':'starstone:cable_arm_off',`${id} blue=${blue} red=${red}`);
    assert.equal(materials.red.texture,red?'starstone:redstone_arm_on':'starstone:redstone_arm_off',`${id} blue=${blue} red=${red}`);
    assert.equal(light||0,blue?1:0,`${id} glows with the Starstone signal`);
  }
  for(const kind of ['blue','red']) for(let mask=0;mask<16;mask++) for(let i=0;i<4;i++) {
    const expression=visibility[`${kind}_${'nesw'[i]}`];
    const state=kind==='blue'?'starstone:connections':'starstone:redstone_connections';
    const selected=[...expression.matchAll(/== (\d+)/g)].map(match=>Number(match[1]));
    assert.equal(selected.includes(mask),Boolean(mask&(1<<i)),`${id} ${kind} mask ${mask} arm ${i}`);
    assert.ok(expression.includes(state));
  }
  for(const face of FACE_LIST) for(const [i,arm] of ARM_NAMES.entries()) {
    const f=fixture();
    const adapter=f.put(`starstone:${id}`,0,10,0,{'minecraft:block_face':face});
    const [dx,dy,dz]=worldOffset(face,arm);
    f.put('starstone:cable',dx,10+dy,dz,{'minecraft:block_face':face});
    refreshAdapterVisuals(adapter);
    assert.equal(adapter.permutation.getState('starstone:connections'),1<<i,`${id} ${face} blue ${arm}`);
    assert.equal(adapter.permutation.getState('starstone:redstone_connections'),0,'blue cable is not redstone');
    f.put('minecraft:redstone_wire',dx,10+dy,dz);
    refreshAdapterVisuals(adapter);
    assert.equal(adapter.permutation.getState('starstone:connections'),0,'redstone wire is not blue contact');
    assert.equal(redstoneContactMask(adapter),1<<i,`${id} ${face} red ${arm}`);
    assert.equal(adapter.permutation.getState('starstone:redstone_connections'),1<<i);
    f.store.delete(`${dx},${10+dy},${dz}`);
    refreshAdapterVisuals(adapter);
    assert.equal(adapter.permutation.getState('starstone:redstone_connections'),0,'broken redstone retracts arm');
  }
}
const poweredFixture=fixture();
const input=poweredFixture.put('starstone:redstone_input',0,10,0);
const network={nodes:new Set([`${poweredFixture.dim.id}|0|10|0#main`]),powered:true};
applyPower(network,poweredFixture.dim); await drain();
assert.equal(input.permutation.getState('starstone:powered'),false,'Starstone signal cannot overwrite redstone sensing');
assert.equal(input.permutation.getState('starstone:star_powered'),true,'passing Starstone signal lights input adapter arms');
network.powered=false; applyPower(network,poweredFixture.dim); await drain();
assert.equal(input.permutation.getState('starstone:star_powered'),false,'blue arms darken when Starstone signal leaves');
const longFixture=fixture();
const longInput=longFixture.put('starstone:redstone_input',0,10,0,{'starstone:powered':true});
const longNodes=new Set([`${longFixture.dim.id}|0|10|0#main`]);
for(let x=1;x<=33;x++) {
  longFixture.put('starstone:cable',x,10,0);
  longNodes.add(`${longFixture.dim.id}|${x}|10|0#main`);
}
const longNetwork={nodes:longNodes,powered:true};
applyPower(longNetwork,longFixture.dim);
longNetwork.powered=false;
applyPower(longNetwork,longFixture.dim);
await drain();
assert.equal(longInput.permutation.getState('starstone:powered'),true,'large-network visual writes preserve redstone source flag');
assert.equal(longInput.permutation.getState('starstone:star_powered'),false,'newer large-network off result wins');
longNetwork.powered=true; applyPower(longNetwork,longFixture.dim); await drain();
assert.equal(longInput.permutation.getState('starstone:star_powered'),true,'large-network planner powers blue arms');
console.log('adapter visuals: independent blue/red tangent contacts on all six faces passed');
