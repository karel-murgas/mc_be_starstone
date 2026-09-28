// diagnostics.js
//
// Bounded diagnostics for the Starstone runtime.
//
// Three /scriptevent starstone:* commands, all handled in the after event so the
// world stays writable for dynamic properties and player messages:
//
//   diagnose        count cached networks/nodes/rebuild jobs and describe the
//                   electrical block the player is looking at. "cable" reports
//                   its live arm mask/directions. Read-only throughout.
//   rebuild_nearby  start one bounded rebuild scan around the invoking player,
//                   spread across runJob ticks. A second call while one is
//                   running is rejected instead of stacked.
//   debug on|off    store concise-logs state in a world dynamic property.
//
// Runtime counts come from networkRuntime.js; repair.js owns recovery jobs.

import { system, world } from "@minecraft/server";
import runtime from "./networkRuntime.js";
import { descriptorForBlock } from "./electricalBlocks.js";
import { startRebuildNearby, isRebuildRunning, REBUILD_RADIUS, REBUILD_HEIGHT } from "./repair.js";
export { startRebuildNearby, isRebuildRunning } from "./repair.js";
import { CABLE_ID, KIND_BY_ID } from "./constants.js";
import { mutationStats } from "./mutationController.js";
import { chunkStats } from "./chunkController.js";
import { adapterStats } from "./redstoneAdapters.js";
import { powerStats } from "./powerPropagation.js";
import { message } from "./messages.js";
import { ARM_NAMES, isValidFace, worldOffset } from "./surfaceFrame.js";

const TAG = "[Starstone]";

// The world dynamic property that persists debug-logs state across reloads.
const DEBUG_PROPERTY = "starstone:diagnostics:debug";

// How far a player's look can reach when diagnose targets a block.
const DIAGNOSE_DISTANCE = 6;

// Read debug state: on when the property is exactly "on", off otherwise.
export function debugEnabled() {
    return world.getDynamicProperty(DEBUG_PROPERTY) === "on";
}

// Persist debug state in the world dynamic property.
export function setDebugEnabled(on) {
    world.setDynamicProperty(DEBUG_PROPERTY, on ? "on" : "off");
}

// A concise, single-line description of an electrical block's descriptor, or a
// fixed string for anything that is not an electrical block. Never throws.
function blockDescription(block) {
    try {
        if (!block?.isValid) return undefined;
        const id = block.type.id;
        if (!KIND_BY_ID[id]) return { id };
        let descriptor;
        try { descriptor = descriptorForBlock(block); } catch { /* Keep identifier if descriptor became invalid. */ }
        const lanes = descriptor?.lanes || [];
        return { id, kind: descriptor?.kind || KIND_BY_ID[id], lanes: lanes.length,
            powered: lanes.filter(lane => lane?.powered).length };
    } catch { return undefined; }
}

// Retain the existing plain description API. Chat uses the localized form.
export function describeBlock(block) {
    const info = blockDescription(block);
    if (!info) return "no block targeted";
    if (!info.kind) return `${info.id}: not an electrical block`;
    return `${info.id} (${info.kind}), ${info.lanes} lane(s), ${info.powered} powered`;
}

function targetMessage(block) {
    const info = blockDescription(block);
    if (!info) return message("target.none");
    if (!info.kind) return message("target.other", info.id);
    return message("target.electrical", info.id, info.kind, info.lanes, info.powered);
}

// The first electrical block the player is looking at, within DIAGNOSE_DISTANCE,
// or undefined when the look hits nothing electrical. Read-only.
export function targetedElectricalBlock(player) {
    let hit;
    try {
        hit = player.getBlockFromViewDirection({ maxDistance: DIAGNOSE_DISTANCE });
    } catch {
        return undefined;
    }
    if (!hit || !hit.block || !hit.block.isValid) {
        return undefined;
    }
    return hit.block;
}

// Bounded diagnostics: one line of counts plus one line describing the targeted
// electrical block. Never changes a block.
export function diagnose(player, rawMessage = "") {
    const request = String(rawMessage).trim();
    if (request.toLowerCase() === "cable") return diagnoseCable(player);
    if (request) return diagnoseChunk(player, request);
    const mutations = mutationStats();
    const chunks = chunkStats();
    const adapters = adapterStats();
    const power = powerStats();
    let bytes = "?";
    try { bytes = world.getDynamicPropertyTotalByteCount(); } catch { /* Do not invent zero on storage-query failure. */ }
    const lines = [
        message("diagnose.counts", runtime.networkCount(), runtime.nodeCount(), isRebuildRunning() ? 1 : 0),
        message("diagnose.validation", mutations.running ? 1 : 0, mutations.lastChecked, mutations.validationBudget, mutations.validationInterval),
        message("diagnose.logical", chunks.logicalNetworks, chunks.running ? 1 : 0, chunks.retry, adapters.registeredInputs, adapters.lastPolled),
        // Counts all this addon's WORLD properties, including both saved banks;
        // this is neither active-segment bytes alone nor script heap memory.
        message("diagnose.power", power.queued, power.peakQueued, power.planning, bytes)
    ];
    lines.push(targetMessage(targetedElectricalBlock(player)));
    if (debugEnabled()) {
        lines.push(message("debug.active"));
    }
    player.sendMessage({ rawtext: lines });
}

