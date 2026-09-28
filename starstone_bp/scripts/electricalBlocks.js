// electricalBlocks.js
//
// Descriptor and graph-neighbor rules for the Starstone electrical blocks.
//
// A descriptor is the plain data shape from plan section 5.4. It never holds a
// Block: descriptorForBlock reads a Block once and returns a fresh data object.
// The builders below are pure so they can be unit tested without Minecraft.
//
// Pure data and functions only. No Minecraft imports, no side effects at load.

import {
    LANE_MAIN, LANE_NS, LANE_EW,
    ARM_BITS,
    BACK_PORT,
    WORLD_UP, WORLD_DOWN, WORLD_NORTH, WORLD_SOUTH, WORLD_EAST, WORLD_WEST,
    AXIS_X, AXIS_Y, AXIS_Z, AXIS_FOR_FACE,
    KIND_BY_ID,
    STATE_BLOCK_FACE, STATE_CONNECTIONS, STATE_POWERED,
    STATE_POWERED_NS, STATE_POWERED_EW, STATE_AXIS, STATE_ENABLED,
    KIND_CABLE, KIND_INNER_CORNER, KIND_BRIDGE, KIND_CONDUIT, KIND_SOURCE, KIND_CONSUMER, KIND_ADAPTER_IN, KIND_ADAPTER_OUT,
    GENERATOR_ID, BRIDGE_ID
} from "./constants.js";

import { worldOffset, supportOffset } from "./surfaceFrame.js";
import { innerRoutes, facesOfPair, pairFromPermutation } from "./innerCorner.js";

// Block ids and lane ids re-exported for callers that import them by name from
// this module. The canonical definitions live in constants.js.
export { BRIDGE_ID };
export { LANE_NS, LANE_EW, LANE_MAIN };

// World vector -> world_* port name for the six cardinal directions. Every
// tangent arm of a mounting face resolves to exactly one of these.
const WORLD_VECTOR_TO_PORT = {
    "0,1,0": WORLD_UP,
    "0,-1,0": WORLD_DOWN,
    "0,0,-1": WORLD_NORTH,
    "0,0,1": WORLD_SOUTH,
    "1,0,0": WORLD_EAST,
    "-1,0,0": WORLD_WEST
};

function worldName(worldVec) {
    const name = WORLD_VECTOR_TO_PORT[`${worldVec[0]},${worldVec[1]},${worldVec[2]}`];
    if (!name) {
        throw new Error(`Unknown world vector: ${worldVec}`);
    }
    return name;
}

// The four joined tangent world ports of a mounting face, one per local arm.
function flatTangentWorldPorts(mountFace) {
    const arms = [
        worldOffset(mountFace, "local_n"),
        worldOffset(mountFace, "local_e"),
        worldOffset(mountFace, "local_s"),
        worldOffset(mountFace, "local_w")
    ];
    return new Set(arms.map(worldName));
}

// The world ports a cable currently exposes: one world_* port per set connection
// bit, in north, east, south, west order.
function cableWorldPorts(mountFace, connections) {
    const ports = new Set();
    const arms = ["local_n", "local_e", "local_s", "local_w"];
    for (let i = 0; i < arms.length; i++) {
        if (connections & ARM_BITS[arms[i]]) {
            ports.add(worldName(worldOffset(mountFace, arms[i])));
        }
    }
    return ports;
}

function makeLane(id, ports, sourceOn, powered) {
    return { id, ports: new Set(ports), sourceOn, powered };
}

// A cable exposes its current world-space tangent ports as one joined main lane.
export function cableDescriptor({ mountFace, connections = 0, powered = false }) {
    return {
        kind: KIND_CABLE,
        mountFace,
        lanes: [makeLane(LANE_MAIN, cableWorldPorts(mountFace, connections), false, powered)]
    };
}

export function innerCornerDescriptor({facePair,powered=false}) {
    if (!facesOfPair(facePair)) return undefined;
    return {kind:KIND_INNER_CORNER,facePair,
        lanes:[makeLane(LANE_MAIN,innerRoutes(facePair).map(route=>worldName(route.direction)),false,powered)]};
}

