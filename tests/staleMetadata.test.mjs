// Saved chunk metadata is rebuilt a chunk at a time after every edit, so for a
// while it describes the old topology. A completely loaded live network must
// never wait for, or be overridden by, that stale metadata: breaking a link
// darkens the cut-off part at once, and reconnecting lights it without a flash
// back to off.
import assert from 'node:assert/strict';
import { mc, fixture, player, drain } from './runtimeFixture.mjs';
const controller = await import('../starstone_bp/scripts/chunkController.js');
const { placementIndex } = await import('../starstone_bp/scripts/persistence.js');
const { chunkIndex } = await import('../starstone_bp/scripts/chunkIndex.js');
const { captureRemovedNetworks, removeAndSplitNetwork } = await import('../starstone_bp/scripts/networkController.js');
const { schedulePlaced, flushPending } = await import('../starstone_bp/scripts/cableComponent.js');
const { reactToGeneratorToggle } = await import('../starstone_bp/scripts/generatorComponent.js');
const repair = await import('../starstone_bp/scripts/repair.js');

const props = new Map();
mc.world.getDynamicProperty = key => props.get(key);
mc.world.getDynamicPropertyIds = () => [...props.keys()];
mc.world.setDynamicProperty = (key,value) => value === undefined ? props.delete(key) : props.set(key,value);
globalThis.__mcDimensions = new Map();
const f = fixture(); f.dim.id = 'test:stale';
globalThis.__mcDimensions.set(f.dim.id, f.dim);
const user = player(f.dim); globalThis.__mcPlayers = [user];
controller.registerChunkController();

const source = f.put('starstone:generator',0,0,0);
const blocks = [source];
for (let x=1;x<=6;x++) { blocks.push(f.put('starstone:cable',x,0,0,{'starstone:connections':10})); f.put('minecraft:stone',x,-1,0); }
const lamp = f.put('starstone:lamp',7,0,0); f.put('minecraft:stone',7,-1,0); blocks.push(lamp);
for (const block of blocks) placementIndex.record(block);
await drain();
repair.startRebuildNearby(user,{radius:8,height:1}); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true,'line starts powered');

// Hold saved metadata at its old topology, as while chunk rebuilds are pending.
const writeChunk = chunkIndex.writeChunk;
const freeze = () => { chunkIndex.writeChunk = () => { throw new Error('rebuild still pending'); }; };
const thaw = () => { chunkIndex.writeChunk = writeChunk; };
const warn = console.warn; console.warn = () => {};

// Break, as main.js does for a player break.
freeze();
placementIndex.remove(f.dim.id,{x:3,y:0,z:0});
const capture = captureRemovedNetworks(f.dim,3,0,0);
f.store.delete('3,0,0');
const split = removeAndSplitNetwork(capture); await drain(); await split; await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),false,
    'cut-off part turns off immediately, not after the metadata rebuild');
assert.equal(f.store.get('2,0,0').permutation.getState('starstone:powered'),true,'source side stays on');
thaw();
controller.queueChunkRebuild(f.dim,0,0); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),false,'settled metadata agrees');

// Reconnect while metadata still describes the break.
freeze();
const repaired = f.put('starstone:cable',3,0,0);
schedulePlaced(repaired); flushPending(); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true,'reconnect lights the far side at once');
thaw();
// A rebuild whose snapshot predates the reconnect commits afterwards.
placementIndex.remove(f.dim.id,{x:3,y:0,z:0});
await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true,'an older snapshot does not flash it back off');
placementIndex.record(repaired); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true);

// Toggling the source while metadata lags still follows the live network.
placementIndex.remove(f.dim.id,{x:3,y:0,z:0}); await drain();
source.setPermutation(source.permutation.withState('starstone:enabled',false));
reactToGeneratorToggle(f.dim,0,0,0); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),false,'generator off reaches the lamp through stale metadata');
source.setPermutation(source.permutation.withState('starstone:enabled',true));
reactToGeneratorToggle(f.dim,0,0,0); await drain();
assert.equal(lamp.permutation.getState('starstone:powered'),true,'generator on reaches the lamp through stale metadata');
placementIndex.record(repaired); await drain();
console.warn = warn;
console.log('stale metadata: break, reconnect and toggles follow the complete live network immediately');

// A network discovered while fully loaded can later lose a chunk. Its second
// source there is still on; switching the loaded source off must keep power.
{
    const g = fixture(); g.dim.id = 'test:partly_unloaded';
    globalThis.__mcDimensions.set(g.dim.id, g.dim);
    const hidden = new Set();
    g.dim.isChunkLoaded = ({x}) => !hidden.has(Math.floor(x/16));
    const near = g.put('starstone:generator',0,0,0);
    const parts = [near];
    for (let x=1;x<20;x++) { parts.push(g.put('starstone:cable',x,0,0,{'starstone:connections':10})); g.put('minecraft:stone',x,-1,0); }
    const far = g.put('starstone:generator',20,0,0); parts.push(far);
    for (const block of parts) placementIndex.record(block);
    await drain();
    const walker = player(g.dim); walker.location = {x:10,y:0,z:0}; globalThis.__mcPlayers = [walker];
    repair.startRebuildNearby(walker,{radius:12,height:1}); await drain();
    const probe = g.store.get('5,0,0');
    assert.equal(probe.permutation.getState('starstone:powered'),true);
    hidden.add(1); controller.pollLoadedChunks(); await drain();
    near.setPermutation(near.permutation.withState('starstone:enabled',false));
    reactToGeneratorToggle(g.dim,0,0,0); await drain();
    assert.equal(probe.permutation.getState('starstone:powered'),true,
        'a source in a chunk that unloaded after discovery still powers the network');
}
console.log('stale metadata: partly unloaded network keeps its hidden source');
