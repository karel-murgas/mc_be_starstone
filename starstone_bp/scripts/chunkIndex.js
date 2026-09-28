// Persistent chunk-local electrical components. No world data is read on import.
// See docs/CHUNK-SEGMENTS.md in the mod repo for the recoverable page protocol.
import { world } from "@minecraft/server";
import { descriptorForBlock } from "./electricalBlocks.js";
import { worldDirOfPort } from "./portDirections.js";
import { ARM_NAMES } from "./constants.js";
import { FACE_LIST } from "./surfaceFrame.js";
import { outerCornerOffset, outerOffsets, outerWrap, wrapFaces } from "./cornerTopology.js";
import { innerNeighborAllowed, facesOfPair } from "./innerCorner.js";

export const CHUNK_SCHEMA_VERSION = 1;
export const CHUNK_PROPERTY_PREFIX = "starstone:segments:";
export const CHUNK_PAGE_BYTES = 24000;
export const CHUNK_MAX_PAGES = 4096;
const DIMENSION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const INTEGER = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
const KINDS = new Set(["cable", "inner-corner", "bridge", "conduit", "source", "consumer", "adapter-in", "adapter-out"]);
const FACES = new Set(["up", "down", "north", "south", "east", "west"]);
const same = (a, b) => a.every((value, i) => value === b[i]);
const negate = dir => dir.map(value => -value);
const chunk = value => Math.floor(value / 16);

