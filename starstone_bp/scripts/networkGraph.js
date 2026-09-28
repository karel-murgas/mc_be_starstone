// networkGraph.js
//
// Bounded connected-component discovery for the Starstone electrical graph
// (Task 3.5). Starting from one seed block, walk only loaded locations over
// reciprocal electrical edges, yielding through system.runJob() so a very large
// network never overflows the watchdog. Yields { nodes, sources, consumers,
// unresolvedBoundaries }. "back" contacts resolve to supportOffset(mountFace),
// not worldOffset (Task 3.5A).
//
// The graph is read from the world, never written here. A node is a single
// electrical lane of a block: <dimension>|<x>|<y>|<z>#<lane>. Only blocks with a
// descriptor are electrical; every other block is skipped and never added.

import { system } from "@minecraft/server";
import runtime from "./networkRuntime.js";
import { descriptorForBlock } from "./electricalBlocks.js";
import { worldDirOfPort, WORLD_PORTS } from "./portDirections.js";
import { faceNormal } from "./surfaceFrame.js";
import { outerOffsets, outerWrap } from "./cornerTopology.js";
import { innerNeighborAllowed } from "./innerCorner.js";
import {
    KIND_SOURCE,
    KIND_CONSUMER,
    KIND_ADAPTER_IN,
    KIND_ADAPTER_OUT
} from "./constants.js";

const TAG = "[Starstone]";

// A single discovered component. Shape matches plan section 5.5 (without id and
// powered, which the runtime tasks fill in).
function emptyNetwork() {
    return {
        nodes: new Set(),
        sources: new Set(),
        consumers: new Set(),
        unresolvedBoundaries: new Set()
    };
}

// --- Port world directions -------------------------------------------------
//
// A descriptor port is either an absolute world_* direction (conduits and the
// mount-face-less generator), the "back" contact of a surface element, or a
// local tangent arm of the element's mount face. The "back" contact resolves to
// supportOffset(mountFace) toward the supporting block, never to worldOffset
// (which only knows the four local arms); see portDirections.js. Absolute
// world_* ports resolve the same whether or not a descriptor has a mount face,
// so the generator's six absolute contacts keep working.

function vecEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function negate(v) {
    return [-v[0], -v[1], -v[2]];
}

// The lane of a neighbour that exposes a port pointing back along -targetDir.
// Undefined when the neighbour has no reciprocal port, so the two nodes are not
// electrically joined and no edge is formed.
function findReciprocalLane(descriptor, targetDir) {
    for (const lane of descriptor.lanes) {
        for (const port of lane.ports) {
            const dir = worldDirOfPort(descriptor.mountFace, port);
            if (dir && vecEquals(dir, targetDir)) {
                return lane.id;
            }
        }
    }
    return undefined;
}

// --- Keys ------------------------------------------------------------------

function locKey(dim, x, y, z) {
    return `${dim.id}|${x}|${y}|${z}`;
}

function chunkOf(value) {
    return Math.floor(value / 16);
}

// A boundary port that points into an unloaded chunk. Records the source node
// position, the world direction into the void, and the destination chunk so a
// later task can reconnect it once that chunk loads (plan section 7.1).
function boundaryKey(dim, x, y, z, dir, cx, cz) {
    return `${dim.id}|${x},${y},${z}|${dir[0]},${dir[1]},${dir[2]}|${cx},${cz}`;
}

// --- Classification --------------------------------------------------------

function classifyNode(descriptor) {
    if (!descriptor) {
        return "none";
    }
    if (descriptor.kind === KIND_SOURCE || descriptor.kind === KIND_ADAPTER_IN) {
        return "source";
    }
    for (const lane of descriptor.lanes) {
        if (lane && lane.sourceOn) {
            return "source";
        }
    }
    if (
        descriptor.kind === KIND_CONSUMER ||
        descriptor.kind === KIND_ADAPTER_IN ||
        descriptor.kind === KIND_ADAPTER_OUT
    ) {
        return "consumer";
    }
    return "none";
}

