// Milestone 5 placement-index acceptance tests.  These use the production
// factory with only Bedrock's dynamic-property surface replaced by a Map.
import assert from 'node:assert/strict';
import { fixture } from './runtimeFixture.mjs';

const persistence = await import('../starstone_bp/scripts/persistence.js');
const {
    createPlacementIndex,
    PLACEMENT_PROPERTY_PREFIX,
    PLACEMENT_SCHEMA_VERSION,
    PLACEMENT_SECTION_SIZE,
    PLACEMENT_MAX_STRING_BYTES
} = persistence;

function mapStorage(values = new Map()) {
    return {
        values,
        getDynamicProperty(key) { return values.get(key); },
        setDynamicProperty(key, value) { values.set(key, value); },
        getDynamicPropertyIds() { return [...values.keys()]; }
    };
}

function complete(generator) {
    let step;
    do step = generator.next(); while (!step.done);
    return step.value;
}

assert.equal(PLACEMENT_SCHEMA_VERSION, 1, 'the persisted schema has an explicit version');
assert.equal(PLACEMENT_SECTION_SIZE, 16, 'index sections use Minecraft section height');
assert.equal(PLACEMENT_MAX_STRING_BYTES, 32767, 'index respects Bedrock property limits');
assert.match(PLACEMENT_PROPERTY_PREFIX, /^starstone:/, 'index keys have a private namespace');

// Coordinates must use floor division, including in negative chunks, and
// recording the same live block must never add a duplicate position.
{
    const f = fixture();
    const index = createPlacementIndex(mapStorage());
    const positive = f.put('starstone:cable', 15, 31, 0);
    const negative = f.put('starstone:lamp', -1, -1, -17);
    assert.equal(index.record(positive), true);
    assert.equal(index.record(positive), true, 'record is idempotent');
    assert.equal(index.record(negative), true);
    assert.deepEqual(index.positionsInChunk('minecraft:overworld', 0, 0), [{ x:15, y:31, z:0 }]);
    assert.deepEqual(index.positionsInChunk('minecraft:overworld', -1, -2), [{ x:-1, y:-1, z:-17 }]);
    const copy = index.positionsInChunk('minecraft:overworld', 0, 0);
    copy[0].x = 99;
    assert.deepEqual(index.positionsInChunk('minecraft:overworld', 0, 0), [{ x:15, y:31, z:0 }], 'queries return copied locations');
    assert.equal(index.remove('minecraft:overworld', { x:15, y:31, z:0 }), true);
    assert.equal(index.remove('minecraft:overworld', { x:15, y:31, z:0 }), true, 'removing an absent position is idempotent');
}

// A new factory over the same dynamic-property map represents a script/world
// restart.  It must read persisted data rather than retain process memory.
{
    const f = fixture();
    const store = mapStorage();
    const first = createPlacementIndex(store);
    first.record(f.put('starstone:generator', 32, 5, -1));
    first.record(f.put('starstone:conduit', 33, 20, -1));
    const restarted = createPlacementIndex(store);
    assert.deepEqual(restarted.positionsInChunk('minecraft:overworld', 2, -1), [
        { x:32, y:5, z:-1 }, { x:33, y:20, z:-1 }
    ]);
    assert.deepEqual(restarted.stats(), { shards:2, positions:2 }, 'separate 16-high sections persist separately');
}

// A completely full 16x16x16 section is the difficult payload case.  The
// contract permits sharding further, but no individual dynamic string may pass
// the Bedrock byte limit and every recorded position must survive.
{
    const f = fixture();
    const store = mapStorage();
    const index = createPlacementIndex(store);
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        index.record(f.put('starstone:cable', x, y, z));
    }
    assert.equal(index.stats().positions, 4096, 'a dense section retains every location');
    const payloads = [...store.values.values()].filter(value => typeof value === 'string');
    assert.ok(payloads.length > 0, 'dense data is persisted');
    assert.ok(payloads.every(value => Buffer.byteLength(value, 'utf8') <= PLACEMENT_MAX_STRING_BYTES), 'every shard stays within the Bedrock string limit');
    assert.equal(index.positionsInChunk('minecraft:overworld', 0, 0).length, 4096);
}

// One bad property must be isolated: it is warned once and discarded, while
// other chunks remain usable and the damaged payload is not overwritten.
{
    const f = fixture();
    const store = mapStorage();
    const originalWarn = console.warn;
    const warnings = [];
    const index = createPlacementIndex(store, { warn: message => warnings.push(String(message)) });
    index.record(f.put('starstone:cable', 0, 0, 0));
    index.record(f.put('starstone:lamp', 32, 0, 0));
    const corruptKey = `${PLACEMENT_PROPERTY_PREFIX}${encodeURIComponent('minecraft:overworld')}|0|0|0`;
    const preserved = store.values.get(corruptKey);
    assert.equal(typeof preserved, 'string', 'test selected an actual persisted shard');
    store.values.set(corruptKey, '{bad json');
    const restarted = createPlacementIndex(store, { warn: message => warnings.push(String(message)) });
    assert.deepEqual(restarted.positionsInChunk('minecraft:overworld', 0, 0), []);
    assert.deepEqual(restarted.positionsInChunk('minecraft:overworld', 2, 0), [{ x:32, y:0, z:0 }]);
    restarted.positionsInChunk('minecraft:overworld', 0, 0);
    assert.equal(warnings.length, 1, 'a corrupt shard warns only once');
    assert.equal(store.values.get(corruptKey), '{bad json', 'reading corruption never silently rewrites it');
    console.warn = originalWarn;
}

// Validation treats loaded world state as authoritative, while a missing chunk
// is explicitly unknown rather than evidence that an indexed block was removed.
{
    const f = fixture();
    const index = createPlacementIndex(mapStorage());
    const stale = f.put('starstone:cable', 1, 0, 0);
    const unavailable = f.put('starstone:lamp', 2, 0, 0);
    index.record(stale); index.record(unavailable);
    f.store.delete('1,0,0');
    f.unloaded.add('2,0,0');
    const summary = complete(index.validateChunk(f.dim, 0, 0));
    assert.deepEqual(summary, { checked:2, removed:1, unavailable:1 });
    assert.deepEqual(index.positionsInChunk(f.dim.id, 0, 0), [{ x:2, y:0, z:0 }], 'unloaded entries are preserved');
}

// A failed dynamic-property write is not a durable record and cannot leave a
// stale in-memory success behind.
{
    const f = fixture();
    const storage = {
        getDynamicProperty() { return undefined; },
        setDynamicProperty() { throw new Error('storage unavailable'); },
        getDynamicPropertyIds() { return []; }
    };
    const index = createPlacementIndex(storage);
    assert.throws(() => index.record(f.put('starstone:cable', 0, 0, 0)), /storage unavailable/);
    assert.deepEqual(index.positionsInChunk('minecraft:overworld', 0, 0), []);
    assert.deepEqual(index.stats(), { shards:0, positions:0 });
}

console.log('persistence: restart, coordinates, dense payload, corruption, validation and failed-write contracts passed');