export function parseSegmentNodeRef(ref) {
    if (typeof ref !== "string") return undefined;
    const match = /^([^|]+)\|([^|]+)\|([^|]+)\|([^|#]+)#(main|ns|ew)$/.exec(ref);
    if (!match || !DIMENSION.test(match[1]) || !match.slice(2, 5).every(value => INTEGER.test(value))) return undefined;
    const [x, y, z] = match.slice(2, 5).map(Number);
    if (![x, y, z].every(Number.isSafeInteger) || [x, y, z].some(value => Math.abs(value) > 2147483647)) return undefined;
    return { dimensionId: match[1], x, y, z, lane: match[5] };
}

function validChunk(dimensionId, cx, cz) {
    return typeof dimensionId === "string" && DIMENSION.test(dimensionId) && Number.isSafeInteger(cx) && Number.isSafeInteger(cz) &&
        Math.abs(cx) <= 134217727 && Math.abs(cz) <= 134217727;
}

function nodeRef(dimensionId, location, lane) {
    return `${dimensionId}|${location.x}|${location.y}|${location.z}#${lane}`;
}

// Shared by the local builder and metadata graph. Direction is from a to b.
// Reciprocal directions are necessary but do not override mounting or conduit
// rules. A conduit can contact a surface only through that surface's back.
export function compatibleSegmentContacts(a, b, direction) {
    if (direction.reduce((sum, value) => sum + Math.abs(value), 0) === 2) {
        return Boolean(outerWrap(a,b,direction));
    }
    if (a.kind === "inner-corner" && !innerNeighborAllowed(a,b,direction)) return false;
    if (b.kind === "inner-corner" && !innerNeighborAllowed(b,a,negate(direction))) return false;
    if (a.mountFace && b.mountFace && a.mountFace !== b.mountFace) return false;
    const surface = a.mountFace ? a : b;
    const full = a.mountFace ? b : a;
    if (surface.mountFace && full.kind === "conduit") {
        const towardFull = a.mountFace ? direction : negate(direction);
        if (!same(worldDirOfPort(surface.mountFace, "back"), towardFull)) return false;
    }
    return true;
}

function directions(descriptor, lane) {
    const ports = new Set(lane.ports);
    // A cable's visible mask can lose an arm when its neighbor unloads. Segment
    // topology records potential contacts; exact reciprocal metadata decides
    // whether a connection actually exists.
    if (descriptor.kind === "cable") for (const arm of ARM_NAMES) ports.add(arm);
    // The support may be across an unloaded horizontal border. Keep its
    // potential back contact; matching metadata will require a full source or
    // correctly oriented conduit. Bridges deliberately have no back contact.
    if (descriptor.mountFace && descriptor.kind !== "bridge") ports.add("back");
    const result = new Map();
    for (const port of ports) {
        const dir = worldDirOfPort(descriptor.mountFace, port);
        if (dir) result.set(dir.join(","), dir.map(value => value || 0));
        if (port !== "back" && dir) for (const around of outerOffsets(descriptor, dir)) result.set(around.join(","),around);
    }
    return [...result.values()];
}

function allowedContact(a, b, dir) {
    if (!compatibleSegmentContacts(a, b, dir)) return false;
    if (dir.reduce((sum, value) => sum + Math.abs(value), 0) === 2) return true;
    // Potential back contacts cannot join two surface elements, or an unrelated
    // full block. Tangent surface contacts still use the ordinary rules.
    for (const [surface, other, towardOther] of [[a, b, dir], [b, a, negate(dir)]]) {
        if (surface.mountFace && same(worldDirOfPort(surface.mountFace, "back"), towardOther) &&
            (other.mountFace || (other.kind !== "conduit" && other.kind !== "source"))) return false;
    }
    return true;
}

export { allowedContact as reciprocalSegmentContact };

// Pure construction from validated, complete indexed observations in one chunk.
// The stable local key is its lexicographically smallest lane-aware NodeRef;
// input order and source/visual state changes therefore do not change the key.
export function buildChunkSegments(dimensionId, cx, cz, entries) {
    if (!validChunk(dimensionId, cx, cz)) throw new Error("Invalid segment chunk");
    const nodes = new Map(), byPosition = new Map();
    for (const { location, descriptor } of entries) {
        if (!descriptor) continue;
        for (const lane of descriptor.lanes) {
            const ref = nodeRef(dimensionId, location, lane.id);
            if (!parseSegmentNodeRef(ref) || chunk(location.x) !== cx || chunk(location.z) !== cz || nodes.has(ref)) {
                throw new Error("Invalid or duplicate segment member");
            }
            const item = { ref, location, descriptor, lane, directions: directions(descriptor, lane), neighbors: new Set(), boundaries: [] };
            nodes.set(ref, item);
            const key = `${location.x}|${location.y}|${location.z}`;
            if (!byPosition.has(key)) byPosition.set(key, []);
            byPosition.get(key).push(item);
        }
    }
    for (const item of nodes.values()) {
        const { x, y, z } = item.location;
        for (const dir of item.directions) {
            const [nx, ny, nz] = [x + dir[0], y + dir[1], z + dir[2]];
            if (chunk(nx) !== cx || chunk(nz) !== cz) {
                item.boundaries.push({
                    ref: item.ref, direction: [...dir], destination: [chunk(nx), chunk(nz)],
                    kind: item.descriptor.kind, mountFace: item.descriptor.mountFace || null,
                    facePair: item.descriptor.facePair || null
                });
                continue;
            }
            for (const neighbor of byPosition.get(`${nx}|${ny}|${nz}`) || []) {
                if (allowedContact(item.descriptor, neighbor.descriptor, dir) && neighbor.directions.some(other => same(other, negate(dir)))) {
                    item.neighbors.add(neighbor.ref);
                }
            }
        }
    }
    const visited = new Set(), segments = [];
    for (const seed of [...nodes.keys()].sort()) {
        if (visited.has(seed)) continue;
        const queue = [seed], members = [], sources = [], activeSources = [], consumers = [], boundaries = [];
        visited.add(seed);
        for (let head = 0; head < queue.length; head++) {
            const item = nodes.get(queue[head]);
            members.push(item.ref);
            if (item.descriptor.kind === "source" || item.descriptor.kind === "adapter-in") sources.push(item.ref);
            if (item.lane.sourceOn) {
                if (!sources.includes(item.ref)) sources.push(item.ref);
                activeSources.push(item.ref);
            }
            if (item.descriptor.kind === "consumer" || item.descriptor.kind === "adapter-out") consumers.push(item.ref);
            boundaries.push(...item.boundaries);
            for (const neighbor of item.neighbors) if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
        members.sort(); sources.sort(); activeSources.sort(); consumers.sort();
        boundaries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        segments.push({ key: members[0], members, sources, activeSources, consumers, boundaries });
    }
    return { v: CHUNK_SCHEMA_VERSION, dimensionId, cx, cz, segments };
}

// Generator reads only explicitly loaded indexed locations. A single unavailable
// indexed position makes the result undefined, preserving the prior whole-chunk
// snapshot. A guarded Block view also protects descriptor support lookups.
export function* buildIndexedChunkSegments(dimension, cx, cz, placementIndex) {
    const entries = [];
    for (const location of placementIndex.positionsInChunk(dimension.id, cx, cz)) {
        let block;
        try {
            if (!dimension.isChunkLoaded(location)) return undefined;
            block = dimension.getBlock(location);
            if (!block?.isValid) return undefined;
        } catch { return undefined; }
        const guardedDimension = {
            getBlock(position) {
                try { return dimension.isChunkLoaded(position) ? dimension.getBlock(position) : undefined; }
                catch { return undefined; }
            }
        };
        const descriptor = descriptorForBlock({
            isValid: true, type: block.type, location: { ...location },
            permutation: block.permutation, dimension: guardedDimension
        });
        if (descriptor) entries.push({ location: { ...location }, descriptor });
        yield;
    }
    return buildChunkSegments(dimension.id, cx, cz, entries);
}

// Strict validation is shared by disk reads and pure graph input. A corrupt
// chunk is never partly admitted as a valid logical conductor.
export function validateChunkSegments(snapshot) {
    if (!snapshot || snapshot.v !== CHUNK_SCHEMA_VERSION || !validChunk(snapshot.dimensionId, snapshot.cx, snapshot.cz) || !Array.isArray(snapshot.segments)) return false;
    const allMembers = new Set(), keys = new Set();
    for (const segment of snapshot.segments) {
        if (!segment || !Array.isArray(segment.members) || !segment.members.length || keys.has(segment.key)) return false;
        keys.add(segment.key);
        const members = new Set();
        for (const ref of segment.members) {
            const p = parseSegmentNodeRef(ref);
            if (!p || p.dimensionId !== snapshot.dimensionId || chunk(p.x) !== snapshot.cx || chunk(p.z) !== snapshot.cz || allMembers.has(ref)) return false;
            members.add(ref); allMembers.add(ref);
        }
        if (segment.key !== [...members].sort()[0]) return false;
        for (const field of ["sources", "activeSources", "consumers"]) {
            if (!Array.isArray(segment[field]) || new Set(segment[field]).size !== segment[field].length || segment[field].some(ref => !members.has(ref))) return false;
        }
        if (segment.activeSources.some(ref => !segment.sources.includes(ref)) || !Array.isArray(segment.boundaries)) return false;
        const seenBoundaries = new Set();
        for (const port of segment.boundaries) {
            if (!port || !members.has(port.ref) || !Array.isArray(port.direction) || port.direction.length !== 3 ||
                !port.direction.every(v => Number.isInteger(v) && Math.abs(v) <= 1) ||
                ![1,2].includes(port.direction.reduce((n, v) => n + Math.abs(v), 0)) ||
                !Array.isArray(port.destination) || port.destination.length !== 2 || !KINDS.has(port.kind) ||
                (port.mountFace !== null && !FACES.has(port.mountFace))) return false;
            const p = parseSegmentNodeRef(port.ref), [dx, , dz] = port.direction;
            const destination = [chunk(p.x + dx), chunk(p.z + dz)];
            if (!same(destination, port.destination) || (destination[0] === snapshot.cx && destination[1] === snapshot.cz)) return false;
            if (port.kind === "bridge" && (p.lane === "main" || !port.mountFace || same(worldDirOfPort(port.mountFace, "back"), port.direction))) return false;
            if (port.kind !== "bridge" && p.lane !== "main") return false;
            const diagonal = port.direction.reduce((n,v)=>n+Math.abs(v),0) === 2;
            if (port.kind === "inner-corner" &&
                (port.mountFace !== null || !facesOfPair(port.facePair) || (!diagonal &&
                 !facesOfPair(port.facePair).some(face=>
                     innerNeighborAllowed(port,{mountFace:face},port.direction))))) return false;
            if (["cable", "bridge", "consumer", "adapter-in", "adapter-out"].includes(port.kind) && !port.mountFace) return false;
            if (diagonal && !wrapFaces(port).some(from => FACE_LIST.some(face => {
                    const offset = outerCornerOffset(from,face);
                    return offset && same(offset,port.direction);
                }))) return false;
            if (port.kind === "conduit" && port.mountFace) return false;
            if (port.kind === "bridge") {
                const arms = p.lane === "ns" ? ["local_n", "local_s"] : ["local_e", "local_w"];
                if (!arms.some(arm => same(worldDirOfPort(port.mountFace, arm), port.direction))) return false;
            }
            const key = `${port.ref}|${port.direction.join(",")}`;
            if (seenBoundaries.has(key)) return false;
            seenBoundaries.add(key);
        }
    }
    return true;
}

function checksum(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
}

function propertyBase(dimensionId, cx, cz) {
    if (!validChunk(dimensionId, cx, cz)) throw new Error("Invalid segment chunk");
    return `${CHUNK_PROPERTY_PREFIX}${encodeURIComponent(dimensionId)}|${cx}|${cz}`;
}

function parseHead(raw) {
    if (typeof raw !== "string") throw new Error("Invalid segment head");
    const head = JSON.parse(raw);
    if (!head || head.v !== CHUNK_SCHEMA_VERSION || ![0, 1].includes(head.bank) || !Number.isInteger(head.pages) ||
        head.pages < 1 || head.pages > CHUNK_MAX_PAGES || !Number.isInteger(head.length) || head.length < 1 ||
        Math.ceil(head.length / CHUNK_PAGE_BYTES) !== head.pages || typeof head.checksum !== "string" || !/^[a-f0-9]{1,8}$/.test(head.checksum)) throw new Error("Invalid segment head");
    return head;
}

export function createChunkIndex(storage, { warn = message => console.warn(message) } = {}) {
    const warned = new Set();
    function corrupt(key) {
        if (warned.has(key)) return;
        warned.add(key);
        try { warn(`[Starstone] Ignoring corrupt segment chunk ${key}`); } catch { /* Diagnostic only. */ }
    }
    function readChunk(dimensionId, cx, cz) {
        const base = propertyBase(dimensionId, cx, cz);
        const rawHead = storage.getDynamicProperty(`${base}:head`);
        if (rawHead === undefined) return undefined;
        let head;
        try { head = parseHead(rawHead); } catch { corrupt(base); return undefined; }
        const parts = [];
        for (let i = 0; i < head.pages; i++) {
            const part = storage.getDynamicProperty(`${base}:${head.bank}:${i}`);
            const expected = Math.min(CHUNK_PAGE_BYTES, head.length - i * CHUNK_PAGE_BYTES);
            if (typeof part !== "string" || part.length !== expected || /[^\x00-\x7f]/.test(part)) { corrupt(base); return undefined; }
            parts.push(part);
        }
        const text = parts.join("");
        try {
            if (checksum(text) !== head.checksum) throw new Error("Segment checksum mismatch");
            const snapshot = JSON.parse(text);
            if (!validateChunkSegments(snapshot) || snapshot.dimensionId !== dimensionId || snapshot.cx !== cx || snapshot.cz !== cz) throw new Error("Invalid segment snapshot");
            return snapshot;
        } catch { corrupt(base); return undefined; }
    }
    function writeChunk(snapshot) {
        if (!validateChunkSegments(snapshot)) throw new Error("Invalid segment snapshot");
        const base = propertyBase(snapshot.dimensionId, snapshot.cx, snapshot.cz);
        const text = JSON.stringify(snapshot).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
        const pages = Math.ceil(text.length / CHUNK_PAGE_BYTES);
        if (pages > CHUNK_MAX_PAGES) throw new Error("Segment chunk exceeds page limit");
        const rawHead = storage.getDynamicProperty(`${base}:head`);
        let oldHead;
        if (rawHead !== undefined) {
            try { oldHead = parseHead(rawHead); } catch { corrupt(base); }
        }
        const previous = readChunk(snapshot.dimensionId, snapshot.cx, snapshot.cz);
        if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return true;
        const bank = oldHead ? 1 - oldHead.bank : 0;
        for (let i = 0; i < pages; i++) storage.setDynamicProperty(`${base}:${bank}:${i}`, text.slice(i * CHUNK_PAGE_BYTES, (i + 1) * CHUNK_PAGE_BYTES));
        // The sole commit point. Until this succeeds all readers retain the
        // previous complete bank. Exceptions propagate; no RAM state is advanced.
        storage.setDynamicProperty(`${base}:head`, JSON.stringify({ v: CHUNK_SCHEMA_VERSION, bank, pages, length: text.length, checksum: checksum(text) }));
        return true;
    }
    function* chunks() {
        for (const key of storage.getDynamicPropertyIds()) {
            if (typeof key !== "string" || !key.startsWith(CHUNK_PROPERTY_PREFIX) || !key.endsWith(":head")) continue;
            const parts = key.slice(CHUNK_PROPERTY_PREFIX.length, -5).split("|");
            let dimensionId;
            try { dimensionId = decodeURIComponent(parts[0]); } catch { corrupt(key); continue; }
            if (parts.length !== 3 || !parts.slice(1).every(p => INTEGER.test(p)) || !validChunk(dimensionId, Number(parts[1]), Number(parts[2])) || encodeURIComponent(dimensionId) !== parts[0]) { corrupt(key); continue; }
            const value = readChunk(dimensionId, Number(parts[1]), Number(parts[2]));
            if (value) yield value;
        }
    }
    function updateSource(ref, on) {
        const p = parseSegmentNodeRef(ref);
        if (!p || typeof on !== "boolean") return false;
        const snapshot = readChunk(p.dimensionId, chunk(p.x), chunk(p.z));
        const segment = snapshot?.segments.find(s => s.sources.includes(ref));
        if (!segment) return false;
        const active = new Set(segment.activeSources);
        if (on) active.add(ref); else active.delete(ref);
        segment.activeSources = [...active].sort();
        return writeChunk(snapshot);
    }
    return { readChunk, writeChunk, chunks, updateSource };
}

export const chunkIndex = createChunkIndex(world);
