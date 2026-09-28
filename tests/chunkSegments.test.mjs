import assert from 'node:assert/strict';
import { fixture } from './runtimeFixture.mjs';
import { cableDescriptor, generatorDescriptor, bridgeDescriptor, flatDescriptor } from '../starstone_bp/scripts/electricalBlocks.js';
const { buildChunkSegments, buildIndexedChunkSegments, createChunkIndex, validateChunkSegments, CHUNK_PAGE_BYTES } = await import('../starstone_bp/scripts/chunkIndex.js');

const dim = 'minecraft:overworld';
const entry = (x,y,z,descriptor = cableDescriptor({ mountFace: 'up', connections: 0 })) => ({ location:{x,y,z}, descriptor });
function store() {
    const data = new Map(); let fail;
    return {
        data, failWhen: predicate => { fail = predicate; },
        getDynamicProperty: key => data.get(key),
        getDynamicPropertyIds: () => [...data.keys()],
        setDynamicProperty(key, value) { if (fail?.(key)) throw new Error('storage unavailable'); if (value === undefined) data.delete(key); else data.set(key,value); }
    };
}
function exhaust(generator) {
    let result, yields = 0;
    do { result = generator.next(); if (!result.done) yields++; } while (!result.done);
    return { value:result.value, yields };
}

const entries = [entry(0,0,0), entry(1,0,0), entry(8,0,8), entry(9,0,8)];
const separate = buildChunkSegments(dim,0,0,entries);
assert.equal(separate.segments.length,2);
assert.deepEqual(buildChunkSegments(dim,0,0,[...entries].reverse()), separate, 'stable construction independent of input order');
assert.equal(validateChunkSegments(separate),true);
const bridge = buildChunkSegments(dim,0,0,[entry(8,0,8,bridgeDescriptor({mountFace:'up'})),entry(7,0,8),entry(8,0,7)]);
assert.equal(bridge.segments.length,2);
assert.ok(bridge.segments.every(s => !(s.members.some(m=>m.endsWith('#ns')) && s.members.some(m=>m.endsWith('#ew')))));
const crossing = buildChunkSegments(dim,-1,0,[entry(-1,0,8)]);
assert.ok(crossing.segments[0].boundaries.some(p => p.destination[0] === 0 && p.direction[0] === 1), 'missing visual mask does not remove potential border contact');

const disk = store(), index = createChunkIndex(disk);
index.writeChunk(separate);
assert.deepEqual(createChunkIndex(disk).readChunk(dim,0,0),separate);
const unchanged = new Map(disk.data);
index.writeChunk(separate);
assert.deepEqual(disk.data,unchanged);
const changed = buildChunkSegments(dim,0,0,[entry(0,0,0,generatorDescriptor({sourceOn:true})),entry(1,0,0)]);
disk.failWhen(key=>!key.endsWith(':head'));
assert.throws(()=>index.writeChunk(changed),/storage unavailable/);
assert.deepEqual(createChunkIndex(disk).readChunk(dim,0,0),separate,'partial staging preserves committed bank');
disk.failWhen(key=>key.endsWith(':head'));
assert.throws(()=>index.writeChunk(changed),/storage unavailable/);
assert.deepEqual(createChunkIndex(disk).readChunk(dim,0,0),separate,'failed pointer commit preserves old bank');
disk.failWhen(undefined);
index.writeChunk(changed);
assert.equal(index.updateSource(`${dim}|0|0|0#main`,false),true);
assert.deepEqual(index.readChunk(dim,0,0).segments[0].activeSources,[]);
assert.equal(index.updateSource(`${dim}|1|0|0#main`,true),false,'conductor cannot become a source via patch');

const dense = [];
for(let x=0;x<16;x++) for(let z=0;z<16;z++) for(let y=0;y<16;y++) dense.push(entry(x,y,z));
const denseSnapshot = buildChunkSegments(dim,0,0,dense);
index.writeChunk(denseSnapshot);
assert.deepEqual(createChunkIndex(disk).readChunk(dim,0,0),denseSnapshot);
assert.ok([...disk.data.values()].every(text=>Buffer.byteLength(text,'utf8')<=CHUNK_PAGE_BYTES));
assert.ok([...disk.data.keys()].length>3,'dense snapshot is paged');
const headKey = [...disk.data.keys()].find(key=>key.endsWith(':head'));
const head = JSON.parse(disk.data.get(headKey));
disk.data.set(`${headKey.slice(0,-5)}:${head.bank}:0`,'corrupt');
const warnings=[], broken = createChunkIndex(disk,{warn: text=>warnings.push(text)});
assert.equal(broken.readChunk(dim,0,0),undefined);
assert.equal(broken.readChunk(dim,0,0),undefined);
assert.equal(warnings.length,1);
index.writeChunk(crossing);
assert.deepEqual([...broken.chunks()],[crossing],'one corrupt chunk does not hide others');

const f = fixture();
f.put('starstone:cable',15,0,0,{'minecraft:block_face':'west'});
const actualGet = f.dim.getBlock;
f.dim.isChunkLoaded = p=>Math.floor(p.x/16)===0;
f.dim.getBlock = p=>{ assert.equal(f.dim.isChunkLoaded(p),true,'no unloaded block read'); return actualGet(p); };
const placement = {positionsInChunk:()=>[{x:15,y:0,z:0}]};
const scanned = exhaust(buildIndexedChunkSegments(f.dim,0,0,placement));
assert.equal(scanned.yields,1);
assert.ok(scanned.value.segments[0].boundaries.some(p=>p.direction[0]===1),'potential support contact survives unloaded support');
f.dim.isChunkLoaded = ()=>false;
assert.equal(exhaust(buildIndexedChunkSegments(f.dim,0,0,placement)).value,undefined,'unavailable indexed member prevents a partial replacement');
assert.equal(validateChunkSegments({...crossing,v:999}),false);
assert.equal(validateChunkSegments({...crossing,cx:0}),false,'cross-shard members rejected');
const duplicate = structuredClone(separate); duplicate.segments.push(duplicate.segments[0]);
assert.equal(validateChunkSegments(duplicate),false);
const badLane = buildChunkSegments(dim,0,0,[entry(15,0,8,bridgeDescriptor({mountFace:'up'}))]);
const port = badLane.segments.flatMap(s=>s.boundaries).find(p=>p.direction[0]===1);
port.ref = port.ref.replace('#ew','#ns');
assert.equal(validateChunkSegments(badLane),false);
console.log('chunk segments: stable lanes, guarded reads, paged restart, atomic failure, corruption isolation and source patches passed');
