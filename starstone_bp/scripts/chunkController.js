// Persisted segment metadata carries power through unloaded chunks. All block
// reads below check chunk availability; imports only install plain state.
import { system, world } from "@minecraft/server";
import { placementIndex } from "./persistence.js";
import { chunkIndex, buildIndexedChunkSegments } from "./chunkIndex.js";
import { buildSegmentGraph } from "./segmentGraph.js";
import { applyPower } from "./powerPropagation.js";
import runtime, { isCompleteNetwork } from "./networkRuntime.js";
import { parseNodeRef, nodeRef } from "./blockKeys.js";
import { configureNetworkPersistence, subscribeNetworkDiscovery, notifyNetworkDiscovered } from "./networkEvents.js";
import { KIND_BY_ID } from "./constants.js";

export const CHUNK_OBSERVER_INTERVAL_TICKS = 100;
export const CHUNK_OBSERVER_BUDGET = 32;
// Durable source-change hints/receipts, not authoritative topology or power.
// This controller never reads these hints to override segment snapshots or
// current loaded block state; stale hints after failed cleanup cannot conduct.
export const SOURCE_PROPERTY_PREFIX = "starstone:source_state:";
export const LOGICAL_POWER_PREFIX = "starstone:logical_power:";
const pending = new Map(), retry = new Map(), revisions = new Map(), observed = new Set();
const knownDimensions = new Map();
const discoveryRetries = new Map();
let observerCandidates = new Map(), candidateList;
let graph, registered = false, running = false, scheduled = false;
let builds = 0, commits = 0, staleBuilds = 0, pollOffset = 0;
const keyOf = (id, cx, cz) => `${id}|${cx}|${cz}`;
const chunkOf = value => Math.floor(value / 16);
const dimensionFor = id => { try { return world.getDimension(id); } catch { return knownDimensions.get(id); } };
function loaded(dimension, position) {
    try { return Boolean(dimension?.isChunkLoaded(position)); } catch { return false; }
}
function setDurable(key, value) {
    if (world.getDynamicProperty(key) !== value) world.setDynamicProperty(key, value);
}
function ensureGraph() {
    if (!graph) {
        const snapshots = [...chunkIndex.chunks()];
        const next = buildSegmentGraph(snapshots);
        for (const network of next.networks) persistPower(network);
        graph = next;
        cacheCandidates(snapshots);
    }
    return graph;
}
function persistPower(network, powered = network.powered) {
    setDurable(`${LOGICAL_POWER_PREFIX}${encodeURIComponent(network.id)}`, Boolean(powered));
}
// Saved snapshots are rebuilt a chunk at a time after every edit, so a logical
// network can briefly describe an older topology. Nodes owned by a completely
// discovered live network keep the live result; logical power only fills in
// nodes whose live network reaches unloaded chunks or that no walk has seen.
function applyLogical(network, dimension) {
    const nodes = new Set();
    const owners = new Set();
    for (const ref of network.nodes) {
        const owner = runtime.networkIdOf(ref);
        if (owner !== undefined && isCompleteNetwork(runtime.networkOf(owner), dimension)) continue;
        if (owner !== undefined) owners.add(owner);
        nodes.add(ref);
    }
    for (const id of owners) {
        const cached = runtime.networkOf(id);
        if (cached) cached.powered = network.powered;
    }
    if (nodes.size) applyPower({ ...network, nodes }, dimension);
}
function refreshLogicalGraph() {
    const snapshots = [...chunkIndex.chunks()];
    const next = buildSegmentGraph(snapshots);
    // Commit every logical result before allowing any loaded visual writes.
    for (const network of next.networks) persistPower(network);
    graph = next;
    cacheCandidates(snapshots);
    for (const network of graph.networks) {
        const first = parseNodeRef(network.nodes.values().next().value);
        const dimension = first && dimensionFor(first.dimensionId);
        if (!dimension) continue;
        applyLogical(network, dimension);
        notifyNetworkDiscovered(network, dimension);
    }
}
export function chunkStats() {
    return { running, queued: pending.size, retry: retry.size, observed: observed.size,
        discoveryRetry: discoveryRetries.size,
        builds, commits, staleBuilds, logicalNetworks: graph?.networks.length || 0,
        pollBudget: CHUNK_OBSERVER_BUDGET, pollInterval: CHUNK_OBSERVER_INTERVAL_TICKS };
}

