// Milestone 7 acceptance tests: construct chunk snapshots from pure descriptor
// fixtures, then prove the metadata-only graph has exactly the permitted edges.
import assert from 'node:assert/strict';
import './runtimeFixture.mjs'; // installs the @minecraft/server resolver for chunkIndex

const { buildChunkSegments } = await import('../starstone_bp/scripts/chunkIndex.js');
const { buildSegmentGraph } = await import('../starstone_bp/scripts/segmentGraph.js');

const DIMENSION = 'test:segments';
const ref = (x, y, z, lane = 'main') => `${DIMENSION}|${x}|${y}|${z}#${lane}`;
const lane = (ports, sourceOn = false, id = 'main') => ({ id, ports: new Set(ports), sourceOn });
const cable = (ports = []) => ({ kind:'cable', mountFace:'up', lanes:[lane(ports)] });
const flat = (kind, face, ports, sourceOn = false) => ({ kind, mountFace:face, lanes:[lane(ports, sourceOn)] });
const source = (ports, sourceOn) => ({ kind:'source', lanes:[lane(ports, sourceOn)] });
const conduit = axis => ({
    kind:'conduit', lanes:[lane(axis === 'x' ? ['world_east', 'world_west'] : axis === 'y' ? ['world_up', 'world_down'] : ['world_north', 'world_south'])]
});
const entry = (x, y, z, descriptor) => ({ location:{ x, y, z }, descriptor });
function networkFor(graph, node) {
    const network = graph.nodeToNetwork.get(node);
    assert.ok(network, `expected ${node} to be indexed`);
    return network;
}
function segmentFor(snapshot, node) {
    const segment = snapshot.segments.find(candidate => candidate.members.includes(node));
    assert.ok(segment, `expected ${node} to be in a segment`);
    return segment;
}

// Build a three-chunk logical circuit.  A and C have only boundary metadata
// between them; all physical links in B are represented by its saved segment.
const a = buildChunkSegments(DIMENSION, 0, 0, [
    entry(15, 0, 0, source(['world_east'], true))
]);
const bEntries = [];
for (let x = 16; x < 32; x++) bEntries.push(entry(x, 0, 0, cable()));
const b = buildChunkSegments(DIMENSION, 1, 0, bEntries);
const c = buildChunkSegments(DIMENSION, 2, 0, [
    entry(32, 0, 0, flat('consumer', 'up', ['local_w']))
]);

assert.deepEqual(
    buildChunkSegments(DIMENSION, 1, 0, [...bEntries].reverse()),
    b,
    'unchanged observations produce stable segment keys and metadata independent of input order'
);

{
    const graph = buildSegmentGraph([a, b, c]);
    assert.equal(graph.networks.length, 1, 'A connects to C through saved B metadata');
    const network = networkFor(graph, ref(15, 0, 0));
    assert.equal(networkFor(graph, ref(32, 0, 0)), network, 'source and distant consumer share one logical network');
    assert.equal(network.powered, true);
    assert.equal(network.sources.size, 1);
    assert.equal(network.consumers.size, 1);
    assert.ok(!network.unresolvedBoundaries.has(`${ref(15, 0, 0)}|1,0,0`), 'A to B boundary is reciprocal');
    assert.ok(!network.unresolvedBoundaries.has(`${ref(31, 0, 0)}|1,0,0`), 'B to C boundary is reciprocal');
    assert.ok(!network.unresolvedBoundaries.has(`${ref(32, 0, 0)}|-1,0,0`), 'C to B boundary is reciprocal');
    assert.equal(network.nodes.size, 18, 'the graph uses metadata members without reading blocks');
}

// A matching destination chunk alone is insufficient: a missing reciprocal
// port must leave both segment networks separate and retain the unresolved edge.
{
    const nonReciprocalB = structuredClone(b);
    const segment = segmentFor(nonReciprocalB, ref(16, 0, 0));
    segment.boundaries = segment.boundaries.filter(port => port.direction.join(',') !== '-1,0,0');
    const graph = buildSegmentGraph([a, nonReciprocalB]);
    const left = networkFor(graph, ref(15, 0, 0));
    const right = networkFor(graph, ref(16, 0, 0));
    assert.notEqual(left, right, 'one-sided metadata does not form a logical edge');
    assert.ok(left.unresolvedBoundaries.has(`${ref(15, 0, 0)}|1,0,0`), 'the absent reciprocal remains explicit');
}

