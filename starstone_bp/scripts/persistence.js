// Durable placement hints only: blocks in the world remain authoritative.
// Schema: starstone:placement:<URI-encoded dimension>|cx|sectionY|cz stores
// {v:1,p:[localIndex,...]}, sorted and unique. A local index is x+16*z+256*y,
// with each local coordinate in [0,15]. Negative coordinates use floor division.
// Each property holds at most one 16x16x16 section: even all 4,096 positions
// serialize to less than 20 KB of ASCII, below the dynamic-property limit.
// No property registration or world reads occur while this module is imported.
import { world } from "@minecraft/server";
import { KIND_BY_ID } from "./constants.js";

export const PLACEMENT_PROPERTY_PREFIX = "starstone:placement:";
export const PLACEMENT_SCHEMA_VERSION = 1;
export const PLACEMENT_SECTION_SIZE = 16;
export const PLACEMENT_MAX_STRING_BYTES = 32767;
export const PLACEMENT_MAX_SECTION_POSITIONS = 4096;

// Reject shard origins whose complete local coordinate range cannot be
// represented exactly. This is far beyond actual Minecraft coordinate bounds.
const MAX_SECTION = Math.floor((Number.MAX_SAFE_INTEGER - 15) / 16);
const MIN_SECTION = Math.ceil(Number.MIN_SAFE_INTEGER / 16);
const INTEGER_TEXT = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
const DIMENSION_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

function validSection(value) {
    return Number.isSafeInteger(value) && value >= MIN_SECTION && value <= MAX_SECTION;
}

function validDimension(value) {
    return typeof value === "string" && DIMENSION_ID.test(value);
}

function address(dimensionId, location) {
    if (!validDimension(dimensionId) || !location) return undefined;
    const { x, y, z } = location;
    if (![x, y, z].every(Number.isSafeInteger)) return undefined;
    const cx = Math.floor(x / 16), sy = Math.floor(y / 16), cz = Math.floor(z / 16);
    if (![cx, sy, cz].every(validSection)) return undefined;
    return {
        key: `${PLACEMENT_PROPERTY_PREFIX}${encodeURIComponent(dimensionId)}|${cx}|${sy}|${cz}`,
        code: (x - cx * 16) + 16 * (z - cz * 16) + 256 * (y - sy * 16)
    };
}

function parseKey(key) {
    if (typeof key !== "string" || !key.startsWith(PLACEMENT_PROPERTY_PREFIX)) return undefined;
    const parts = key.slice(PLACEMENT_PROPERTY_PREFIX.length).split("|");
    if (parts.length !== 4 || !parts.slice(1).every(part => INTEGER_TEXT.test(part))) return undefined;
    let dimensionId;
    try { dimensionId = decodeURIComponent(parts[0]); } catch { return undefined; }
    if (!validDimension(dimensionId) || encodeURIComponent(dimensionId) !== parts[0]) return undefined;
    const [cx, sy, cz] = parts.slice(1).map(Number);
    if (![cx, sy, cz].every(validSection)) return undefined;
    return { key, dimensionId, cx, sy, cz };
}

function position(shard, code) {
    return {
        x: shard.cx * 16 + code % 16,
        y: shard.sy * 16 + Math.floor(code / 256),
        z: shard.cz * 16 + Math.floor(code / 16) % 16
    };
}

function isElectrical(block) {
    return Boolean(block?.isValid && Object.prototype.hasOwnProperty.call(KIND_BY_ID, block.typeId));
}

