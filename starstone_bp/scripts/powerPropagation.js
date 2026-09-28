// powerPropagation.js
//
// Task 4.3 â€” apply binary power to electrical blocks. Given a registered
// runtime network, write the network's `powered` result into every node's
// applicable block state:
//
//   * ordinary cable, conduit, lamp and output adapter use `starstone:powered`
//   * input adapter uses `starstone:star_powered` for its blue conductor; its
//     `starstone:powered` state remains the independent redstone source value
//   * a bridge lane uses `starstone:powered_ns` for #ns and `starstone:powered_ew`
//     for #ew, so the two lanes update independently
//
// Only blocks whose applicable powered state actually changes are written, and
// each such write changes just that one state through `block.permutation` so
// every unrelated state (mounting face, connections, axis, enabled, light) is
// preserved. Writes are deferred with `system.run(...)` because the triggering
// callback may be in restricted execution, and they are spread over several
// callbacks with bounded read/write budgets. Actual watchdog safety still needs
// an in-game measurement. Locations whose chunk is unloaded are skipped and left in
// pendingReconciliation for a later reconcile pass (see Task 7.5); the block
// is never touched while it cannot be reached.
//
// The generator is the source, not a consumer: its `enabled` state is managed
// separately, so a source block is never given a `powered` state here.

import { system } from "@minecraft/server";
import {
    CABLE_ID,
    INNER_CORNER_ID,
    BRIDGE_ID,
    CONDUIT_ID,
    LAMP_ID,
    REDSTONE_INPUT_ID,
    REDSTONE_OUTPUT_ID,
    LANE_NS,
    LANE_EW,
    STATE_POWERED,
    STATE_STAR_POWERED,
    STATE_POWERED_NS,
    STATE_POWERED_EW,
} from "./constants.js";

const TAG = "[Starstone]";

// Blocks that actually own a Starstone visual power state and may be written here. The
// generator (a source) owns `enabled`, not `powered`, so it is intentionally
// absent and never rewritten by this module.
const POWERED_CAPABLE = new Set([CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, CONDUIT_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID]);

// How many permutation writes one job tick may apply. Small and fixed so the
// per-tick budget is predictable regardless of network size.
const WRITE_BATCH = 16;
// Large networks defer world reads as well as writes. The synchronous fast path
// and each planning callback inspect at most this many nodes.
export const PLAN_BATCH = 32;
const MAX_QUEUED_WRITES = WRITE_BATCH * 2;

// Deferred writes still to apply, each a plain record (no Block):
//   { dimension, x, y, z, state, value }
const queue = new Map();
function writeKey(dimension, x, y, z, state) {
    return `${dimension.id}|${x}|${y}|${z}|${state}`;
}
let busy = false;
let peakQueued = 0;
let appliedWrites = 0;
const planning = new Map();
let planningBusy = false;
let peakPlanning = 0;
export function powerStats() {
    return { queued: queue.size, peakQueued, appliedWrites, writeBudget: WRITE_BATCH,
        planning: planning.size, peakPlanning, planningBudget: PLAN_BATCH };
}
function planKey(dimension, x, y, z, lane) {
    return writeKey(dimension, x, y, z, `plan:${lane}`);
}
function clearQueuedLane(dimension, x, y, z, lane) {
    const states = lane === LANE_NS || lane === LANE_EW
        ? [poweredStateForLane(lane)] : [STATE_POWERED, STATE_STAR_POWERED];
    for (const state of states) queue.delete(writeKey(dimension, x, y, z, state));
}

// NodeRefs whose chunk was unloaded when power was computed. Left here so a
// later reconcile pass can recompute and apply power once the chunk loads.
const pendingReconciliation = new Set();

// The block-state a lane writes, per plan section 5.2/5.3.
export function poweredStateForLane(lane) {
    if (lane === LANE_NS) {
        return STATE_POWERED_NS;
    }
    if (lane === LANE_EW) {
        return STATE_POWERED_EW;
    }
    return STATE_POWERED;
}

