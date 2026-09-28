// networkRuntime.js
//
// Runtime network index for the Starstone electrical graph (Task 4.1). Owns the
// two indexes that tie the discovery system to persisted world state:
//
//   networks        id      -> network record
//   nodeToNetwork   NodeRef -> id
//
// A network record matches plan section 5.5:
//
//   {
//     id: number,
//     nodes: Set<NodeRef>,
//     sources: Set<NodeRef>,
//     consumers: Set<NodeRef>,
//     powered: boolean,
//     unresolvedBoundaries: Set<BoundaryKey>
//   }
//
// A NodeRef is a plain string ("<dim>|<x>|<y>|<z>#<lane>"). A bridge block
// exposes two NodeRefs (#ns and #ew) that are never joined to each other, so the
// only way one block position feeds two networks is for those two references to
// land in two different runtime networks. This module keeps that invariant.
//
// It never touches a block or a permutation. Power-only updates and discovery
// live in later tasks; the record.powered flag is filled in when a network is
// registered. A fresh instance is returned by createRuntime() so pure tests run
// against an isolated index, and the default export is the single instance the
// pack shares for its lifetime.

// Each runtime owns its own indexes. Keeping them inside this factory prevents
// a test runtime from resetting the pack's shared default runtime.
function createRuntime() {
// The two indexes, plus the next id to hand out.
let networks;
let nodeToNetwork;
let nextId;

function resetState() {
    networks = new Map();
    nodeToNetwork = new Map();
    nextId = 1;
}

resetState();

// Hand out the next network id. Ids are small positive integers and reset on a
// full clear so a reloaded world starts numbering from one.
function allocateId() {
    const id = nextId;
    nextId += 1;
    return id;
}

// Register a discovered network. Assigns an id when the record has none and
// fills any missing record fields so a partial discovery still forms a valid
// record. Enforces the invariant that every NodeRef belongs to at most one
// runtime network: adding a network that shares a node with a different one
// throws instead of violating the invariant. Returns the stored record.
function addNetwork(network, { assignId = true } = {}) {
    if (!network || typeof network !== "object") {
        throw new Error("networkRuntime: addNetwork requires a network record");
    }
    if (!(network.nodes instanceof Set)) {
        throw new Error("networkRuntime: network.nodes must be a Set of NodeRefs");
    }

    for (const node of network.nodes) {
        const owner = nodeToNetwork.get(node);
        if (owner !== undefined && owner !== network.id) {
            throw new Error(
                `networkRuntime: node ${node} already belongs to network ${owner}`
            );
        }
    }

    const id = assignId || network.id === undefined || network.id === null
        ? allocateId()
        : network.id;

    const record = {
        id,
        nodes: network.nodes,
        sources: network.sources instanceof Set ? network.sources : new Set(),
        consumers: network.consumers instanceof Set ? network.consumers : new Set(),
        powered: Boolean(network.powered),
        unresolvedBoundaries:
            network.unresolvedBoundaries instanceof Set
                ? network.unresolvedBoundaries
                : new Set()
    };

    networks.set(id, record);
    for (const node of record.nodes) {
        nodeToNetwork.set(node, id);
    }
    return record;
}

// Register a freshly discovered network (plan section 5.5, plus a powered flag
// the controller computes as "any source is on"). A discovery rarely arrives into
// empty space: it usually overlaps a network that was cached before, so every
// cached network that already claims any of the new nodes is dropped first and the
// new record becomes the single owner of every node it lists. The one-network-per-
// node invariant is restored rather than violated. Returns the stored record.
function registerNetwork(discovered, { assignId = true } = {}) {
    if (!discovered || typeof discovered !== "object" || !(discovered.nodes instanceof Set)) {
        throw new Error("networkRuntime: registerNetwork requires a discovered network record");
    }

    const overlapping = new Set();
    for (const node of discovered.nodes) {
        const owner = nodeToNetwork.get(node);
        if (owner !== undefined) {
            overlapping.add(owner);
        }
    }
    for (const id of overlapping) {
        removeNetwork(id);
    }

    return addNetwork(discovered, { assignId });
}

// Drop a network by id and release every NodeRef it held so those nodes may join
// another network. Returns true when a network was removed.
function removeNetwork(id) {
    const record = networks.get(id);
    if (!record) {
        return false;
    }
    for (const node of record.nodes) {
        nodeToNetwork.delete(node);
    }
    networks.delete(id);
    return true;
}

// The id a NodeRef currently belongs to, or undefined when it is unassigned.
function networkIdOf(nodeRef) {
    return nodeToNetwork.get(nodeRef);
}

// The stored record for an id, or undefined.
function networkOf(id) {
    return networks.get(id);
}

// The id that the next addNetwork call would assign.
function nextNetworkId() {
    return nextId;
}

// Empty every index and restart id allocation.
function clearNetworks() {
    resetState();
}

// --- Debug / diagnostic accessors -----------------------------------------

function networkCount() {
    return networks.size;
}

function nodeCount() {
    return nodeToNetwork.size;
}

// The set of active network ids.
function networkIds() {
    return new Set(networks.keys());
}

// A copy of the node set for a network, or undefined when the id is unknown.
function nodesIn(id) {
    const record = networks.get(id);
    return record ? new Set(record.nodes) : undefined;
}

// An immutable snapshot of every network for diagnostics.
function snapshot() {
    const out = [];
    for (const record of networks.values()) {
        out.push({
            id: record.id,
            powered: Boolean(record.powered),
            nodes: new Set(record.nodes),
            sources: new Set(record.sources),
            consumers: new Set(record.consumers),
            unresolvedBoundaries: new Set(record.unresolvedBoundaries)
        });
    }
    return out;
}

// The structural invariant holds when every (node, id) pair in nodeToNetwork has
// that node in the matching network's node set. Guaranteed by construction, but
// checked here so diagnostics can report it honestly.
function invariantHolds() {
    for (const [node, id] of nodeToNetwork) {
        const record = networks.get(id);
        if (!record || !record.nodes.has(node)) {
            return false;
        }
    }
    return true;
}

    return {
        addNetwork,
        registerNetwork,
        removeNetwork,
        networkIdOf,
        networkOf,
        nextNetworkId,
        clearNetworks,
        networkCount,
        nodeCount,
        networkIds,
        nodesIn,
        snapshot,
        invariantHolds
    };
}

const runtime = createRuntime();

// A live discovery that reached every node without crossing into an unloaded
// chunk is exact while all of those chunks stay loaded: its own sources decide
// its power. Saved chunk metadata is needed once any part is out of reach,
// including a chunk that unloaded after discovery and hides a source.
const chunkProbes = new WeakMap();
function probesOf(network) {
    let probes = chunkProbes.get(network);
    if (!probes) {
        const byChunk = new Map();
        for (const ref of network.nodes || []) {
            const parts = ref.slice(0, ref.indexOf("#")).split("|");
            const [x, y, z] = parts.slice(1, 4).map(Number);
            const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
            if (!byChunk.has(key)) byChunk.set(key, { x, y, z });
        }
        probes = [...byChunk.values()];
        chunkProbes.set(network, probes);
    }
    return probes;
}
export function isCompleteNetwork(network, dimension) {
    if (!network || network.unresolvedBoundaries?.size > 0) return false;
    if (!dimension) return true;
    for (const position of probesOf(network)) {
        try { if (!dimension.isChunkLoaded(position)) return false; }
        catch { return false; }
    }
    return true;
}

export { createRuntime, runtime };
export default runtime;