export function createPlacementIndex(storage, { warn = message => console.warn(message) } = {}) {
    const warned = new Set();
    const changes = new Set();
    function notify(type, dimensionId, location) {
        for (const listener of changes) listener({ type, dimensionId, location: { ...location } });
    }
    function subscribeChanges(listener) {
        changes.add(listener);
        return () => changes.delete(listener);
    }

    function corrupt(key) {
        if (!warned.has(key)) {
            warned.add(key);
            // A diagnostic callback must not defeat isolation of a bad shard.
            try { warn(`[Starstone] Ignoring corrupt placement shard ${key}`); } catch { /* Diagnostic only. */ }
        }
    }

    function read(key) {
        // Keep storage exceptions outside JSON validation: an unavailable store
        // is not an empty or corrupt shard and must never be overwritten.
        const raw = storage.getDynamicProperty(key);
        if (raw === undefined) return new Set();
        try {
            if (typeof raw !== "string" || raw.length > PLACEMENT_MAX_STRING_BYTES) throw new Error("Invalid data");
            const data = JSON.parse(raw);
            if (!data || data.v !== PLACEMENT_SCHEMA_VERSION || !Array.isArray(data.p) ||
                Object.keys(data).length !== 2 || data.p.length > PLACEMENT_MAX_SECTION_POSITIONS) {
                throw new Error("Invalid schema");
            }
            const codes = new Set();
            for (const code of data.p) {
                if (!Number.isInteger(code) || code < 0 || code >= PLACEMENT_MAX_SECTION_POSITIONS || codes.has(code)) {
                    throw new Error("Invalid local position");
                }
                codes.add(code);
            }
            return codes;
        } catch {
            corrupt(key);
            return undefined;
        }
    }

    function write(key, codes) {
        if (codes.size === 0) {
            storage.setDynamicProperty(key, undefined);
            return;
        }
        const data = JSON.stringify({ v: PLACEMENT_SCHEMA_VERSION, p: [...codes].sort((a, b) => a - b) });
        // ASCII-only payload means JS length equals its UTF-8 byte count.
        if (data.length > PLACEMENT_MAX_STRING_BYTES) throw new Error("Placement shard exceeds storage limit");
        storage.setDynamicProperty(key, data);
    }

    function* shards(dimensionId, cx, cz) {
        for (const key of storage.getDynamicPropertyIds()) {
            if (typeof key !== "string" || !key.startsWith(PLACEMENT_PROPERTY_PREFIX)) continue;
            const shard = parseKey(key);
            if (!shard) {
                corrupt(key);
                continue;
            }
            if (dimensionId !== undefined && (shard.dimensionId !== dimensionId || shard.cx !== cx || shard.cz !== cz)) continue;
            yield shard;
        }
    }

    function validChunk(dimensionId, cx, cz) {
        return validDimension(dimensionId) && validSection(cx) && validSection(cz);
    }

    // true means durable success (including an already-satisfied operation).
    // false means invalid input or a corrupt shard, which remains untouched.
    // Storage failures throw; no speculative cache can claim a failed write won.
    function record(block) {
        let target;
        try {
            if (!isElectrical(block)) return false;
            target = address(block.dimension.id, block.location);
        } catch { return false; }
        if (!target) return false;
        const codes = read(target.key);
        if (!codes) return false;
        if (!codes.has(target.code)) {
            codes.add(target.code);
            write(target.key, codes);
            notify("record", block.dimension.id, block.location);
        }
        return true;
    }

    function remove(dimensionId, location) {
        const target = address(dimensionId, location);
        if (!target) return false;
        const codes = read(target.key);
        if (!codes) return false;
        if (codes.delete(target.code)) {
            write(target.key, codes);
            notify("remove", dimensionId, location);
        }
        return true;
    }

    function positionsInChunk(dimensionId, cx, cz) {
        if (!validChunk(dimensionId, cx, cz)) return [];
        const positions = [];
        for (const shard of shards(dimensionId, cx, cz)) {
            const codes = read(shard.key);
            if (codes) for (const code of codes) positions.push(position(shard, code));
        }
        return positions;
    }

    // Lazy round-robin source for bounded maintenance. A corrupt/empty shard
    // yields an empty work item too, so one caller step cannot skip an
    // unbounded collection of bad shards. No world blocks are read here.
    function* entries() {
        for (const key of storage.getDynamicPropertyIds()) {
            if (typeof key !== "string" || !key.startsWith(PLACEMENT_PROPERTY_PREFIX)) { yield undefined; continue; }
            const shard = parseKey(key);
            if (!shard) { corrupt(key); yield undefined; continue; }
            const codes = read(key);
            if (!codes?.size) { yield undefined; continue; }
            for (const code of codes) yield { dimensionId: shard.dimensionId, location: position(shard, code) };
        }
    }

    function* validateChunk(dimension, cx, cz) {
        const summary = { checked: 0, removed: 0, unavailable: 0 };
        const dimensionId = dimension?.id;
        if (!validChunk(dimensionId, cx, cz)) return summary;
        for (const shard of shards(dimensionId, cx, cz)) {
            const codes = read(shard.key);
            if (!codes) continue;
            for (const code of codes) {
                const location = position(shard, code);
                let loaded = false, electrical = false;
                try {
                    const block = dimension.getBlock(location);
                    loaded = Boolean(block?.isValid);
                    if (loaded) electrical = isElectrical(block);
                } catch { loaded = false; }
                summary.checked++;
                if (!loaded) summary.unavailable++;
                else if (!electrical) {
                    // Re-read this one shard before committing. Jobs yield and
                    // placement hooks can update its other entries meanwhile.
                    // Commit before yielding so a later re-placement cannot be
                    // erased by a deferred batch of previously stale positions.
                    const current = read(shard.key);
                    if (current?.delete(code)) {
                        write(shard.key, current);
                        notify("remove", dimensionId, location);
                        summary.removed++;
                    }
                }
                yield;
            }
        }
        return summary;
    }

    function stats() {
        // Enumerates saved hints only, never dimensions or world block volumes.
        // Result size is constant; shard reads are bounded by indexed storage.
        const summary = { shards: 0, positions: 0 };
        for (const shard of shards()) {
            const codes = read(shard.key);
            if (!codes || codes.size === 0) continue;
            summary.shards++;
            summary.positions += codes.size;
        }
        return summary;
    }

    return { record, remove, positionsInChunk, entries, validateChunk, stats, subscribeChanges };
}

export const placementIndex = createPlacementIndex(world);