// A full-cube source (the generator) occupies its whole block, so it has no
// mounting face and a cable can touch any of its six faces from an adjacent block
// or mount directly against one of them. It exposes one joined source lane with
// a world-space contact on every world face.
export function generatorDescriptor({ sourceOn = true } = {}) {
    return {
        kind: KIND_SOURCE,
        mountFace: undefined,
        lanes: [makeLane(LANE_MAIN, [WORLD_UP, WORLD_DOWN, WORLD_NORTH, WORLD_SOUTH, WORLD_EAST, WORLD_WEST], sourceOn, sourceOn)]
    };
}

// A flat consumer (lamp, both adapters) exposes four joined tangent world ports
// on its mounting face. sourceOn marks a source.
export function flatDescriptor({ mountFace, powered = false, sourceOn = false }) {
    return {
        kind: sourceOn ? KIND_SOURCE : KIND_CONSUMER,
        mountFace,
        lanes: [makeLane(LANE_MAIN, flatTangentWorldPorts(mountFace), sourceOn, powered)]
    };
}

// A bridge exposes two isolated lanes. ns carries local_n/local_s; ew carries
// local_e/local_w. The lanes never share a port and there is never an edge
// between them.
export function bridgeDescriptor({ mountFace, poweredNs = false, poweredEw = false }) {
    return {
        kind: KIND_BRIDGE,
        mountFace,
        lanes: [
            makeLane(LANE_NS, ["local_n", "local_s"], false, poweredNs),
            makeLane(LANE_EW, ["local_e", "local_w"], false, poweredEw)
        ]
    };
}

// A full-block conduit joins two opposite world ports along its axis as one main
// lane.
export function conduitDescriptor({ axis = AXIS_Z, powered = false }) {
    const ports = axis === AXIS_X
        ? [WORLD_EAST, WORLD_WEST]
        : axis === AXIS_Y
            ? [WORLD_UP, WORLD_DOWN]
            : [WORLD_NORTH, WORLD_SOUTH];
    return {
        kind: KIND_CONDUIT,
        mountFace: undefined,
        lanes: [makeLane(LANE_MAIN, ports, false, powered)]
    };
}

// Add the back-contact port to a surface element's single main lane, when its
// support is a matching conduit or a full generator.
export function addBackContact(descriptor) {
    if (!descriptor || descriptor.lanes.length === 0) {
        return descriptor;
    }
    descriptor.lanes[0].ports.add(BACK_PORT);
    return descriptor;
}

// True when a conduit whose axis is the given value matches a surface element
// mounted on the given face. The support normal must align with a conduit end.
export function matchingConduitAxis(mountFace, axis) {
    return AXIS_FOR_FACE[mountFace] === axis;
}

// The support block behind a surface element: the neighbour reached by its mount
// face's inverse normal. Returns undefined when there is no mount face, no
// readable block, or the block is invalid. Only the runtime reader needs the
// Block; the position is resolved from plain property access so this file stays
// free of Minecraft imports.
function supportBlock(block, mountFace) {
    if (!mountFace) {
        return undefined;
    }
    const off = supportOffset(mountFace);
    try {
        const location = {
            x: Math.floor(block.location.x) + off[0],
            y: Math.floor(block.location.y) + off[1],
            z: Math.floor(block.location.z) + off[2]
        };
        if (block.dimension.isChunkLoaded?.(location) === false) return undefined;
        return block.dimension.getBlock(location);
    } catch {
        return undefined;
    }
}

// The conduit axis a surface element sits on, read from its support block, or
// undefined when the support is absent, not a conduit, or unreadable.
function supportAxis(block, mountFace) {
    const support = supportBlock(block, mountFace);
    if (!support || !support.isValid) {
        return undefined;
    }
    try {
        return support.permutation.getState(STATE_AXIS);
    } catch {
        return undefined;
    }
}

// True when a full-cube generator backs the element. Unlike a conduit, which
// only matches its own axis, every one of a generator's six faces is a valid
// back-contact, so a surface cable mounted directly on any face connects.
function supportIsGenerator(block, mountFace) {
    const support = supportBlock(block, mountFace);
    try {
        return Boolean(support) && support.isValid && support.type && support.type.id === GENERATOR_ID;
    } catch {
        return false;
    }
}

// Apply a back-contact port when the support is a matching conduit or a full
// generator, otherwise return the descriptor unchanged.
function withBackContact(descriptor, block, mountFace) {
    const axis = supportAxis(block, mountFace);
    if (axis !== undefined && matchingConduitAxis(mountFace, axis)) {
        return addBackContact(descriptor);
    }
    if (supportIsGenerator(block, mountFace)) {
        return addBackContact(descriptor);
    }
    return descriptor;
}

