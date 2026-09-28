import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mc, fixture, player, drain } from './runtimeFixture.mjs';
const mutation = await import('../starstone_bp/scripts/mutationController.js');
const repair = await import('../starstone_bp/scripts/repair.js');
const { placementIndex } = await import('../starstone_bp/scripts/persistence.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
globalThis.__mcDimensions = new Map();
const props = new Map();
mc.world.getDynamicProperty = key => props.get(key);
mc.world.getDynamicPropertyIds = () => [...props.keys()];
mc.world.setDynamicProperty = (key, value) => value === undefined ? props.delete(key) : props.set(key, value);
function world(id) {
    const f = fixture(); f.dim.id = id;
    globalThis.__mcDimensions.set(id, f.dim);
    return f;
}
function explode(f, x, y, z) {
    for (const cb of globalThis.__mcWorldSubscribers.blockExplode) cb({
        dimension: f.dim, block: f.dim.getBlock({x,y,z})
    });
}
mutation.registerMutationController();
mutation.registerMutationController();
assert.equal(globalThis.__mcWorldSubscribers.blockExplode.length, 1);

// The synchronous interval has a hard cap even when every saved position was
// silently replaced by a command. No block-volume enumeration is involved.
{
    const f = world('test:validation-budget');
    for (let x = 0; x < 40; x++) {
        const block = f.put('starstone:generator', x, 0, 0);
        placementIndex.record(block); f.store.delete(`${x},0,0`);
    }
    let reads = 0; const read = f.dim.getBlock;
    f.dim.getBlock = position => { reads++; return read(position); };
    mutation.validateKnownPositions();
    assert.equal(mutation.mutationStats().lastChecked, mutation.VALIDATION_POSITION_BUDGET);
    assert.equal(reads, mutation.VALIDATION_POSITION_BUDGET);
    mutation.validateKnownPositions();
    assert.equal(mutation.mutationStats().lastChecked, 0, 'pending maintenance must not stack');
    await drain();
    for (let tick = 0; tick < 4; tick++) { mutation.validateKnownPositions(); await drain(); }
    assert.equal(placementIndex.stats().positions, 0, 'round robin reaches every stale indexed position');
}

// Several exploded blocks and a destroyed support produce one batch. Distant
// fragments lose power and unsupported devices drop before cable masks refresh.
{
    runtime.clearNetworks();
    const f = world('test:explosion-batch');
    f.put('starstone:generator', 0, 0, 0);
    for (let x = 1; x <= 7; x++) { f.put('starstone:cable', x, 0, 0); f.put('minecraft:stone', x, -1, 0); }
    const lamp = f.put('starstone:lamp', 8, 0, 0); f.put('minecraft:stone', 8, -1, 0);
    repair.startRebuildNearby(player(f.dim), {radius:8,height:1}); await drain();
    assert.equal(lamp.permutation.getState('starstone:powered'), true);
    const before = mutation.mutationStats().batches;
    for (const key of ['3,0,0','4,0,0','6,-1,0']) f.store.delete(key);
    explode(f,3,0,0); explode(f,4,0,0); explode(f,3,0,0); explode(f,6,-1,0);
    await drain();
    assert.equal(mutation.mutationStats().batches, before + 1, 'one deduplicated explosion batch');
    assert.equal(lamp.permutation.getState('starstone:powered'), false);
    assert.equal(f.dim.getBlock({x:6,y:0,z:0}).type.id, 'minecraft:air');
    for (const x of [3,4,6]) assert.equal(runtime.networkIdOf(`${f.dim.id}|${x}|0|0#main`), undefined);
    assert.equal(f.dim.getBlock({x:2,y:0,z:0}).permutation.getState('starstone:connections'), 8);
    assert.equal(f.dim.getBlock({x:5,y:0,z:0}).permutation.getState('starstone:connections'), 0);
    assert.equal(runtime.invariantHolds(), true);
}

// A command replacement is repaired using known positions, with the cached
// component providing survivor seeds even when the lost cable splits a network.
{
    props.clear(); runtime.clearNetworks();
    const f = world('test:command-repair');
    f.put('starstone:generator',0,0,0);
    f.put('starstone:cable',1,0,0); f.put('minecraft:stone',1,-1,0);
    const lamp = f.put('starstone:lamp',2,0,0); f.put('minecraft:stone',2,-1,0);
    repair.startRebuildNearby(player(f.dim), {radius:2,height:1}); await drain();
    for (let tick = 0; tick < 3; tick++) { mutation.validateKnownPositions(); await drain(); }
    f.store.delete('1,0,0');
    for (let tick = 0; tick < 3; tick++) { mutation.validateKnownPositions(); await drain(); }
    assert.equal(lamp.permutation.getState('starstone:powered'), false);
    assert.equal(runtime.networkIdOf(`${f.dim.id}|1|0|0#main`), undefined);
    assert.ok(!placementIndex.positionsInChunk(f.dim.id,0,0).some(p => p.x === 1));
    f.unloaded.add('0,0,0');
    for (let tick = 0; tick < 3; tick++) { mutation.validateKnownPositions(); await drain(); }
    assert.ok(placementIndex.positionsInChunk(f.dim.id,0,0).some(p => p.x === 0), 'unloaded hint survives');
    // Moving a vanilla support by piston has the same authoritative result.
    f.store.delete('2,-1,0');
    for (let tick = 0; tick < 3; tick++) { mutation.validateKnownPositions(); await drain(); }
    assert.equal(f.dim.getBlock({x:2,y:0,z:0}).type.id, 'minecraft:air');
}

assert.equal(mutation.PISTON_POLICY, 'immovable');
for (const id of ['generator','cable','bridge','conduit','lamp']) {
    const block = JSON.parse(fs.readFileSync(`starstone_bp/blocks/${id}.json`,'utf8'))['minecraft:block'];
    assert.equal(block.components['minecraft:movable'].movement_type, 'immovable', `${id} piston policy`);
}
assert.equal(mutation.mutationStats().running, false);
console.log('mutations: bounded indexed validation, explosion batching, support loss, command repair, unloaded hints and piston declarations passed');