// The neighbour lookups a node implies: one per exposed port, each carrying the
// world direction to reach that neighbour.
function outgoingPorts(descriptor, blockKey, laneId) {
    const out = [];
    for (const lane of descriptor.lanes) {
        if (!lane || !lane.ports) {
            continue;
        }
        if (laneId !== undefined && lane.id !== laneId) {
            continue;
        }
        for (const port of lane.ports) {
            const dir = worldDirOfPort(descriptor.mountFace, port);
            if (!dir) {
                continue;
            }
            out.push({ dir, laneId: lane.id, nodeRef: blockKey + "#" + lane.id });
            if (port !== "back") for (const corner of outerOffsets(descriptor, dir)) {
                out.push({ dir: corner, armDir: dir, corner: true,
                    laneId: lane.id, nodeRef: blockKey + "#" + lane.id });
            }
        }
    }
    return out;
}

// Add a freshly visited node to the component, bucketing sources and consumers.
function addNode(net, kind, ref) {
    net.nodes.add(ref);
    if (kind === "source") {
        net.sources.add(ref);
    } else if (kind === "consumer") {
        net.consumers.add(ref);
    }
}

// --- Discovery -------------------------------------------------------------

// The batch drained per runJob tick. Small enough to stay well inside the
// watchdog budget regardless of network size; the job count scales with
// nodes / BATCH_SIZE, never the size of any single synchronous call.
const BATCH_SIZE = 24;

