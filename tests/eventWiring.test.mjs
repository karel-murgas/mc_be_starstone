import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mc, fixture, drain, intervals, player } from './runtimeFixture.mjs';
const definitions = new Map();
mc.system.beforeEvents = { startup:{ subscribe(cb) { cb({ blockComponentRegistry:{ registerCustomComponent(id,definition) {
    assert.ok(!definitions.has(id),`duplicate registration ${id}`); definitions.set(id,definition);
} } }); } } };
let commandHandler;
mc.system.afterEvents.scriptEventReceive.subscribe = cb => { commandHandler = cb; };
const props = new Map();
mc.world.getDynamicProperty = key => props.get(key);
mc.world.setDynamicProperty = (key,value) => props.set(key,value);
mc.world.getDynamicPropertyIds = () => [...props.keys()];
await import('../starstone_bp/scripts/main.js');
assert.equal(typeof commandHandler,'function','main must register diagnostics');
assert.ok(intervals.length,'main must schedule pending work');
const bp = 'starstone_bp';
for (const file of fs.readdirSync(`${bp}/blocks`).filter(f => f.endsWith('.json'))) {
    const node = JSON.parse(fs.readFileSync(`${bp}/blocks/${file}`,'utf8'))['minecraft:block'];
    for (const group of [node.components, ...(node.permutations || []).map(p => p.components)]) {
        for (const id of Object.keys(group || {}).filter(id => !id.startsWith('minecraft:'))) assert.ok(definitions.has(id),`${file}: ${id} must register through main startup`);
    }
}
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const { createPlacementIndex } = await import('../starstone_bp/scripts/persistence.js');
const saved = () => createPlacementIndex(mc.world).positionsInChunk('minecraft:overworld',0,0);
function fire(name,event) { for (const cb of globalThis.__mcWorldSubscribers[name] || []) cb(event); }
async function tick() { await drain(); for (const cb of intervals) cb(); await drain(); }
for (const last of ['generator','lamp','cable']) {
    runtime.clearNetworks();
    const f = fixture();
    const gen = f.put('starstone:generator',0,0,0);
    const cable = f.put('starstone:cable',1,0,0);
    const lamp = f.put('starstone:lamp',2,0,0);
    f.put('minecraft:stone',1,-1,0); f.put('minecraft:stone',2,-1,0);
    if (last === 'cable') definitions.get('starstone:cable').onPlace({block:cable});
    else fire('playerPlaceBlock',{block:last === 'generator' ? gen : lamp});
    await tick();
    assert.equal(lamp.permutation.getState('starstone:powered'),true,`${last}-last event must power lamp`);
    const placed = last === 'generator' ? gen : last === 'lamp' ? lamp : cable;
    assert.ok(saved().some(p => p.x === placed.location.x && p.y === 0 && p.z === 0),'placement hook persists position');
    const owner = runtime.networkIdOf('minecraft:overworld|0|0|0#main');
    definitions.get('starstone:generator').onPlayerInteract({block:gen}); await tick();
    assert.equal(lamp.permutation.getState('starstone:powered'),false);
    assert.equal(runtime.networkIdOf('minecraft:overworld|0|0|0#main'),owner,'toggle must preserve topology');
    definitions.get('starstone:generator').onPlayerInteract({block:gen}); await tick();
    const support = f.dim.getBlock({x:1,y:-1,z:0});
    f.store.delete('1,-1,0');
    fire('playerBreakBlock',{block:f.dim.getBlock(support.location),dimension:f.dim,brokenBlockPermutation:support.permutation});
    await tick();
    assert.equal(f.dim.getBlock(cable.location).typeId,'minecraft:air');
    assert.ok(!saved().some(p => p.x === 1 && p.y === 0 && p.z === 0),'support drop removes placement hint');
    assert.equal(lamp.permutation.getState('starstone:powered'),false,'support event must split network');
}
const f = fixture();
const user = player(f.dim);
commandHandler({id:'starstone:debug',sourceEntity:user,message:'on'});
assert.equal(props.get('starstone:diagnostics:debug'),'on');
commandHandler({id:'starstone:rebuild_nearby',sourceEntity:user,message:''});
await drain();
assert.ok(user.messages.some(message => message.includes('Rebuild complete')),'main command must actually dispatch rebuild');
runtime.clearNetworks();
const source = f.put('starstone:generator',0,0,0);
const lamp = f.put('starstone:lamp',1,0,0);
assert.ok(globalThis.__mcWorldSubscribers.playerSpawn?.length,'main must register recovery');
fire('playerSpawn',{player:user,initialSpawn:true});
await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true,'main initial-spawn hook restores power');
runtime.clearNetworks();
f.store.delete('0,0,0');
fire('playerBreakBlock',{block:f.dim.getBlock(source.location),dimension:f.dim,brokenBlockPermutation:source.permutation});
await drain();
assert.ok(!saved().some(p => p.x === 0 && p.y === 0 && p.z === 0),'break removes saved hint even without a runtime owner');
console.log('event wiring: real main startup, attachments, device-last placement, source toggles, support breaks and commands passed');