// Parse a NodeRef "<dim>|<x>|<y>|<z>#<lane>". Returns a plain object or
// undefined when the reference is malformed.
function parseNodeRef(nodeRef) {
    if (typeof nodeRef !== "string") {
        return undefined;
    }
    const hash = nodeRef.indexOf("#");
    if (hash === -1) {
        return undefined;
    }
    const key = nodeRef.slice(0, hash);
    const lane = nodeRef.slice(hash + 1);
    const pipe = key.indexOf("|");
    if (pipe === -1) {
        return undefined;
    }
    const dim = key.slice(0, pipe);
    const rest = key.slice(pipe + 1);
    const parts = rest.split("|");
    if (parts.length < 3) {
        return undefined;
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return undefined;
    }
    return { dim, x, y, z, lane };
}

// Read a node's current applicable powered value as the planner understands it:
//
//   { state, value }  the block is powered-capable and loaded; value is the
//                      current boolean of that one block state
//   "unloaded"        the chunk holding the block is not yet loaded
//   "none"            the block is gone, invalid, malformed, or not a block
//                      that owns a powered state (e.g. a generator)
//
// A failed read is treated as "none" rather than thrown, so one bad block can
// never abort a whole network's power pass.
export function makeCurrentPowered(dimension) {
    return function currentPowered(nodeRef) {
        const parsed = parseNodeRef(nodeRef);
        if (!parsed) {
            return "none";
        }
        try {
            if (!dimension.isChunkLoaded({ x: parsed.x, y: parsed.y, z: parsed.z })) {
                return "unloaded";
            }
            const block = dimension.getBlock({ x: parsed.x, y: parsed.y, z: parsed.z });
            if (!block || !block.isValid) {
                return "none";
            }
            if (!POWERED_CAPABLE.has(block.type.id)) {
                return "none";
            }
            const state = block.type.id === REDSTONE_INPUT_ID ? STATE_STAR_POWERED : poweredStateForLane(parsed.lane);
            if (block.permutation.getState(state) === undefined) return "none";
            const pending = queue.get(writeKey(dimension, parsed.x, parsed.y, parsed.z, state));
            return { state, value: pending ? pending.value : Boolean(block.permutation.getState(state)) };
        } catch {
            return "none";
        }
    };
}

// Decide which nodes change and which are still pending, without touching the
// world. `currentPowered(nodeRef)` returns the shape documented above. Returns
// { writes, unresolved } where each write is
//   { ref, x, y, z, state, value }
// This is the pure core shared by the runtime pass and the unit test.
export function planPowerWrites(network, currentPowered) {
    const writes = [];
    const unresolved = [];
    if (!network || !(network.nodes instanceof Set)) {
        return { writes, unresolved };
    }
    const powered = Boolean(network.powered);
    for (const ref of network.nodes) {
        let current;
        try {
            current = currentPowered(ref);
        } catch {
            continue;
        }
        if (current === "unloaded") {
            unresolved.push(ref);
            continue;
        }
        if (current === "none") {
            continue;
        }
        if (current.value === powered) {
            continue;
        }
        const parsed = parseNodeRef(ref);
        writes.push({
            ref,
            x: parsed.x,
            y: parsed.y,
            z: parsed.z,
            state: current.state,
            value: powered
        });
    }
    return { writes, unresolved };
}

// Enqueue deferred writes and start draining them one batch per tick.
function enqueueWrites(dimension, writes) {
    for (const w of writes) {
        queue.set(writeKey(dimension, w.x, w.y, w.z, w.state), {
            ref: w.ref,
            dimension,
            x: w.x,
            y: w.y,
            z: w.z,
            state: w.state,
            value: w.value
        });
    }
    peakQueued = Math.max(peakQueued, queue.size);
    if (busy || queue.size === 0) {
        return;
    }
    busy = true;
    try { system.run(processNextBatch); }
    catch (error) { busy = false; throw error; }
}

// Apply one batch of writes, then schedule the next batch. Each write re-reads
// the block so a concurrent change is not clobbered, and skips when the state
// already matches or the block is gone.
function processNextBatch() {
    const batch = [];
    for (const entry of queue) {
        batch.push(entry);
        if (batch.length === WRITE_BATCH) break;
    }
    for (const [key, w] of batch) {
        queue.delete(key);
        try {
            if (!w.dimension.isChunkLoaded(w)) {
                pendingReconciliation.add(w.ref);
                continue;
            }
            const block = w.dimension.getBlock({ x: w.x, y: w.y, z: w.z });
            if (!block || !block.isValid) {
                continue;
            }
            const current = block.permutation.getState(w.state);
            if (!POWERED_CAPABLE.has(block.type.id) || current === undefined) continue;
            pendingReconciliation.delete(w.ref);
            if (Boolean(current) === w.value) {
                continue;
            }
            block.setPermutation(block.permutation.withState(w.state, w.value));
            appliedWrites++;
        } catch (err) {
            pendingReconciliation.add(w.ref);
            console.warn(`${TAG} Could not set ${w.state}=${w.value}: ${err.message}`);
        }
    }
    if (queue.size > 0) {
        try { system.run(processNextBatch); }
        catch (error) { busy = false; throw error; }
    } else {
        busy = false;
    }
}

