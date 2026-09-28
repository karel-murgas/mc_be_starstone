import { system } from "@minecraft/server";
import { REDSTONE_INPUT_ID, REDSTONE_OUTPUT_ID, STATE_POWERED, STATE_CONNECTIONS } from "./constants.js";
import { ARM_NAMES, worldOffset } from "./surfaceFrame.js";
import { cableConnectionMask } from "./cableTopology.js";
import { descriptorForBlock, cableDescriptor } from "./electricalBlocks.js";
import { CABLE_ID } from "./constants.js";
import { blockKey, parseNodeRef } from "./blockKeys.js";
import runtime, { isCompleteNetwork } from "./networkRuntime.js";
import { anySourceOn } from "./networkController.js";
import { applyPower } from "./powerPropagation.js";
import { sourceChanged, subscribeNetworkDiscovery } from "./networkEvents.js";

export const INPUT_POLL_TICKS = 4;
export const INPUT_NEIGHBOR_OFFSETS = Object.freeze([
    [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
]);
const inputs = new Map();
let registered = false, lastPolled = 0, transitions = 0;

export function trackInput(block) {
    if (!block?.isValid || block.typeId !== REDSTONE_INPUT_ID) return;
    const key = blockKey(block.dimension, block.location);
    if (!inputs.has(key)) inputs.set(key, {
        dimension: block.dimension, location: { ...block.location },
        last: Boolean(block.permutation.getState(STATE_POWERED))
    });
}

export function adapterStats() {
    return { registeredInputs: inputs.size, lastPolled, transitions, interval: INPUT_POLL_TICKS };
}

// The blue contacts follow the same coplanar network edges as cable. Red
// contacts are independent: they indicate a neighboring redstone conductor or
// source even when that neighbor currently carries zero power.
const REDSTONE_CONTACTS = new Set([
    "minecraft:redstone_wire", "minecraft:redstone_block", "minecraft:redstone_torch",
    "minecraft:unlit_redstone_torch", "minecraft:repeater", "minecraft:powered_repeater",
    "minecraft:unpowered_repeater", "minecraft:comparator", "minecraft:powered_comparator",
    "minecraft:unpowered_comparator", "minecraft:lever", "minecraft:stone_button",
    "minecraft:wooden_button", "minecraft:tripwire_hook", "minecraft:observer",
    "minecraft:daylight_detector", "minecraft:daylight_detector_inverted"
]);
function isRedstoneContact(block) {
    if (!block?.isValid || block.typeId?.startsWith("starstone:")) return false;
    if (REDSTONE_CONTACTS.has(block.typeId)) return true;
    try { return (block.getRedstonePower?.() ?? 0) > 0; } catch { return false; }
}
export function redstoneContactMask(block) {
    const face = block?.permutation?.getState("minecraft:block_face");
    if (!face) return 0;
    let mask = 0;
    for (let i = 0; i < ARM_NAMES.length; i++) {
        const [dx,dy,dz] = worldOffset(face, ARM_NAMES[i]);
        const { x,y,z } = block.location;
        const position = { x:x+dx, y:y+dy, z:z+dz };
        try {
            if (block.dimension.isChunkLoaded?.(position) === false) continue;
            if (isRedstoneContact(block.dimension.getBlock(position))) mask |= 1 << i;
        } catch { /* Unknown neighbor is not a visual contact. */ }
    }
    return mask;
}
export function refreshAdapterVisuals(block) {
    if (!block?.isValid || (block.typeId !== REDSTONE_INPUT_ID && block.typeId !== REDSTONE_OUTPUT_ID)) return;
    const face = block.permutation.getState("minecraft:block_face");
    const neighbors = {};
    for (const arm of ARM_NAMES) {
        const [dx,dy,dz] = worldOffset(face,arm);
        const {x,y,z} = block.location;
        const position = {x:x+dx,y:y+dy,z:z+dz};
        try {
            if (block.dimension.isChunkLoaded?.(position) === false) continue;
            const adjacent = block.dimension.getBlock(position);
            if (!adjacent?.isValid) continue;
            neighbors[arm] = adjacent.typeId === CABLE_ID
                ? cableDescriptor({mountFace:adjacent.permutation.getState("minecraft:block_face"),connections:15})
                : descriptorForBlock(adjacent);
        } catch { /* An unavailable neighbor is not a visual contact. */ }
    }
    const blue = cableConnectionMask(face,neighbors);
    const red = redstoneContactMask(block);
    let permutation = block.permutation;
    if (permutation.getState(STATE_CONNECTIONS) !== blue) permutation = permutation.withState(STATE_CONNECTIONS,blue);
    if (permutation.getState("starstone:redstone_connections") !== red) permutation = permutation.withState("starstone:redstone_connections",red);
    if (permutation !== block.permutation) block.setPermutation(permutation);
}

// A discovered network already has a source index. Registration reads only
// those source positions, never all cable nodes or a surrounding volume.
function observeSources(network, dimension) {
    for (const ref of network.sources) {
        const p = parseNodeRef(ref);
        if (!p || p.dimensionId !== dimension.id) continue;
        try {
            if (dimension.isChunkLoaded(p)) trackInput(dimension.getBlock(p));
        } catch { /* A later discovery will retry an unavailable source. */ }
    }
}

// A redstone input is a six-face receiver. The supporting block is one of
// these neighbors; another touching dust/device may also drive the adapter.
// Every read checks availability first. If no loaded neighbor drives it but
// one neighbor is unavailable, retain the previous state until a full sample.
export function readAdjacentRedstone(block) {
    let complete = true;
    const { dimension, location } = block;
    for (const [dx,dy,dz] of INPUT_NEIGHBOR_OFFSETS) {
        const position = { x:location.x+dx, y:location.y+dy, z:location.z+dz };
        try {
            if (!dimension.isChunkLoaded(position)) { complete = false; continue; }
            const neighbor = dimension.getBlock(position);
            if (!neighbor?.isValid) { complete = false; continue; }
            if ((neighbor.getRedstonePower?.() ?? 0) > 0) return { on:true, complete };
        } catch { complete = false; }
    }
    return { on:false, complete };
}

export function pollInputs() {
    lastPolled = 0;
    for (const [key, input] of inputs) {
        const { dimension, location } = input;
        try {
            if (!dimension.isChunkLoaded(location)) continue;
            const block = dimension.getBlock(location);
            if (!block?.isValid) continue;
            if (block.typeId !== REDSTONE_INPUT_ID) { inputs.delete(key); continue; }
            refreshAdapterVisuals(block);
            const sample = readAdjacentRedstone(block);
            if (!sample.on && !sample.complete) continue;
            lastPolled++;
            const on = sample.on;
            if (on === input.last && on === Boolean(block.permutation.getState(STATE_POWERED))) continue;
            if (Boolean(block.permutation.getState(STATE_POWERED)) !== on) {
                block.setPermutation(block.permutation.withState(STATE_POWERED, on));
            }
            // The durable controller commits source metadata before applying
            // consumer visuals. Without it, retain the loaded-network path.
            const committed = sourceChanged(dimension, location, on);
            const network = runtime.networkOf(runtime.networkIdOf(`${key}#main`));
            // Saved metadata decides only across unloaded chunks; a fully
            // loaded network follows its own sources immediately.
            if (!committed || isCompleteNetwork(network, dimension)) {
                if (network) {
                    const powered = anySourceOn(network, dimension);
                    if (powered !== network.powered) {
                        network.powered = powered;
                        applyPower(network, dimension);
                    }
                }
            }
            input.last = on;
            transitions++;
        } catch (error) {
            // Preserve the last committed input value so a transient storage
            // or world-access failure retries instead of silently losing power.
            console.warn(`[Starstone] Input poll deferred: ${error.message}`);
        }
    }
}

export function registerRedstoneAdapters() {
    if (registered) return;
    subscribeNetworkDiscovery(observeSources);
    system.runInterval(pollInputs, INPUT_POLL_TICKS);
    registered = true;
}
