import assert from 'node:assert/strict';
import { fixture, drain } from './runtimeFixture.mjs';
const { computeCableMask, scheduleAffected, flushPending } = await import('../starstone_bp/scripts/cableComponent.js');
const { discoverNetwork } = await import('../starstone_bp/scripts/networkGraph.js');
const { buildChunkSegments, validateChunkSegments } = await import('../starstone_bp/scripts/chunkIndex.js');
const { buildSegmentGraph } = await import('../starstone_bp/scripts/segmentGraph.js');
const { captureRemovedNetworks, removeAndSplitNetwork } = await import('../starstone_bp/scripts/networkController.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const { outerCornerOffset, outerCornerContact } = await import('../starstone_bp/scripts/cornerTopology.js');
const { FACE_LIST, faceNormal } = await import('../starstone_bp/scripts/surfaceFrame.js');

const f=fixture(); f.dim.id='test:outer-corner';
const source=f.put('starstone:generator',14,1,0);
f.put('minecraft:stone',15,0,0);
const floor=f.put('starstone:cable',15,1,0,{'minecraft:block_face':'up'});
const wall=f.put('starstone:cable',16,0,0,{'minecraft:block_face':'east'});
assert.deepEqual(outerCornerOffset('up','east'),[1,-1,0]);
assert.deepEqual(outerCornerOffset('east','up'),[-1,1,0]);
assert.equal(outerCornerOffset('up','down'),undefined,'parallel faces do not wrap');
for (const a of FACE_LIST) for (const b of FACE_LIST) {
    const delta=outerCornerOffset(a,b);
    if (!delta) continue;
    assert.deepEqual(outerCornerOffset(b,a),delta.map(v=>v===0?0:-v),`${a}/${b} reciprocal offset`);
    assert.equal(outerCornerContact({kind:'cable',mountFace:a},{kind:'cable',mountFace:b},
        delta,faceNormal(b),faceNormal(a)),true,`${a}/${b} connects at shared support edge`);
}
assert.equal(computeCableMask(floor)&2,2,'floor arm reaches east outside edge');
assert.equal(computeCableMask(wall)&1,1,'wall arm reaches up outside edge');
floor.setPermutation(floor.permutation.withState('starstone:connections',computeCableMask(floor)));
wall.setPermutation(wall.permutation.withState('starstone:connections',computeCableMask(wall)));
const livePromise=discoverNetwork(source);
await drain();
const live=await livePromise;
assert.ok(live.nodes.has(`${f.dim.id}|16|0|0#main`),'live graph crosses diagonal outside edge');
f.store.delete('16,0,0');
scheduleAffected(wall);
flushPending();
assert.equal(floor.permutation.getState('starstone:connections')&2,0,
    'breaking wall-side cable refreshes floor arm across diagonal');
f.put('starstone:cable',16,0,0,{'minecraft:block_face':'east'});
scheduleAffected(wall);
flushPending();
assert.equal(floor.permutation.getState('starstone:connections')&2,2,
    'restoring wall-side cable refreshes floor arm');
runtime.clearNetworks();
runtime.registerNetwork({...live,powered:true});
const captured=captureRemovedNetworks(f.dim,15,1,0);
f.store.delete('15,1,0');
const splitPromise=removeAndSplitNetwork(captured);
await drain();
await splitPromise;
const sourceNetwork=runtime.networkIdOf(`${f.dim.id}|14|1|0#main`);
const wallNetwork=runtime.networkIdOf(`${f.dim.id}|16|0|0#main`);
assert.ok(sourceNetwork && wallNetwork && sourceNetwork!==wallNetwork,
    'breaking corner-side cable splits diagonal neighbor from source');
assert.equal(runtime.networkOf(wallNetwork).powered,false,'orphaned wall cable turns off');

const lane=ports=>({id:'main',ports:new Set(ports),sourceOn:false});
const cable=(face)=>({kind:'cable',mountFace:face,lanes:[lane([])]});
const generator={kind:'source',lanes:[{id:'main',ports:new Set(['world_east']),sourceOn:true}]};
const a=buildChunkSegments(f.dim.id,0,0,[
    {location:{x:14,y:1,z:0},descriptor:generator},
    {location:{x:15,y:1,z:0},descriptor:cable('up')}
]);
const b=buildChunkSegments(f.dim.id,1,0,[
    {location:{x:16,y:0,z:0},descriptor:cable('east')}
]);
assert.ok(validateChunkSegments(a) && validateChunkSegments(b),'diagonal boundary persists validly');
const graph=buildSegmentGraph([a,b]);
assert.equal(graph.nodeToNetwork.get(`${f.dim.id}|14|1|0#main`),
    graph.nodeToNetwork.get(`${f.dim.id}|16|0|0#main`),'saved segments join across chunk edge');
assert.equal(graph.nodeToNetwork.get(`${f.dim.id}|16|0|0#main`).powered,true);
const broken=buildSegmentGraph([a]);
assert.ok(broken.nodeToNetwork.get(`${f.dim.id}|15|1|0#main`).unresolvedBoundaries.size>0,
    'missing destination leaves a reconcilable corner boundary');

// Same-cell inner turns cannot hold two different face states in this block
// format; the helper must never invent an electrical edge for coincident cells.
assert.equal(outerCornerContact(cable('up'),cable('west'),[0,0,0],[0,0,0],[0,0,0]),false);
console.log('outer corners: reciprocal masks, live graph, chunk-boundary metadata and inner-corner limit passed');