// A single bridge position contributes two local components.  The powered
// north/south source cannot leak into the east/west lane with an off source.
{
    const bridge = {
        kind:'bridge', mountFace:'up', lanes:[
            lane(['local_n', 'local_s'], false, 'ns'),
            lane(['local_e', 'local_w'], false, 'ew')
        ]
    };
    const snapshot = buildChunkSegments(DIMENSION, 3, 0, [
        entry(56, 0, 7, source(['world_south'], true)),
        entry(56, 0, 8, bridge),
        entry(56, 0, 9, flat('consumer', 'up', ['local_n'])),
        entry(55, 0, 8, source(['world_east'], false)),
        entry(57, 0, 8, flat('consumer', 'up', ['local_w']))
    ]);
    const graph = buildSegmentGraph([snapshot]);
    const ns = networkFor(graph, ref(56, 0, 8, 'ns'));
    const ew = networkFor(graph, ref(56, 0, 8, 'ew'));
    assert.notEqual(ns, ew, 'bridge ns and ew lanes remain separate graph nodes');
    assert.equal(ns.powered, true);
    assert.equal(ew.powered, false);
    assert.equal(ns.consumers.size, 1);
    assert.equal(ew.consumers.size, 1);
}

// Reciprocal world vectors are not enough when two surface blocks have different
// mounting planes.  This catches the tempting but wrong edge implementation.
{
    const snapshot = buildChunkSegments(DIMENSION, 4, 0, [
        entry(64, 0, 0, cable(['local_e'])),
        entry(65, 0, 0, flat('consumer', 'north', ['world_west']))
    ]);
    const graph = buildSegmentGraph([snapshot]);
    assert.notEqual(networkFor(graph, ref(64, 0, 0)), networkFor(graph, ref(65, 0, 0)), 'different mounting planes do not join');
}

// The sole valid surface-to-conduit edge is a surface back contact on the
// matching conduit axis. A sideways surface contact must remain disconnected.
{
    const through = buildChunkSegments(DIMENSION, 5, 0, [
        entry(80, 1, 0, cable(['back'])),
        entry(80, 0, 0, conduit('y')),
        entry(80, -1, 0, flat('consumer', 'down', ['back']))
    ]);
    const graph = buildSegmentGraph([through]);
    assert.equal(graph.networks.length, 1, 'matching conduit ends join the two surface back contacts');
    assert.equal(networkFor(graph, ref(80, 1, 0)), networkFor(graph, ref(80, -1, 0)));

    const perpendicular = buildChunkSegments(DIMENSION, 6, 0, [
        entry(96, 0, 0, conduit('y')),
        entry(97, 0, 0, flat('consumer', 'east', ['back']))
    ]);
    const rejected = buildSegmentGraph([perpendicular]);
    assert.notEqual(networkFor(rejected, ref(96, 0, 0)), networkFor(rejected, ref(97, 0, 0)), 'a perpendicular conduit face is not a back-contact route');
}

// Source summaries determine logical power without the graph loading a chunk.
// An active source powers a component with two sources; regenerating metadata
// after it turns off makes the identical topology unpowered.
{
    const entries = on => [
        entry(112, 0, 0, source(['world_east'], on)),
        entry(113, 0, 0, cable()),
        entry(114, 0, 0, source(['world_west', 'world_east'], false)),
        entry(115, 0, 0, flat('consumer', 'up', ['local_w']))
    ];
    const onGraph = buildSegmentGraph([buildChunkSegments(DIMENSION, 7, 0, entries(true))]);
    const onNetwork = networkFor(onGraph, ref(115, 0, 0));
    assert.equal(onNetwork.sources.size, 2, 'both source summaries survive local segmentation');
    assert.equal(onNetwork.activeSources.size, 1);
    assert.equal(onNetwork.powered, true);

    const offGraph = buildSegmentGraph([buildChunkSegments(DIMENSION, 7, 0, entries(false))]);
    const offNetwork = networkFor(offGraph, ref(115, 0, 0));
    assert.equal(offNetwork.sources.size, 2, 'turning off a source does not remove topology');
    assert.equal(offNetwork.activeSources.size, 0);
    assert.equal(offNetwork.powered, false, 'source-state update recomputes binary logical power');
}

// Segment metadata is an all-or-nothing input.  Missing or corrupt records are
// rejected rather than accidentally creating partial logical connections.
{
    assert.throws(() => buildSegmentGraph([undefined]), /Invalid|Cannot/);
    const corrupt = structuredClone(a);
    corrupt.segments[0].members.push(corrupt.segments[0].members[0]);
    assert.throws(() => buildSegmentGraph([corrupt]), /Invalid segment graph input/);
    assert.throws(() => buildSegmentGraph([a, structuredClone(a)]), /Duplicate segment chunk/);
}

console.log('segment graph: unloaded-middle, reciprocal boundaries, bridge lanes, plane/conduit isolation, sources and corrupt metadata passed');