// Walk a connected electrical component from one seed block. Returns a promise
// that resolves with the component once the queue drains.
//
// When `restrictTo` is a Set of NodeRefs, a candidate neighbor node is added
// while it belongs to that set, while a node owned by an unrelated cached
// network is still rejected. This lets a split task re-fragment an old network
// without wandering into nodes that were never part of it, and the freed old
// nodes (now unowned) are admitted along with any other unowned loaded node.
// Discovery still stops at invalid or unloaded neighbors and still records
// unresolved chunk boundaries.
//
// `seedLaneOverride` selects the seed's starting lane instead of the default
// (main, else the first lane). A bridge exposes two isolated lanes (#ns, #ew);
// rediscovery must start a surviving bridge lane on its own lane, never on the
// first lane, so the correct lane is followed rather than an empty one.
export function discoverNetwork(seed, restrictTo, seedLaneOverride, excluded = new Set()) {
    return new Promise((resolve, reject) => {
        if (!seed || !seed.isValid || !seed.dimension) {
            resolve(emptyNetwork());
            return;
        }

        const dimension = seed.dimension;
        const net = emptyNetwork();
        const visited = new Set();
        const queue = [];
        let head = 0;

        const sx = Math.floor(seed.location.x);
        const sy = Math.floor(seed.location.y);
        const sz = Math.floor(seed.location.z);
        const seedKey = locKey(dimension, sx, sy, sz);

        let seedDesc;
        try {
            seedDesc = descriptorForBlock(seed);
        } catch (err) {
            console.warn(`${TAG} Could not read seed: ${err.message}`);
            seedDesc = undefined;
        }
        if (!seedDesc || !seedDesc.lanes || seedDesc.lanes.length === 0) {
            resolve(emptyNetwork());
            return;
        }

        const seedLane = seedLaneOverride || seedDesc.lanes.find((lane) => lane && lane.id === "main") || seedDesc.lanes[0];
        const seedNode = seedKey + "#" + seedLane.id;
        if (excluded.has(seedNode)) { resolve(net); return; }
        visited.add(seedNode);
        addNode(net, classifyNode(seedDesc), seedNode);
        queue.push({ ref: seedNode, laneId: seedLane.id, x: sx, y: sy, z: sz });

        function* drain() {
            try {
                while (head < queue.length) {
                    let drained = 0;
                    while (head < queue.length && drained < BATCH_SIZE) {
                        const item = queue[head++];
                        drained++;

                        let block;
                        try { block = dimension.getBlock({ x: item.x, y: item.y, z: item.z }); }
                        catch { continue; }
                        if (!block || !block.isValid) {
                            continue;
                        }
                        const descriptor = descriptorForBlock(block);
                        if (!descriptor) {
                            continue;
                        }

                        const neighbors = outgoingPorts(descriptor, item.ref, item.laneId);
                        for (const neighbor of neighbors) {
                            const nx = item.x + neighbor.dir[0];
                            const ny = item.y + neighbor.dir[1];
                            const nz = item.z + neighbor.dir[2];

                            let loaded = false;
                            try { loaded = dimension.isChunkLoaded({ x: nx, y: ny, z: nz }); }
                            catch { /* Outside the dimension or no longer loaded. */ }
                            if (!loaded) {
                                net.unresolvedBoundaries.add(
                                    boundaryKey(
                                        dimension,
                                        item.x,
                                        item.y,
                                        item.z,
                                        neighbor.dir,
                                        chunkOf(nx),
                                        chunkOf(nz)
                                    )
                                );
                                continue;
                            }

                            let nb;
                            try { nb = dimension.getBlock({ x: nx, y: ny, z: nz }); }
                            catch { continue; }
                            if (!nb || !nb.isValid) {
                                continue;
                            }
                            const nDesc = descriptorForBlock(nb);
                            if (!nDesc || !nDesc.lanes) {
                                continue;
                            }
                            if (!neighbor.corner && descriptor.kind === "inner-corner" &&
                                !innerNeighborAllowed(descriptor,nDesc,neighbor.dir)) continue;
                            if (!neighbor.corner && nDesc.kind === "inner-corner" &&
                                !innerNeighborAllowed(nDesc,descriptor,negate(neighbor.dir))) continue;
                            // Reciprocal directions alone do not imply coplanarity.
                            if (!neighbor.corner && descriptor.mountFace && nDesc.mountFace &&
                                descriptor.mountFace !== nDesc.mountFace) continue;
                            // A conduit meets a surface only through its back contact.
                            const surface = descriptor.mountFace ? descriptor : nDesc;
                            const full = descriptor.mountFace ? nDesc : descriptor;
                            if (!neighbor.corner && surface.mountFace && full.kind === "conduit") {
                                const towardFull = descriptor.mountFace ? neighbor.dir : negate(neighbor.dir);
                                if (!vecEquals(worldDirOfPort(surface.mountFace, "back"), towardFull)) continue;
                            }
                            const wrap = neighbor.corner && outerWrap(descriptor,nDesc,neighbor.dir);
                            if (neighbor.corner && (!wrap || !vecEquals(faceNormal(wrap.toFace),neighbor.armDir))) continue;
                            const recipLane = findReciprocalLane(nDesc, neighbor.corner
                                ? faceNormal(wrap.fromFace) : negate(neighbor.dir));
                            if (!recipLane) {
                                continue;
                            }
                            const nKey = locKey(dimension, nx, ny, nz);
                            const nRef = nKey + "#" + recipLane;
                            if (excluded.has(nRef)) continue;
                            if (!visited.has(nRef)) {
                                if (restrictTo && !restrictTo.has(nRef)) {
                                    // Admit newly encountered unowned loaded nodes, but
                                    // reject a node owned by an unrelated cached
                                    // network so discovery never joins it.
                                    if (runtime.networkIdOf(nRef) !== undefined) {
                                        continue;
                                    }
                                }
                                visited.add(nRef);
                                addNode(net, classifyNode(nDesc), nRef);
                                queue.push({ ref: nRef, laneId: recipLane, x: nx, y: ny, z: nz });
                            }
                        }
                    }

                    if (head < queue.length) {
                        yield;
                    }
                }
            } catch (err) {
                // Do not publish a partial component as a successful rebuild.
                // Unavailable locations are handled individually above.
                reject(err);
                return;
            }
            resolve(net);
        }

        system.runJob(drain());
    });
}

export {
    classifyNode,
    findReciprocalLane,
    outgoingPorts,
    worldDirOfPort,
    boundaryKey,
    WORLD_PORTS
};
