// Milestone 5 recovery acceptance tests.  Every reconstruction below goes
// through the production worker and the regular run/runJob fixture scheduler.
import assert from 'node:assert/strict';
import { mc, fixture, player, drain } from './runtimeFixture.mjs';

const repair = await import('../starstone_bp/scripts/repair.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const { placementIndex, PLACEMENT_PROPERTY_PREFIX } = await import('../starstone_bp/scripts/persistence.js');

function ref(dim, x, y, z, lane = 'main') {
    return `${dim.id}|${x}|${y}|${z}#${lane}`;
}
function withDimensionId(f, id) {
    f.dim.id = id;
    return f;
}
function spawn(playerEntity, initialSpawn = true) {
    repair.queueInitialSpawn({ player: playerEntity, initialSpawn });
}

assert.equal(repair.REBUILD_RADIUS, 8);
assert.equal(repair.REBUILD_HEIGHT, 4);

// A manual scan must reconstruct a real network after the in-memory graph has
// gone away.  It also records the live blocks it observed for future repairs.
{
    runtime.clearNetworks();
    const f = withDimensionId(fixture(), 'test:repair-manual');
    const generator = f.put('starstone:generator', 0, 0, 0);
    const cable = f.put('starstone:cable', 1, 0, 0);
    const lamp = f.put('starstone:lamp', 2, 0, 0);
    f.put('minecraft:stone', 1, -1, 0); f.put('minecraft:stone', 2, -1, 0);
    const user = player(f.dim, cable);
    assert.equal(repair.startRebuildNearby(user, { radius:2, height:1 }), true);
    assert.equal(repair.startRebuildNearby(user), false, 'a concurrent manual request is rejected');
    await drain();
    assert.equal(repair.isRebuildRunning(), false);
    assert.equal(runtime.networkCount(), 1);
    assert.equal(runtime.nodeCount(), 3);
    assert.equal(lamp.permutation.getState('starstone:powered'), true, 'reconstruction applies source power');
    assert.equal(cable.permutation.getState('starstone:connections'), 10, 'all seed cable masks refresh before discovery');
    assert.deepEqual(placementIndex.positionsInChunk(f.dim.id, 0, 0), [
        { x:0, y:0, z:0 }, { x:1, y:0, z:0 }, { x:2, y:0, z:0 }
    ], 'recovery records observed electrical blocks');
    assert.ok(user.messages.some(message => message.includes('Rebuild complete')), 'manual recovery reports completion');
    assert.equal(generator.writes, 0, 'source state is never rewritten by recovery');
}

// Manual bounds are hard limits even for internal callers, and automatic
// recovery covers the entire origin section instead of a player-offset cube.
{
    runtime.clearNetworks();
    const manual = withDimensionId(fixture(), 'test:repair-manual-budget');
    let manualReads = 0;
    const manualRead = manual.dim.getBlock;
    manual.dim.getBlock = location => { manualReads++; return manualRead(location); };
    assert.equal(repair.startRebuildNearby(player(manual.dim), { radius:999, height:999 }), true);
    await drain();
    assert.equal(manualReads, 2601, 'manual scans stay at the 17x9x17 maximum');

    const automatic = withDimensionId(fixture(), 'test:repair-auto-budget');
    let automaticReads = 0;
    const automaticRead = automatic.dim.getBlock;
    automatic.dim.getBlock = location => { automaticReads++; return automaticRead(location); };
    const autoPlayer = player(automatic.dim); autoPlayer.location = { x:7, y:8, z:7 };
    spawn(autoPlayer);
    await drain();
    assert.equal(automaticReads, 4096, 'initial spawn scans all 16x16x16 cells in its section');
}

// Initial spawn runs once after a restart, while an ordinary respawn never
// launches work and an already-completed section stays suppressed.
{
    runtime.clearNetworks();
    const f = withDimensionId(fixture(), 'test:repair-initial-once');
    const generator = f.put('starstone:generator', 0, 0, 0);
    const cable = f.put('starstone:cable', 1, 0, 0);
    const lamp = f.put('starstone:lamp', 2, 0, 0);
    f.put('minecraft:stone', 1, -1, 0); f.put('minecraft:stone', 2, -1, 0);
    const first = player(f.dim, cable);
    spawn(first, false);
    await drain();
    assert.equal(runtime.networkCount(), 0, 'a normal respawn is ignored');
    spawn(first, true);
    await drain();
    assert.equal(lamp.permutation.getState('starstone:powered'), true);
    assert.equal(runtime.networkCount(), 1, 'first initial spawn reconstructs the network');
    runtime.clearNetworks();
    spawn(first, true);
    await drain();
    assert.equal(runtime.networkCount(), 0, 'the completed origin section runs only once');
    assert.equal(generator.writes, 0);
}

// The deduplication key includes dimension and vertical section.  These three
// requests must each complete even though their x/z chunks are the same.
{
    runtime.clearNetworks();
    const before = repair.recoveryStats().completedAreas;
    const low = withDimensionId(fixture(), 'test:repair-isolation');
    const high = withDimensionId(fixture(), 'test:repair-isolation');
    const other = withDimensionId(fixture(), 'test:repair-other-dimension');
    const lowPlayer = player(low.dim); lowPlayer.location = { x:1, y:1, z:1 };
    const highPlayer = player(high.dim); highPlayer.location = { x:1, y:17, z:1 };
    const otherPlayer = player(other.dim); otherPlayer.location = { x:1, y:1, z:1 };
    spawn(lowPlayer); spawn(highPlayer); spawn(otherPlayer);
    await drain();
    const after = repair.recoveryStats();
    assert.equal(after.completedAreas, before + 3, 'dimension and vertical section both participate in deduplication');
    assert.equal(after.queued, 0);
    assert.equal(after.running, false);
}

// A second origin is queued while a job owns the worker, whereas a duplicate
// origin is suppressed before it can become a second job.
{
    runtime.clearNetworks();
    const busy = withDimensionId(fixture(), 'test:repair-queue-busy');
    const waiting = withDimensionId(fixture(), 'test:repair-queue-waiting');
    const busyPlayer = player(busy.dim); busyPlayer.location = { x:1, y:1, z:1 };
    const waitingPlayer = player(waiting.dim); waitingPlayer.location = { x:1, y:1, z:1 };
    assert.equal(repair.startRebuildNearby(busyPlayer, { radius:0, height:0 }), true);
    const standardRun = globalThis.__mcRun;
    const deferred = [];
    globalThis.__mcRun = callback => { deferred.push(callback); return deferred.length; };
    spawn(waitingPlayer); spawn(waitingPlayer);
    assert.equal(deferred.length, 2, 'each event safely defers its mutable player capture');
    for (const callback of deferred.splice(0)) callback();
    assert.deepEqual(repair.recoveryStats(), { running:true, queued:1, completedAreas:repair.recoveryStats().completedAreas });
    globalThis.__mcRun = standardRun;
    await drain();
    assert.equal(repair.recoveryStats().queued, 0, 'the queued origin is eventually processed');
    assert.equal(repair.isRebuildRunning(), false);
}

// Failures both before scheduling and while a scheduled generator runs must
// clear the global guard so a later valid request is never locked out.
{
    const sendFailure = player(withDimensionId(fixture(), 'test:repair-message-failure').dim);
    sendFailure.sendMessage = () => { throw new Error('player vanished'); };
    assert.throws(() => repair.startRebuildNearby(sendFailure), /player vanished/);
    assert.equal(repair.isRebuildRunning(), false, 'a scheduling failure clears the guard');

    const disconnectedFixture = withDimensionId(fixture(), 'test:repair-disconnect');
    const disconnected = player(disconnectedFixture.dim);
    assert.equal(repair.startRebuildNearby(disconnected, { radius:0, height:0 }), true);
    disconnected.isValid = false;
    await drain();
    assert.equal(repair.isRebuildRunning(), false, 'a traversal disconnect clears the guard');
    const recovery = player(withDimensionId(fixture(), 'test:repair-after-failure').dim);
    assert.equal(repair.startRebuildNearby(recovery, { radius:0, height:0 }), true);
    await drain();
}

// Both lanes of one bridge must be reconstructed and remain independent.  The
// north/south source is on; the east/west source is off.
{
    runtime.clearNetworks();
    const f = withDimensionId(fixture(), 'test:repair-bridge');
    f.put('starstone:generator', 1, 0, -1, { 'starstone:enabled': true });
    const bridge = f.put('starstone:bridge', 1, 0, 0);
    f.put('starstone:lamp', 1, 0, 1);
    f.put('starstone:generator', 0, 0, 0, { 'starstone:enabled': false });
    f.put('starstone:lamp', 2, 0, 0);
    assert.equal(repair.startRebuildNearby(player(f.dim), { radius:2, height:1 }), true);
    await drain();
    const ns = runtime.networkIdOf(ref(f.dim, 1, 0, 0, 'ns'));
    const ew = runtime.networkIdOf(ref(f.dim, 1, 0, 0, 'ew'));
    assert.equal(typeof ns, 'number', 'bridge ns lane is discovered');
    assert.equal(typeof ew, 'number', 'bridge ew lane is discovered');
    assert.notEqual(ns, ew, 'bridge lanes never merge into one network');
    assert.equal(bridge.permutation.getState('starstone:powered_ns'), true);
    assert.equal(bridge.permutation.getState('starstone:powered_ew'), false);
    assert.equal(runtime.invariantHolds(), true);
}

// A corrupt placement hint is never authoritative.  The worker must retain the
// damaged shard yet still rebuild the live circuit in that same chunk.
{
    runtime.clearNetworks();
    const stored = new Map();
    mc.world.getDynamicProperty = key => stored.get(key);
    mc.world.getDynamicPropertyIds = () => [...stored.keys()];
    mc.world.setDynamicProperty = (key, value) => {
        if (value === undefined) stored.delete(key);
        else stored.set(key, value);
    };
    const f = withDimensionId(fixture(), 'test:repair-corrupt');
    const corruptKey = `${PLACEMENT_PROPERTY_PREFIX}${encodeURIComponent(f.dim.id)}|0|0|0`;
    stored.set(corruptKey, '{not valid json');
    f.put('starstone:generator', 0, 0, 0);
    f.put('starstone:cable', 1, 0, 0);
    const lamp = f.put('starstone:lamp', 2, 0, 0);
    f.put('minecraft:stone', 1, -1, 0); f.put('minecraft:stone', 2, -1, 0);
    assert.equal(repair.startRebuildNearby(player(f.dim), { radius:2, height:1 }), true);
    await drain();
    assert.equal(runtime.networkCount(), 1, 'live blocks rebuild despite a corrupt placement shard');
    assert.equal(lamp.permutation.getState('starstone:powered'), true);
    assert.equal(stored.get(corruptKey), '{not valid json', 'recovery never overwrites the corrupt shard');
}

// A real dynamic-property write failure fails that automatic attempt, but it
// must not mark its section complete and suppress a later initial-spawn retry.
{
    runtime.clearNetworks();
    const stored = new Map();
    let writesFail = true;
    mc.world.getDynamicProperty = key => stored.get(key);
    mc.world.getDynamicPropertyIds = () => [...stored.keys()];
    mc.world.setDynamicProperty = (key, value) => {
        if (writesFail) throw new Error('temporary storage failure');
        if (value === undefined) stored.delete(key);
        else stored.set(key, value);
    };
    const f = withDimensionId(fixture(), 'test:repair-storage-retry');
    f.put('starstone:generator', 0, 0, 0);
    f.put('starstone:cable', 1, 0, 0);
    const lamp = f.put('starstone:lamp', 2, 0, 0);
    f.put('minecraft:stone', 1, -1, 0); f.put('minecraft:stone', 2, -1, 0);
    const initial = player(f.dim); initial.location = { x:1, y:1, z:1 };
    const completedBefore = repair.recoveryStats().completedAreas;
    spawn(initial);
    await drain();
    assert.equal(repair.isRebuildRunning(), false, 'a failed automatic job clears its guard');
    assert.equal(repair.recoveryStats().completedAreas, completedBefore, 'a failed attempt is not completed');
    writesFail = false;
    spawn(initial);
    await drain();
    assert.equal(repair.recoveryStats().completedAreas, completedBefore + 1, 'the same initial-spawn area retries successfully');
    assert.equal(lamp.permutation.getState('starstone:powered'), true);
}

// registerRecovery binds only initial-spawn events.  The subscription path is
// exercised here rather than relying solely on direct queueInitialSpawn calls.
{
    repair.registerRecovery();
    const f = withDimensionId(fixture(), 'test:repair-event-registration');
    const eventPlayer = player(f.dim); eventPlayer.location = { x:1, y:1, z:1 };
    for (const callback of globalThis.__mcWorldSubscribers.playerSpawn || []) {
        callback({ player:eventPlayer, initialSpawn:false });
    }
    await drain();
    assert.equal(repair.recoveryStats().running, false);
}

console.log('repair: manual and initial recovery, budgets, queues, cleanup, bridge lanes and index integration passed');
