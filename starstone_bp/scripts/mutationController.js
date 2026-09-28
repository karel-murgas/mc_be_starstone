// Explosions and command edits share one deduplicated, yielded repair batch.
// Maintenance probes saved positions only; it never scans a world volume.
import { system, world } from "@minecraft/server";
import runtime from "./networkRuntime.js";
import { placementIndex } from "./persistence.js";
import { descriptorForBlock } from "./electricalBlocks.js";
import { discoverAndRegisterNetwork } from "./networkController.js";
import { computeCableMask, refreshCable, computeInnerCornerState } from "./cableComponent.js";
import { isSupportValid, supportBlock } from "./support.js";
import { KIND_BY_ID, CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID } from "./constants.js";
import { innerSupports, pairFromPermutation, armsFromPermutation } from "./innerCorner.js";

export const VALIDATION_INTERVAL_TICKS = 100;
export const VALIDATION_POSITION_BUDGET = 16;
export const PISTON_POLICY = "immovable";
const SURFACES = new Set([CABLE_ID, INNER_CORNER_ID, BRIDGE_ID, LAMP_ID, REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID]);
function unsupported(block) {
    if (block.type.id === INNER_CORNER_ID) {
        const supports=innerSupports(block.location,pairFromPermutation(block.permutation));
        return Boolean(supports?.every(({position})=>block.dimension.isChunkLoaded(position))) && !isSupportValid(block);
    }
    const support=SURFACES.has(block.type.id) ? supportBlock(block) : undefined;
    return support?.isValid && !isSupportValid(block);
}
const LANES = ["main", "ns", "ew"];
const OFFSETS = [[0,0,0], [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
const pending = new Map();
const fingerprints = new Map();
let registered = false, scheduled = false, running = false;
let cursor, batches = 0, lastChecked = 0;

const keyOf = p => `${p.x}|${p.y}|${p.z}`;
const read = (dimension, position) => { try { return dimension.getBlock(position); } catch { return undefined; } };
const electrical = block => block?.isValid && KIND_BY_ID[block.type.id];
function fingerprint(block) {
    const state = block.permutation;
    return JSON.stringify([block.type.id, state.getState("minecraft:block_face"),
        state.getState("starstone:axis"), state.getState("starstone:face_mask_low"),
        state.getState("starstone:face_mask_high"), state.getState("starstone:enabled"),
        block.type.id === REDSTONE_INPUT_ID ? state.getState("starstone:powered") : undefined]);
}
export function mutationStats() {
    let queuedPositions = 0;
    for (const request of pending.values()) queuedPositions += request.positions.size;
    return { running, batches, queuedPositions, lastChecked,
        validationInterval: VALIDATION_INTERVAL_TICKS, validationBudget: VALIDATION_POSITION_BUDGET };
}

export function queueMutation(dimension, location) {
    let request = pending.get(dimension.id);
    if (!request) pending.set(dimension.id, request = { dimension, positions: new Map() });
    for (const [dx,dy,dz] of OFFSETS) {
        const position = { x: location.x + dx, y: location.y + dy, z: location.z + dz };
        request.positions.set(keyOf(position), position);
    }
    scheduleFlush();
}
function scheduleFlush() {
    if (scheduled || running || !pending.size) return;
    scheduled = true;
    try {
        system.run(() => {
            scheduled = false;
            if (running || !pending.size) return;
            running = true;
            const requests = [...pending.values()];
            pending.clear();
            try { system.runJob(reconcile(requests)); }
            catch (error) {
                running = false;
                for (const request of requests) {
                    const current = pending.get(request.dimension.id);
                    if (current) for (const [key, position] of request.positions) current.positions.set(key, position);
                    else pending.set(request.dimension.id, request);
                }
                console.warn(`[Starstone] Mutation scheduling failed: ${error.message}`);
            }
        });
    } catch (error) { scheduled = false; throw error; }
}

function* reconcile(requests) {
    try {
        batches++;
        for (const { dimension, positions } of requests) {
            const ids = new Set();
            for (const key of positions.keys()) {
                for (const lane of LANES) {
                    const owner = runtime.networkIdOf(`${dimension.id}|${key}#${lane}`);
                    if (owner !== undefined) ids.add(owner);
                }
                yield;
            }
            // Rebuild all old fragments, including survivors separated from the
            // explosion by multiple missing blocks. Each old network is freed once.
            for (const id of ids) {
                const network = runtime.networkOf(id);
                if (!network) continue;
                for (const node of network.nodes) {
                    const [dimensionId, x, y, z] = node.slice(0, node.lastIndexOf("#")).split("|");
                    if (dimensionId === dimension.id) {
                        const position = { x: Number(x), y: Number(y), z: Number(z) };
                        positions.set(keyOf(position), position);
                    }
                    yield;
                }
                runtime.removeNetwork(id);
            }
            for (const [key, position] of positions) {
                const block = read(dimension, position);
                if (block?.isValid) {
                    if (!electrical(block)) {
                        placementIndex.remove(dimension.id, position);
                        fingerprints.delete(`${dimension.id}|${key}`);
                    } else {
                        if (unsupported(block)) {
                            dimension.runCommand(`setblock ${position.x} ${position.y} ${position.z} air destroy`);
                            placementIndex.remove(dimension.id, position);
                            fingerprints.delete(`${dimension.id}|${key}`);
                        } else {
                            placementIndex.record(block);
                            fingerprints.set(`${dimension.id}|${key}`, fingerprint(block));
                        }
                    }
                }
                yield;
            }
            // Support removals may themselves change adjacent cable masks.
            // Complete those removals before the single mask-refresh pass.
            for (const position of positions.values()) {
                const block = read(dimension, position);
                if (electrical(block)) refreshCable(block);
                yield;
            }
            const seen = new Set();
            for (const [key, position] of positions) {
                const laneIds = (descriptorForBlock(read(dimension, position))?.lanes || []).map(lane => lane.id);
                for (const laneId of laneIds) {
                    const ref = `${dimension.id}|${key}#${laneId}`;
                    if (seen.has(ref)) continue;
                    const block = read(dimension, position);
                    const lane = descriptorForBlock(block)?.lanes.find(candidate => candidate.id === laneId);
                    if (!lane) continue;
                    let done = false, result, failure;
                    discoverAndRegisterNetwork(block, lane).then(
                        value => { result = value; done = true; },
                        error => { failure = error; done = true; }
                    );
                    while (!done) yield;
                    if (failure) throw failure;
                    seen.add(ref);
                    for (const node of result?.nodes || []) { seen.add(node); yield; }
                }
                yield;
            }
        }
    } catch (error) {
        console.warn(`[Starstone] Mutation repair failed: ${error.message}`);
    } finally {
        running = false;
        scheduleFlush();
    }
}

// A neighbor across a chunk border may load after the corner last refreshed.
function staleInnerCorner(block) {
    const next = computeInnerCornerState(block);
    return next !== null && (next === undefined || next.pair !== pairFromPermutation(block.permutation) ||
        next.arms !== armsFromPermutation(block.permutation));
}
export function validateKnownPositions() {
    lastChecked = 0;
    // Do not stack repeated maintenance rebuilds while a previous one is pending.
    if (running || scheduled) return;
    try {
        cursor ||= placementIndex.entries();
        for (let step = 0; step < VALIDATION_POSITION_BUDGET; step++) {
            const next = cursor.next();
            if (next.done) { cursor = undefined; break; }
            if (!next.value) continue;
            const { dimensionId, location } = next.value;
            let dimension;
            try { dimension = world.getDimension(dimensionId); } catch { continue; }
            lastChecked++;
            try { if (!dimension.isChunkLoaded(location)) continue; } catch { continue; }
            const block = read(dimension, location);
            if (!block?.isValid) continue; // Unloaded is not proof of removal.
            const key = `${dimensionId}|${keyOf(location)}`;
            if (!electrical(block)) { queueMutation(dimension, location); continue; }
            const signature = fingerprint(block);
            const descriptor = descriptorForBlock(block);
            const missing = descriptor?.lanes.some(lane => runtime.networkIdOf(`${key}#${lane.id}`) === undefined);
            if (fingerprints.get(key) !== signature || missing ||
                (block.type.id === CABLE_ID && block.permutation.getState("starstone:connections") !== computeCableMask(block)) ||
                (block.type.id === INNER_CORNER_ID && staleInnerCorner(block)) ||
                unsupported(block)) queueMutation(dimension, location);
            fingerprints.set(key, signature);
        }
    } catch (error) {
        cursor = undefined;
        console.warn(`[Starstone] Indexed validation failed: ${error.message}`);
    }
}

export function registerMutationController() {
    if (registered) return;
    world.afterEvents.blockExplode.subscribe(event => {
        try { queueMutation(event.dimension || event.block.dimension, event.block.location); }
        catch (error) { console.warn(`[Starstone] Explosion repair could not queue: ${error.message}`); }
    });
    system.runInterval(validateKnownPositions, VALIDATION_INTERVAL_TICKS);
    registered = true;
}
