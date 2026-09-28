import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, drain } from './runtimeFixture.mjs';
import { FACE_LIST, worldOffset, supportOffset } from '../starstone_bp/scripts/surfaceFrame.js';
const { pollInputs, trackInput, adapterStats, registerRedstoneAdapters } = await import('../starstone_bp/scripts/redstoneAdapters.js');
const { discoverAndRegisterNetwork } = await import('../starstone_bp/scripts/networkController.js');
const { applyPower } = await import('../starstone_bp/scripts/powerPropagation.js');
const {default:runtime} = await import('../starstone_bp/scripts/networkRuntime.js');

registerRedstoneAdapters();
for (const face of FACE_LIST) {
    runtime.clearNetworks();
    const f = fixture(); f.dim.id=`test:adapter_${face}`;
    const input=f.put('starstone:redstone_input',0,0,0,{'minecraft:block_face':face});
    const [sx,sy,sz]=supportOffset(face);
    const support=f.put('minecraft:stone',sx,sy,sz);
    let level=0; support.getRedstonePower=()=>level;
    const [x,y,z]=worldOffset(face,'local_e');
    const output=f.put('starstone:redstone_output',x,y,z,{'minecraft:block_face':face});
    f.put('minecraft:stone',x+sx,y+sy,z+sz);
    const pending=discoverAndRegisterNetwork(input); await drain(); const net=await pending;
    assert.ok(net.sources.has(`${f.dim.id}|0|0|0#main`),'off input is still a source');
    const id=runtime.networkIdOf(`${f.dim.id}|0|0|0#main`);
    // Discovery subscription alone must register an existing input on reload.
    level=1; pollInputs(); await drain();
    assert.equal(output.permutation.getState('starstone:powered'),true,`${face} support0->1`);
    const count=adapterStats().transitions, writes=output.writes;
    level=15; pollInputs(); await drain();
    assert.equal(adapterStats().transitions,count,'1->15 is not a binary change');
    assert.equal(output.writes,writes);
    level=0; pollInputs(); await drain();
    assert.equal(output.permutation.getState('starstone:powered'),false,`${face} support15->0`);
    assert.equal(runtime.networkIdOf(`${f.dim.id}|0|0|0#main`),id,'input changes do not rebuild topology');
    applyPower({...net,powered:true},f.dim); await drain();
    assert.equal(input.permutation.getState('starstone:powered'),false,'Starstone power cannot write the redstone input source flag');
    f.unloaded.add(`${sx},${sy},${sz}`); level=15;
    pollInputs(); await drain();
    assert.equal(input.permutation.getState('starstone:powered'),false,'unavailable support retains source state');
    f.unloaded.clear(); pollInputs(); await drain();
    assert.equal(input.permutation.getState('starstone:powered'),true);
    f.store.delete('0,0,0'); const before=adapterStats().registeredInputs;
    pollInputs(); assert.equal(adapterStats().registeredInputs,before-1,'stale input removed');
}
const f=fixture();
for(let x=0;x<1000;x++) trackInput(f.put('starstone:cable',x,0,0));
assert.equal(adapterStats().registeredInputs,0,'cables never enter polling registry');
const output=JSON.parse(fs.readFileSync('starstone_bp/blocks/redstone_output.json','utf8'))['minecraft:block'];
const base=output.components['minecraft:redstone_producer'];
const on=output.permutations.find(p=>p.components['minecraft:redstone_producer']).components['minecraft:redstone_producer'];
for(const [component,power] of [[base,0],[on,15]]) {
    assert.deepEqual(component,{power,connected_faces:['down','up','north','south','west','east'],strongly_powered_face:'down',transform_relative:true});
}
for(const face of FACE_LIST) assert.ok(output.permutations.some(p=>p.condition.includes(`'${face}'`) && p.components['minecraft:transformation']));
const input=JSON.parse(fs.readFileSync('starstone_bp/blocks/redstone_input.json','utf8'))['minecraft:block'];
assert.ok(!input.components['minecraft:redstone_consumer'],'polling baseline must not add unsupported native consumer');