// Read the live state while looking at a cable. The direction list is derived
// from the same face frame that connectivity uses, but does not change state.
// This separates a wrong mask from a wrong client-side geometry orientation.
export function diagnoseCable(player) {
    const block = targetedElectricalBlock(player);
    if (!block?.isValid || block.type.id !== CABLE_ID) {
        player.sendMessage(message("cable.target"));
        return;
    }
    const face = block.permutation.getState("minecraft:block_face");
    const mask = block.permutation.getState("starstone:connections");
    if (!isValidFace(face) || !Number.isInteger(mask) || mask < 0 || mask > 15) {
        player.sendMessage(message("cable.invalid"));
        return;
    }
    const directions = ARM_NAMES.map((arm, index) => {
        const [x, y, z] = worldOffset(face, arm);
        return `${mask & (1 << index) ? "on" : "off"}:${arm.slice(6)}(${x},${y},${z})`;
    }).join(" ");
    const { x, y, z } = block.location;
    player.sendMessage(message("cable.state", x, y, z, face, mask, directions));
}

// Explicit load-state probe: one API query, no block read/raycast/volume scan.
export function diagnoseChunk(player, request) {
    const parts = request.trim().split(/\s+/);
    if (parts[0].toLowerCase() !== "chunk" || parts.length < 3 || parts.length > 4 ||
        !parts.slice(1).every(value => /^-?\d+$/.test(value))) {
        player.sendMessage(message("chunk.usage"));
        return;
    }
    const cx = Number(parts[1]), cz = Number(parts[2]);
    const y = parts.length === 4 ? Number(parts[3]) : Math.floor(player.location.y);
    const x = cx * 16 + 8, z = cz * 16 + 8;
    if (![cx, cz, x, y, z].every(Number.isSafeInteger) || Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || Math.abs(y) > 2147483647) {
        player.sendMessage(message("chunk.usage"));
        return;
    }
    const dimension = player.dimension;
    let status = "unavailable";
    try { status = dimension.isChunkLoaded({ x, y, z }) ? "loaded" : "unloaded"; }
    catch { /* Outside bounds/invalid dimension: unknown is not unloaded. */ }
    player.sendMessage(message(`chunk.${status}`, dimension.id, cx, cz, y));
}

// Handle the "on|off" argument of the debug command, reporting the current state
// when the argument is missing or unrecognized.
export function handleDebug(player, rawMessage) {
    const arg = (rawMessage || "").trim().toLowerCase();
    if (arg === "on") {
        setDebugEnabled(true);
        player.sendMessage(message("debug.on"));
        return;
    }
    if (arg === "off") {
        setDebugEnabled(false);
        player.sendMessage(message("debug.off"));
        return;
    }
    player.sendMessage(message(debugEnabled() ? "debug.usage_on" : "debug.usage_off"));
}

// Subscribe the three commands to the namespaced /scriptevent after event.
export function registerDiagnostics() {
    system.afterEvents.scriptEventReceive.subscribe(
        (event) => {
            if (
                event.id !== "starstone:diagnose" &&
                event.id !== "starstone:rebuild_nearby" &&
                event.id !== "starstone:debug"
            ) {
                return;
            }
            const player = event.sourceEntity;
            if (!player || !player.isValid || player.typeId !== "minecraft:player") {
                return;
            }
            try {
                switch (event.id) {
                    case "starstone:diagnose":
                        diagnose(player, event.message);
                        break;
                    case "starstone:rebuild_nearby":
                        startRebuildNearby(player);
                        break;
                    case "starstone:debug":
                        handleDebug(player, event.message);
                        break;
                }
            } catch (err) {
                console.warn(`${TAG} Could not handle ${event.id}: ${err.message}`);
            }
        },
        { namespaces: ["starstone"] }
    );
}

export { DEBUG_PROPERTY, REBUILD_RADIUS, REBUILD_HEIGHT };