// Build the descriptor for a Block. Returns undefined for unrelated blocks and
// never embeds the Block in the returned data. A surface element whose support
// is a matching conduit gains a back-contact port.
export function descriptorForBlock(block) {
    if (!block || !block.isValid) {
        return undefined;
    }
    const kind = KIND_BY_ID[block.type.id];
    if (!kind) {
        return undefined;
    }
    let state;
    try {
        state = block.permutation;
    } catch {
        return undefined;
    }

    const mountFace = state.getState(STATE_BLOCK_FACE);
    const powered = Boolean(state.getState(STATE_POWERED));

    switch (kind) {
        case KIND_CABLE:
            return withBackContact(cableDescriptor({
                mountFace,
                connections: state.getState(STATE_CONNECTIONS) || 0,
                powered
            }), block, mountFace);

        case KIND_INNER_CORNER:
            return innerCornerDescriptor({facePair:pairFromPermutation(state),powered});

        case KIND_SOURCE:
            let generatorOn = true;
            try {
                generatorOn = Boolean(state.getState(STATE_ENABLED));
            } catch {
                generatorOn = true;
            }
            return generatorDescriptor({ sourceOn: generatorOn });

        case KIND_ADAPTER_IN:
        case KIND_ADAPTER_OUT: {
            const descriptor = withBackContact(flatDescriptor({
                mountFace, powered, sourceOn: kind === KIND_ADAPTER_IN && powered
            }), block, mountFace);
            descriptor.kind = kind;
            return descriptor;
        }

        case KIND_CONSUMER:
            return withBackContact(flatDescriptor({
                mountFace,
                powered,
                sourceOn: false
            }), block, mountFace);

        case KIND_BRIDGE:
            return bridgeDescriptor({
                mountFace,
                poweredNs: Boolean(state.getState(STATE_POWERED_NS)),
                poweredEw: Boolean(state.getState(STATE_POWERED_EW))
            });

        case KIND_CONDUIT:
            return conduitDescriptor({
                axis: state.getState(STATE_AXIS) || AXIS_Z,
                powered
            });

        default:
            return undefined;
    }
}

// --- Bridge graph-neighbor helpers (plan sections 5.1/2.7) ---
//
// A bridge holds two isolated lanes in one block position. The north-south lane
// (ns) carries local_n and local_s; the east-west lane (ew) carries local_e and
// local_w. The lanes never share a port and there is never an edge between them.
export const BRIDGE_ARMS = ["local_n", "local_e", "local_s", "local_w"];

export const LANE_PORTS = {
    [LANE_NS]: new Set(["local_n", "local_s"]),
    [LANE_EW]: new Set(["local_e", "local_w"])
};

export function bridgeNodeRefs(blockKey) {
    return [`${blockKey}#${LANE_NS}`, `${blockKey}#${LANE_EW}`];
}

export function bridgeLaneAt(face, arm) {
    if (arm !== "local_e" && arm !== "local_w") {
        return LANE_NS;
    }
    return LANE_EW;
}

export function laneHasPort(lane, arm) {
    const ports = LANE_PORTS[lane];
    return ports ? ports.has(arm) : false;
}

export function buildBridgeEdges(blockKey, face, neighbors) {
    const edges = [];
    for (const arm of BRIDGE_ARMS) {
        const neighbor = neighbors[arm];
        if (!neighbor) {
            continue;
        }
        const lane = bridgeLaneAt(face, arm);
        edges.push([`${neighbor.key}#${LANE_MAIN}`, `${blockKey}#${lane}`]);
    }
    return edges;
}

export default {
    BRIDGE_ID,
    LANE_MAIN,
    LANE_NS,
    LANE_EW,
    BRIDGE_ARMS,
    LANE_PORTS,
    bridgeNodeRefs,
    bridgeLaneAt,
    laneHasPort,
    buildBridgeEdges,
    cableDescriptor,
    innerCornerDescriptor,
    generatorDescriptor,
    flatDescriptor,
    bridgeDescriptor,
    conduitDescriptor,
    addBackContact,
    matchingConduitAxis,
    descriptorForBlock
};