export function queueChunkRebuild(dimension, cx, cz, y = 0) {
    knownDimensions.set(dimension.id, dimension);
    const key = keyOf(dimension.id, cx, cz);
    revisions.set(key, (revisions.get(key) || 0) + 1);
    pending.set(key, { dimension, cx, cz, y, key });
    rememberCandidate({ dimension, cx, cz, y, key });
    retry.delete(key);
    schedule();
}
function schedule() {
    if (running || scheduled || !pending.size) return;
    scheduled = true;
    try {
        system.run(() => {
            scheduled = false;
            if (running || !pending.size) return;
            running = true;
            try { system.runJob(rebuildPending()); }
            catch (error) { running = false; console.warn(`[Starstone] Chunk scheduling failed: ${error.message}`); }
        });
    } catch (error) { scheduled = false; throw error; }
}
function* rebuildPending() {
    try {
        while (pending.size) {
            const [key, request] = pending.entries().next().value;
            pending.delete(key);
            const { dimension, cx, cz, y } = request;
            if (!loaded(dimension, { x:cx*16+8, y, z:cz*16+8 })) { retry.set(key, request); continue; }
            if ([...discoveryRetries.values()].some(entry => entry.key === key)) { retry.set(key, request); continue; }
            const revision = revisions.get(key);
            builds++;
            try {
                const guarded = {
                    id: dimension.id,
                    getBlock(position) { return loaded(dimension, position) ? dimension.getBlock(position) : undefined; }
                };
                yield* placementIndex.validateChunk(guarded, cx, cz);
                const snapshot = yield* buildIndexedChunkSegments(dimension, cx, cz, placementIndex);
                if (revision !== revisions.get(key)) {
                    staleBuilds++;
                    if (!pending.has(key)) pending.set(key, request);
                    continue;
                }
                if (!snapshot) { retry.set(key, request); continue; }
                chunkIndex.writeChunk(snapshot);
                commits++;
                retry.delete(key);
                refreshLogicalGraph();
            } catch (error) {
                retry.set(key, request);
                console.warn(`[Starstone] Chunk reconciliation failed: ${error.message}`);
            }
            yield;
        }
    } finally { running = false; schedule(); }
}

// Synchronous source commit; no topology discovery or segment rebuilding here.
// The small per-source property covers a source whose first segment build has
// not finished. A false result allows the caller's ordinary loaded-cache pass
// only after this durable write has succeeded.
export function commitSourceState(dimension, location, on) {
    knownDimensions.set(dimension.id,dimension);
    const ref = nodeRef(dimension.id, location, "main");
    setDurable(`${SOURCE_PROPERTY_PREFIX}${encodeURIComponent(ref)}`, Boolean(on));
    const key = keyOf(dimension.id, chunkOf(location.x), chunkOf(location.z));
    revisions.set(key, (revisions.get(key) || 0) + 1);
    const current = ensureGraph();
    if (!chunkIndex.updateSource(ref, Boolean(on))) {
        queueChunkRebuild(dimension, chunkOf(location.x), chunkOf(location.z), location.y);
        return false;
    }
    const network = current.nodeToNetwork.get(ref);
    if (!network) { refreshLogicalGraph(); return true; }
    const active = new Set(network.activeSources);
    if (on) active.add(ref); else active.delete(ref);
    const powered = active.size > 0;
    persistPower(network, powered);
    network.activeSources = active;
    network.powered = powered;
    applyLogical(network, dimension);
    return true;
}

function discovered(network, dimension) {
    // Logical notifications register loaded adapter sources, but must not feed
    // back into another segment build.
    if (network.segments) return;
    knownDimensions.set(dimension.id, dimension);
    const job = function* () {
        const chunks = new Map();
        try {
            for (const ref of network.nodes) {
                const position = parseNodeRef(ref);
                if (!position || position.dimensionId !== dimension.id) continue;
                const cx = chunkOf(position.x), cz = chunkOf(position.z);
                const key = keyOf(dimension.id,cx,cz);
                chunks.set(key, { cx, cz, y:position.y });
                try {
                    if (!loaded(dimension, position)) throw new Error("Discovered position unloaded");
                    const block = dimension.getBlock(position);
                    if (!block?.isValid) throw new Error("Discovered position unavailable");
                    // Gone/replaced blocks are settled by the indexed builder.
                    if (placementIndex.record(block) === false && KIND_BY_ID[block.type.id]) {
                        throw new Error("Discovered position could not be indexed");
                    }
                    discoveryRetries.delete(ref);
                } catch (error) {
                    discoveryRetries.set(ref, { dimension, position, key });
                    console.warn(`[Starstone] Discovery indexing deferred: ${error.message}`);
                }
                yield;
            }
        } finally {
            for (const {cx,cz,y} of chunks.values()) {
                try { queueChunkRebuild(dimension,cx,cz,y); }
                catch (error) { console.warn(`[Starstone] Discovery rebuild deferred: ${error.message}`); }
            }
        }
    }();
    try { system.runJob(job); }
    catch (error) {
        for (const ref of network.nodes) {
            const position = parseNodeRef(ref);
            if (position && position.dimensionId === dimension.id) discoveryRetries.set(ref, {
                dimension, position, key:keyOf(dimension.id,chunkOf(position.x),chunkOf(position.z))
            });
        }
        console.warn(`[Starstone] Discovery indexing could not schedule: ${error.message}`);
    }
}

