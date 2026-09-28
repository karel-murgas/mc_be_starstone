// Logical networks over saved metadata only. Never receives a Dimension/Block.
import { parseSegmentNodeRef, reciprocalSegmentContact, validateChunkSegments } from "./chunkIndex.js";

const contactKey = (dimensionId, x, y, z, dir) => `${dimensionId}|${x}|${y}|${z}|${dir.join(",")}`;

export function buildSegmentGraph(chunks) {
    const segments = new Map(), contacts = new Map(), adjacency = new Map(), unresolved = new Map();
    const chunkKeys = new Set();
    for (const snapshot of chunks) {
        if (!validateChunkSegments(snapshot)) throw new Error("Invalid segment graph input");
        const chunkKey = `${snapshot.dimensionId}|${snapshot.cx}|${snapshot.cz}`;
        if (chunkKeys.has(chunkKey)) throw new Error("Duplicate segment chunk");
        chunkKeys.add(chunkKey);
        for (const segment of snapshot.segments) {
            // Stable keys include dimension and absolute position/lane, making
            // them unique across chunks without an additional generated ID.
            segments.set(segment.key, segment);
            adjacency.set(segment.key, new Set());
            unresolved.set(segment.key, new Set());
            for (const port of segment.boundaries) {
                const p = parseSegmentNodeRef(port.ref);
                const key = contactKey(p.dimensionId, p.x, p.y, p.z, port.direction);
                if (!contacts.has(key)) contacts.set(key, []);
                contacts.get(key).push({ segment: segment.key, port });
            }
        }
    }
    for (const [id, segment] of segments) {
        for (const port of segment.boundaries) {
            const p = parseSegmentNodeRef(port.ref), [dx, dy, dz] = port.direction;
            const reciprocal = contactKey(p.dimensionId, p.x + dx, p.y + dy, p.z + dz, [-dx, -dy, -dz]);
            let connected = false;
            for (const candidate of contacts.get(reciprocal) || []) {
                if (!reciprocalSegmentContact(port, candidate.port, port.direction)) continue;
                adjacency.get(id).add(candidate.segment);
                adjacency.get(candidate.segment).add(id);
                connected = true;
            }
            if (!connected) unresolved.get(id).add(`${port.ref}|${port.direction.join(",")}`);
        }
    }
    const visited = new Set(), networks = [], nodeToNetwork = new Map(), segmentToNetwork = new Map();
    for (const seed of [...segments.keys()].sort()) {
        if (visited.has(seed)) continue;
        const network = { id: seed, segments: new Set(), nodes: new Set(), sources: new Set(), activeSources: new Set(), consumers: new Set(), unresolvedBoundaries: new Set(), powered: false };
        const queue = [seed]; visited.add(seed);
        for (let head = 0; head < queue.length; head++) {
            const id = queue[head], segment = segments.get(id);
            network.segments.add(id); segmentToNetwork.set(id, network);
            for (const ref of segment.members) { network.nodes.add(ref); nodeToNetwork.set(ref, network); }
            for (const field of ["sources", "activeSources", "consumers"]) for (const ref of segment[field]) network[field].add(ref);
            for (const ref of unresolved.get(id)) network.unresolvedBoundaries.add(ref);
            for (const neighbor of adjacency.get(id)) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
        }
        network.powered = network.activeSources.size > 0;
        networks.push(network);
    }
    return { networks, nodeToNetwork, segmentToNetwork };
}