function cancelPlan(key) {
    const old = planning.get(key);
    if (old) {
        old.progress.pending--;
        planning.delete(key);
    }
}

function schedulePlanning() {
    if (planningBusy || planning.size === 0) return;
    planningBusy = true;
    try { system.run(processPlanningBatch); }
    catch (error) { planningBusy = false; throw error; }
}

function processPlanningBatch() {
    // Backpressure prevents a faster planner from accumulating thousands of
    // concrete block writes while the write queue drains at 16 per callback.
    const budget = Math.min(PLAN_BATCH, Math.max(0, MAX_QUEUED_WRITES - queue.size));
    let inspected = 0;
    try {
        for (const [key, task] of planning) {
            if (inspected >= budget) break;
            inspected++;
            planning.delete(key);
            task.progress.pending--;
            const { writes, unresolved } = planPowerWrites(
                { nodes: new Set([task.ref]), powered: task.powered },
                makeCurrentPowered(task.dimension)
            );
            task.progress.written += writes.length;
            task.progress.unresolved += unresolved.length;
            for (const ref of unresolved) pendingReconciliation.add(ref);
            enqueueWrites(task.dimension, writes);
        }
    } finally {
        // A failed scheduler call must not permanently lock later retries.
        planningBusy = false;
    }
    schedulePlanning();
}

// Apply a network's power to every loaded cable, bridge lane, conduit and lamp.
// For <= PLAN_BATCH nodes, returns exact { written, unresolved } immediately.
// Larger calls return live { written, unresolved, pending } progress: counts
// advance as bounded planning callbacks run. pending includes only unread plans,
// and reaches zero when planned (or superseded), not when visuals finish writing.
export function applyPower(network, dimension) {
    if (!network || !(network.nodes instanceof Set) || !dimension) {
        return { written: 0, unresolved: 0 };
    }
    if (network.nodes.size > PLAN_BATCH) {
        const progress = { written: 0, unresolved: 0, pending: 0 };
        // Consumers are the visible result of a circuit. On a long run the
        // bounded planner would otherwise reach a distant lamp only after
        // reading and writing every cable before it (one batch per tick).
        // Plan consumers first while retaining the same per-tick budgets.
        const consumers = network.consumers instanceof Set ? network.consumers : new Set();
        for (const refs of [consumers, network.nodes]) for (const ref of refs) {
            if ((refs === consumers && !network.nodes.has(ref)) ||
                (refs === network.nodes && consumers.has(ref))) continue;
            const parsed = parseNodeRef(ref);
            if (!parsed) continue;
            const key = planKey(dimension, parsed.x, parsed.y, parsed.z, parsed.lane);
            cancelPlan(key);
            // A newer logical result supersedes both an older unread plan and
            // a queued visual write. Its eventual read sees actual block state.
            clearQueuedLane(dimension, parsed.x, parsed.y, parsed.z, parsed.lane);
            planning.set(key, { ref, dimension, powered: Boolean(network.powered), progress });
            progress.pending++;
        }
        peakPlanning = Math.max(peakPlanning, planning.size);
        schedulePlanning();
        return progress;
    }
    // A small split/toggle can supersede part of a large outstanding pass.
    for (const ref of network.nodes) {
        const parsed = parseNodeRef(ref);
        if (parsed) cancelPlan(planKey(dimension, parsed.x, parsed.y, parsed.z, parsed.lane));
    }
    const { writes, unresolved } = planPowerWrites(
        network,
        makeCurrentPowered(dimension)
    );
    enqueueWrites(dimension, writes);
    for (const ref of unresolved) {
        pendingReconciliation.add(ref);
    }
    return { written: writes.length, unresolved: unresolved.length };
}

// The nodeRefs still waiting on an unloaded chunk, for a later reconcile pass.
export function pendingUnresolved() {
    return pendingReconciliation;
}

export { WRITE_BATCH };