function rememberCandidate(request) {
    const key = request.key || keyOf(request.dimension.id,request.cx,request.cz);
    const previous = observerCandidates.get(key);
    if (!previous || previous.dimension !== request.dimension || previous.y !== request.y) {
        observerCandidates.set(key,request);
        candidateList = undefined;
    }
}
function cacheCandidates(snapshots) {
    // Replaced only when persisted topology changes, never on a standing poll.
    observerCandidates = new Map();
    candidateList = undefined;
    for (const snapshot of snapshots) {
        const dimension = dimensionFor(snapshot.dimensionId);
        if (!dimension) continue;
        const first = parseNodeRef(snapshot.segments[0]?.members[0]);
        const y = first?.y || 0;
        rememberCandidate({dimension,cx:snapshot.cx,cz:snapshot.cz,y});
        for (const segment of snapshot.segments) for (const boundary of segment.boundaries) {
            const [cx,cz] = boundary.destination;
            rememberCandidate({dimension,cx,cz,y:parseNodeRef(boundary.ref)?.y || y});
        }
    }
    for (const request of pending.values()) rememberCandidate(request);
    for (const request of retry.values()) rememberCandidate(request);
}

function retryDiscoveries() {
    let checked = 0;
    const limit = Math.min(CHUNK_OBSERVER_BUDGET,discoveryRetries.size);
    for (const [ref, entry] of discoveryRetries) {
        if (checked++ >= limit) break;
        const {dimension,position} = entry;
        // Rotate unavailable entries so later retries cannot starve.
        discoveryRetries.delete(ref);
        try {
            if (!loaded(dimension,position)) throw new Error("unloaded");
            const block = dimension.getBlock(position);
            if (!block?.isValid) throw new Error("unavailable");
            if (placementIndex.record(block) === false && KIND_BY_ID[block.type.id]) throw new Error("index unavailable");
            queueChunkRebuild(dimension,chunkOf(position.x),chunkOf(position.z),position.y);
        } catch { discoveryRetries.set(ref,entry); }
    }
}

// Player origins plus known destinations provide a bounded round-robin probe.
// Availability probes do not access Block objects. Standing in a loaded chunk
// does not reschedule it; unload/reload and explicit mutations do.
export function pollLoadedChunks() {
    ensureGraph();
    retryDiscoveries();
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;
        try {
            const { dimension, location } = player;
            const cx = chunkOf(location.x), cz = chunkOf(location.z);
            rememberCandidate({dimension,cx,cz,y:Math.floor(location.y)});
        } catch { /* Player disconnected during capture. */ }
    }
    const entries = candidateList ||= [...observerCandidates];
    if (!entries.length) return;
    for (let step = 0; step < Math.min(CHUNK_OBSERVER_BUDGET, entries.length); step++) {
        const [key, request] = entries[(pollOffset + step) % entries.length];
        const {dimension,cx,cz,y} = request;
        if (!loaded(dimension, {x:cx*16+8,y,z:cz*16+8})) { observed.delete(key); continue; }
        if (!observed.has(key) || retry.has(key)) {
            observed.add(key);
            queueChunkRebuild(dimension,cx,cz,y);
        }
    }
    pollOffset = (pollOffset + CHUNK_OBSERVER_BUDGET) % entries.length;
    schedule();
}

export function registerChunkController() {
    if (registered) return;
    placementIndex.subscribeChanges(({type,dimensionId,location}) => {
        const dimension = dimensionFor(dimensionId);
        if (dimension) queueChunkRebuild(dimension,chunkOf(location.x),chunkOf(location.z),location.y);
        // The placement mutation is already committed. Queue reconciliation
        // before optional hint cleanup, whose storage failure must not leave
        // an entirely removed component conducting through stale metadata.
        if (type === "remove") setDurable(`${SOURCE_PROPERTY_PREFIX}${encodeURIComponent(nodeRef(dimensionId,location,"main"))}`, undefined);
    });
    subscribeNetworkDiscovery(discovered);
    configureNetworkPersistence({
        sourceChanged: commitSourceState,
        resolvePower(network) {
            const known = ensureGraph();
            let found = false, powered = false;
            for (const ref of network.nodes) {
                const logical = known.nodeToNetwork.get(ref);
                if (logical) { found = true; powered ||= logical.powered; }
            }
            return found ? powered : undefined;
        }
    });
    system.runInterval(pollLoadedChunks, CHUNK_OBSERVER_INTERVAL_TICKS);
    registered = true;
}
