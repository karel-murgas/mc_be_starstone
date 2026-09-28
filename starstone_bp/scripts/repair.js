// Recovery seeds are bounded; connected loaded networks can extend beyond them.
// All world access is deferred until a command or an initial-spawn callback.
import { system, world } from "@minecraft/server";
import { descriptorForBlock } from "./electricalBlocks.js";
import { discoverAndRegisterNetwork } from "./networkController.js";
import { refreshCable } from "./cableComponent.js";
import { KIND_BY_ID } from "./constants.js";
import { placementIndex } from "./persistence.js";
import { message } from "./messages.js";

export const REBUILD_RADIUS = 8;
export const REBUILD_HEIGHT = 4;
const TAG = "[Starstone]";
const SECTION_SIZE = 16;
let active;
let registered = false;
const queued = new Map();
const completed = new Set();

export function isRebuildRunning() { return active !== undefined; }
export function recoveryStats() {
    return { running: isRebuildRunning(), queued: queued.size, completedAreas: completed.size };
}

function requirePlayer(player) {
    if (!player?.isValid) throw new Error("Recovery player disconnected");
}
function read(dimension, location) {
    try { return dimension.getBlock(location); } catch { return undefined; }
}
function electrical(block) {
    return block?.isValid && KIND_BY_ID[block.type.id];
}
function recordBlock(block) {
    // A corrupt hint shard is already warned about by the index. Its rejection
    // must not block reconstruction from authoritative world blocks elsewhere.
    // Actual storage failures still throw and leave this area retryable.
    placementIndex.record(block);
}
function capture(player) {
    requirePlayer(player);
    const dimension = player.dimension;
    const { x, y, z } = player.location;
    if (!dimension || ![x, y, z].every(Number.isFinite)) throw new Error("Invalid recovery origin");
    return { dimension, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

// Iterate one position per job step. Validate remembered positions first, but
// discover from current world blocks; the index never proves a block exists.
function* rebuild(request) {
    const { player, dimension, bounds, key } = request;
    const seeds = [];
    const seen = new Set();
    const indexed = new Set();
    let components = 0;
    let success = false;
    try {
        requirePlayer(player);
        if (typeof dimension.id === "string") {
            for (let cx = Math.floor(bounds.minX / 16); cx <= Math.floor(bounds.maxX / 16); cx++) {
                for (let cz = Math.floor(bounds.minZ / 16); cz <= Math.floor(bounds.maxZ / 16); cz++) {
                    yield* placementIndex.validateChunk(dimension, cx, cz);
                    requirePlayer(player);
                }
            }
        }
        // Finish every in-volume cable mask before any component traversal.
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
                    requirePlayer(player);
                    const location = { x, y, z };
                    const block = read(dimension, location);
                    if (electrical(block)) {
                        refreshCable(block);
                        recordBlock(block);
                        indexed.add(`${x},${y},${z}`);
                        seeds.push(location);
                    }
                    yield;
                }
            }
        }
        for (const location of seeds) {
            requirePlayer(player);
            const descriptor = descriptorForBlock(read(dimension, location));
            const laneIds = (descriptor?.lanes || []).map(lane => lane.id);
            for (const laneId of laneIds) {
                requirePlayer(player);
                const { x, y, z } = location;
                const ref = `${dimension.id}|${x}|${y}|${z}#${laneId}`;
                if (seen.has(ref)) continue;
                // A previous traversal yielded: do not retain Block or lane state.
                const block = read(dimension, location);
                const lane = descriptorForBlock(block)?.lanes.find(item => item.id === laneId);
                if (!lane) continue;
                let done = false, record, failure;
                discoverAndRegisterNetwork(block, lane).then(
                    result => { record = result; done = true; },
                    error => { failure = error; done = true; }
                );
                while (!done) { requirePlayer(player); yield; }
                if (failure) throw failure;
                seen.add(ref);
                if (record) {
                    components++;
                    // Include loaded blocks encountered beyond the seed volume.
                    for (const node of record.nodes) {
                        requirePlayer(player);
                        seen.add(node);
                        const [id, nx, ny, nz] = node.slice(0, node.lastIndexOf("#")).split("|");
                        const posKey = `${nx},${ny},${nz}`;
                        if (id === dimension.id && !indexed.has(posKey)) {
                            const current = read(dimension, { x: Number(nx), y: Number(ny), z: Number(nz) });
                            if (electrical(current)) recordBlock(current);
                            indexed.add(posKey);
                        }
                        yield;
                    }
                }
                yield;
            }
            yield;
        }
        requirePlayer(player);
        if (!key) player.sendMessage(message("rebuild.complete", seeds.length, components));
        success = true;
    } catch (error) {
        console.warn(`${TAG} Rebuild failed: ${error.message}`);
    } finally {
        if (success && key) completed.add(key);
        if (active === request) active = undefined;
        pumpQueue();
    }
}

function schedule(request) {
    active = request;
    try {
        if (!request.key) request.player.sendMessage(message("rebuild.start", request.radius, request.height));
        system.runJob(rebuild(request));
    } catch (error) {
        active = undefined;
        throw error;
    }
}

function pumpQueue() {
    if (active) return;
    for (const [key, request] of queued) {
        queued.delete(key);
        if (completed.has(key)) continue;
        try {
            requirePlayer(request.player);
            schedule(request);
            return;
        } catch (error) {
            // A failed request is not completed, allowing a later initial spawn.
            console.warn(`${TAG} Could not schedule recovery: ${error.message}`);
        }
    }
}

export function startRebuildNearby(player, { radius = REBUILD_RADIUS, height = REBUILD_HEIGHT } = {}) {
    if (active) {
        player.sendMessage(message("rebuild.busy"));
        return false;
    }
    radius = Number.isFinite(radius) ? Math.min(REBUILD_RADIUS, Math.max(0, Math.floor(radius))) : REBUILD_RADIUS;
    height = Number.isFinite(height) ? Math.min(REBUILD_HEIGHT, Math.max(0, Math.floor(height))) : REBUILD_HEIGHT;
    const { dimension, x, y, z } = capture(player);
    try {
        schedule({ player, dimension, radius, height, bounds: {
            minX: x - radius, maxX: x + radius, minY: y - height,
            maxY: y + height, minZ: z - radius, maxZ: z + radius
        } });
    } catch (error) {
        pumpQueue();
        throw error;
    }
    return true;
}

export function queueInitialSpawn(event) {
    if (event.initialSpawn !== true) return;
    // The event supplies a player, but mutable location/dimension are captured
    // next tick, once writable world access is available.
    const player = event.player;
    try {
        system.run(() => {
            try {
                const { dimension, x, y, z } = capture(player);
                const cx = Math.floor(x / SECTION_SIZE), cy = Math.floor(y / SECTION_SIZE), cz = Math.floor(z / SECTION_SIZE);
                const key = `${dimension.id}|${cx}|${cy}|${cz}`;
                if (completed.has(key) || queued.has(key) || active?.key === key) return;
                queued.set(key, { player, dimension, key, bounds: {
                    minX: cx * 16, maxX: cx * 16 + 15,
                    minY: cy * 16, maxY: cy * 16 + 15,
                    minZ: cz * 16, maxZ: cz * 16 + 15
                } });
                pumpQueue();
            } catch (error) {
                console.warn(`${TAG} Could not queue recovery: ${error.message}`);
            }
        });
    } catch (error) {
        console.warn(`${TAG} Could not defer recovery: ${error.message}`);
    }
}

export function registerRecovery() {
    if (registered) return;
    world.afterEvents.playerSpawn.subscribe(queueInitialSpawn);
    registered = true;
}
