import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mc, fixture, drain } from './runtimeFixture.mjs';
const cable = await import('../starstone_bp/scripts/cableComponent.js');
const controller = await import('../starstone_bp/scripts/networkController.js');
const graph = await import('../starstone_bp/scripts/networkGraph.js');
const power = await import('../starstone_bp/scripts/powerPropagation.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const frame = await import('../starstone_bp/scripts/surfaceFrame.js');
const definitions = new Map();
mc.system.beforeEvents = { startup: { subscribe(cb) { cb({ blockComponentRegistry: { registerCustomComponent(id, component) { definitions.set(id,component); } } }); } } };
cable.registerCableComponent();
(await import('../starstone_bp/scripts/generatorComponent.js')).registerGeneratorController();
for (const name of ['cable','bridge','lamp','conduit','generator']) {
    const block = JSON.parse(readFileSync(new URL(`../starstone_bp/blocks/${name}.json`,import.meta.url),'utf8'))['minecraft:block'];
    for (const id of Object.keys(block.components).filter(id => !id.startsWith('minecraft:'))) assert.ok(definitions.has(id),`unregistered ${id}`);
}
for (const face of frame.FACE_LIST) {
    for (const id of ['starstone:lamp','starstone:bridge','starstone:generator']) {
        const f = fixture();
        const seed = f.put('starstone:cable',0,0,0,{ 'minecraft:block_face':face });
        const [x,y,z] = frame.worldOffset(face,'local_e');
        f.put(id,x,y,z,{ 'minecraft:block_face':face });
        assert.equal(cable.computeCableMask(seed),2,`${face} cable contact to ${id}`);
    }
}
// Actual placement refreshes masks BEFORE discovery, even when the device is
// the last placed block rather than a cable.
{
    runtime.clearNetworks();
    const f = fixture();
    const source = f.put('starstone:generator',0,0,0);
    const wire = f.put('starstone:cable',1,0,0);
    const lamp = f.put('starstone:lamp',2,0,0);
    f.put('minecraft:stone',1,-1,0); f.put('minecraft:stone',2,-1,0);
    cable.schedulePlaced(lamp); cable.flushPending(); await drain();
    assert.equal(wire.permutation.getState('starstone:connections'),10);
    assert.equal(lamp.permutation.getState('starstone:powered'),true);
    // An on/off transition before deferred writes drain must settle OFF.
    const net = runtime.networkOf(runtime.networkIdOf('minecraft:overworld|0|0|0#main'));
    power.applyPower({ ...net,powered:false },f.dim);
    power.applyPower({ ...net,powered:true },f.dim);
    await drain();
    assert.equal(lamp.permutation.getState('starstone:powered'),true);
    power.applyPower({ ...net,powered:false },f.dim); await drain();
    power.applyPower({ ...net,powered:true },f.dim);
    power.applyPower({ ...net,powered:false },f.dim); await drain();
    assert.equal(lamp.permutation.getState('starstone:powered'),false);
    // The chunk unloads between planning and writing.
    power.applyPower({ ...net,powered:true },f.dim);
    f.unloaded.add('2,0,0'); await drain();
    assert.ok(power.pendingUnresolved().has('minecraft:overworld|2|0|0#main'));
    f.unloaded.clear(); power.applyPower({ ...net,powered:true },f.dim); await drain();
    assert.equal(lamp.permutation.getState('starstone:powered'),true);
    assert.ok(!power.pendingUnresolved().has('minecraft:overworld|2|0|0#main'));
    // Supporting block removal must drop the cable AND split its cached network.
    f.store.delete('1,-1,0');
    cable.scheduleAffected(f.dim.getBlock({x:1,y:-1,z:0}));
    cable.flushPending(); await drain();
    assert.equal(f.dim.getBlock({x:1,y:0,z:0}).typeId,'minecraft:air');
    assert.equal(lamp.permutation.getState('starstone:powered'),false);
    assert.equal(runtime.networkIdOf('minecraft:overworld|1|0|0#main'),undefined);
    assert.equal(source.writes,0);
}
// Bridge placement discovers BOTH lanes without joining them.
{
    runtime.clearNetworks();
    const f = fixture();
    const bridge = f.put('starstone:bridge',0,0,0);
    f.put('minecraft:stone',0,-1,0);
    f.put('starstone:generator',-1,0,0);
    const lamp = f.put('starstone:lamp',1,0,0); f.put('minecraft:stone',1,-1,0);
    cable.schedulePlaced(bridge); cable.flushPending(); await drain();
    assert.notEqual(runtime.networkIdOf('minecraft:overworld|0|0|0#ns'), runtime.networkIdOf('minecraft:overworld|0|0|0#ew'));
    assert.equal(bridge.permutation.getState('starstone:powered_ns'),false);
    assert.equal(bridge.permutation.getState('starstone:powered_ew'),true);
    assert.equal(lamp.permutation.getState('starstone:powered'),true);
    f.store.delete('0,-1,0'); f.store.delete('1,-1,0');
    cable.scheduleAffected(f.dim.getBlock({x:0,y:-1,z:0}));
    cable.scheduleAffected(f.dim.getBlock({x:1,y:-1,z:0}));
    cable.flushPending(); await drain();
    assert.equal(f.dim.getBlock({x:0,y:0,z:0}).typeId,'minecraft:air');
    assert.equal(f.dim.getBlock({x:1,y:0,z:0}).typeId,'minecraft:air');
}
// Equal reciprocal world directions do not connect different mounting planes.
{
    const f = fixture();
    const first = f.put('starstone:lamp',0,0,0);
    f.put('starstone:lamp',1,0,0,{ 'minecraft:block_face':'down' });
    const promise = graph.discoverNetwork(first); await drain();
    assert.equal((await promise).nodes.size,1);
}
// A single out-of-bounds neighbor must not abort the other five contacts.
{
    const f = fixture();
    const gen = f.put('starstone:generator',0,319,0);
    f.put('starstone:generator',1,319,0);
    const promise = graph.discoverNetwork(gen); await drain();
    assert.equal((await promise).nodes.size,2);
}
// Unexpected descriptor errors must not register a partially traversed network.
{
    runtime.clearNetworks();
    const f = fixture();
    const gen = f.put('starstone:generator',0,0,0);
    const neighbor = f.put('starstone:lamp',1,0,0);
    neighbor.permutation.getState = () => { throw new Error('descriptor failure'); };
    const rejected = assert.rejects(controller.discoverAndRegisterNetwork(gen), /descriptor failure/);
    await drain();
    await rejected;
    assert.equal(runtime.networkIdOf('minecraft:overworld|0|0|0#main'),undefined);
}
for (const [face,axis] of [['Up','y'],['Down','y'],['East','x'],['West','x'],['North','z'],['South','z']]) {
    const f = fixture(); const conduit = f.put('starstone:conduit',0,0,0);
    const event = { face, permutationToPlace:conduit.permutation };
    definitions.get('starstone:conduit').beforeOnPlayerPlace(event);
    assert.equal(event.permutationToPlace.getState('starstone:axis'),axis);
}
console.log('integration regressions: six-face contacts, registrations, placement, bridge lanes, support splits, rapid toggles, unloading, graph bounds and conduit axes passed');
