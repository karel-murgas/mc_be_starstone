// Descriptor contract tests for Task 3.3.
//
// Prove the plan section 5.4 descriptor contract: cables expose their current
// world-space tangent ports, flat sources and consumers expose four joined
// tangent ports, the bridge exposes two isolated lanes, a matching conduit
// support adds a back contact, and reciprocal ports agree. Runs with no
// Minecraft module, so descriptorForBlock is exercised only through plain
// stand-in objects that shape like a Block.
//
// Run: node tests/descriptor.test.mjs
// Exits nonzero on the first failed assertion.

import {
    cableDescriptor,
    generatorDescriptor,
    flatDescriptor,
    bridgeDescriptor,
    conduitDescriptor,
    addBackContact,
    matchingConduitAxis,
    descriptorForBlock
} from "../starstone_bp/scripts/electricalBlocks.js";
import { worldOffset, supportOffset, FACE_LIST, NORMALS, ARM_NAMES } from "../starstone_bp/scripts/surfaceFrame.js";
import { ARM_BITS } from "../starstone_bp/scripts/constants.js";

let failures = 0;
const failuresByCategory = new Map();

function check(name, condition) {
    if (condition) return;
    failures += 1;
    failuresByCategory.set(name, (failuresByCategory.get(name) || 0) + 1);
    console.error(`  FAIL: ${name}`);
}

function eq(a, b, label) {
    check(label || `${JSON.stringify(a)} == ${JSON.stringify(b)}`, a === b);
}

function has(descriptor, laneId, port) {
    for (const lane of descriptor.lanes) {
        if (lane.id === laneId) {
            return lane.ports.has(port);
        }
    }
    return false;
}

function portSet(descriptor, laneId) {
    for (const lane of descriptor.lanes) {
        if (lane.id === laneId) {
            return new Set(lane.ports);
        }
    }
    return undefined;
}

function worldNameForVec(vec) {
    const sign = [
        vec[0] > 0 ? "east" : vec[0] < 0 ? "west" : null,
        vec[1] > 0 ? "up" : vec[1] < 0 ? "down" : null,
        vec[2] > 0 ? "south" : vec[2] < 0 ? "north" : null
    ].find((n) => n !== null);
    return `world_${sign}`;
}

console.log("descriptor: cable exposes current world-space tangent ports");
for (const face of FACE_LIST) {
    // Every connection mask exposes exactly the world port of each set arm.
    for (let mask = 0; mask < 16; mask++) {
        const desc = cableDescriptor({ mountFace: face, connections: mask });
        eq(desc.kind, "cable", `cable kind on ${face}`);
        eq(desc.lanes.length, 1, `cable has one lane on ${face}`);
        const expected = new Set();
        if (mask & 1) expected.add(worldNameForVec(worldOffset(face, "local_n")));
        if (mask & 2) expected.add(worldNameForVec(worldOffset(face, "local_e")));
        if (mask & 4) expected.add(worldNameForVec(worldOffset(face, "local_s")));
        if (mask & 8) expected.add(worldNameForVec(worldOffset(face, "local_w")));
        const got = portSet(desc, "main");
        eq([...got].sort().join(","), [...expected].sort().join(","), `mask ${mask} on ${face} ports`);
    }
}
eq(portSet(cableDescriptor({ mountFace: "up", connections: 0 }), "main").size, 0, "isolated cable exposes no ports");
eq(
    [...portSet(cableDescriptor({ mountFace: "up", connections: 3 }), "main")].sort().join(","),
    "world_east,world_north",
    "north+east bits expose world_north and world_east"
);

console.log("descriptor: flat source and consumer expose four joined tangent ports");
for (const face of FACE_LIST) {
    const gen = flatDescriptor({ mountFace: face, sourceOn: true });
    const lamp = flatDescriptor({ mountFace: face });
    eq(gen.kind, "source", "generator kind is source");
    eq(lamp.kind, "consumer", "lamp kind is consumer");
    eq(gen.lanes[0].sourceOn, true, "source lane flags sourceOn");
    eq(lamp.lanes[0].sourceOn, false, "consumer lane flags no sourceOn");
    eq(portSet(gen, "main").size, 4, "flat source has four joined ports");
    eq(portSet(lamp, "main").size, 4, "flat consumer has four joined ports");
    for (const arm of ["local_n", "local_e", "local_s", "local_w"]) {
        check(`flat port covers ${arm} on ${face}`, portSet(gen, "main").has(worldNameForVec(worldOffset(face, arm))));
    }
}

console.log("descriptor: bridge exposes two isolated lanes");
const bridge = bridgeDescriptor({ mountFace: "up", poweredNs: true, poweredEw: false });
eq(bridge.kind, "bridge", "bridge kind");
eq(bridge.mountFace, "up", "bridge retains its mounting face for world-direction resolution");
eq(bridge.lanes.length, 2, "bridge has two lanes");
eq([...portSet(bridge, "ns")].sort().join(","), "local_n,local_s", "ns lane carries local_n/local_s");
eq([...portSet(bridge, "ew")].sort().join(","), "local_e,local_w", "ew lane carries local_e/local_w");
check("the two lanes share no port", [...portSet(bridge, "ns")].every((p) => !portSet(bridge, "ew").has(p)));
eq(bridge.lanes[0].powered, true, "ns lane carries its own powered flag");
eq(bridge.lanes[1].powered, false, "ew lane carries its own powered flag");

console.log("descriptor: conduit joins two opposite world ports along its axis");
eq([...portSet(conduitDescriptor({ axis: "z" }), "main")].sort().join(","), "world_north,world_south", "z axis runs north-south");
eq([...portSet(conduitDescriptor({ axis: "x" }), "main")].sort().join(","), "world_east,world_west", "x axis runs east-west");
eq([...portSet(conduitDescriptor({ axis: "y" }), "main")].sort().join(","), "world_down,world_up", "y axis runs up-down");

console.log("descriptor: matching conduit support adds a back contact");
check("up face matches a y conduit", matchingConduitAxis("up", "y") === true);
check("up face rejects an x conduit", matchingConduitAxis("up", "x") === false);
check("north face matches a z conduit", matchingConduitAxis("north", "z") === true);
check("east face matches an x conduit", matchingConduitAxis("east", "x") === true);
const backed = addBackContact(cableDescriptor({ mountFace: "up", connections: 1 }));
check("addBackContact adds the back port", backed.lanes[0].ports.has("back"));
eq(backed.lanes[0].ports.size, 2, "back contact is added alongside the tangent port");

console.log("descriptor: reciprocal world-space ports agree across opposite arms");
const OPPOSITE = { local_n: "local_s", local_s: "local_n", local_e: "local_w", local_w: "local_e" };
function isInverse(a, b) {
    return a[0] === -b[0] && a[1] === -b[1] && a[2] === -b[2];
}
for (const face of FACE_LIST) {
    for (const arm of ["local_n", "local_e", "local_s", "local_w"]) {
        const forward = worldOffset(face, arm);
        const oppositeArm = OPPOSITE[arm];
        const backward = worldOffset(face, oppositeArm);
        check(`arm ${arm} is the inverse of ${oppositeArm} on ${face}`, isInverse(forward, backward));
        // A cable exposing `arm` and a coplanar neighbor on that arm exposing its
        // opposite (reciprocal) port point at each other in world space.
        const ours = worldNameForVec(forward);
        const theirs = worldNameForVec(backward);
        check(`our ${arm} port ${ours} is the inverse of neighbor's ${oppositeArm} port ${theirs}`, ours !== theirs);
    }
}

console.log("descriptor: descriptorForBlock returns undefined for unrelated blocks");
eq(descriptorForBlock(undefined), undefined, "invalid block yields no descriptor");
eq(descriptorForBlock({ isValid: false }), undefined, "an invalid block yields no descriptor");
eq(descriptorForBlock({ type: { id: "minecraft:stone" }, isValid: true, permutation: { getState: () => undefined } }), undefined, "a non-starstone block yields no descriptor");

console.log("descriptor: descriptorForBlock never embeds the Block object");
const standIn = {
    isValid: true,
    type: { id: "starstone:cable" },
    location: { x: 1, y: 2, z: 3 },
    dimension: { getBlock: () => undefined },
    permutation: {
        getState: (name) => ({
            "minecraft:block_face": "up",
            "starstone:connections": 3,
            "starstone:powered": true
        }[name])
    }
};
const desc = descriptorForBlock(standIn);
check("descriptor has no block reference", desc.block === undefined && desc.lanes.every((lane) => !lane.block));
check("cable descriptor exposes the tangent ports for connections 3", portSet(desc, "main").has(worldNameForVec(worldOffset("up", "local_n"))) && portSet(desc, "main").has(worldNameForVec(worldOffset("up", "local_e"))));

console.log("descriptor: a matching conduit support adds the back contact");
const withConduit = {
    isValid: true,
    type: { id: "starstone:lamp" },
    location: { x: 1, y: 2, z: 3 },
    dimension: {
        getBlock: () => ({
            isValid: true,
            permutation: { getState: (name) => ("starstone:axis" === name ? "y" : undefined) }
        })
    },
    permutation: {
        getState: (name) => ({
            "minecraft:block_face": "up",
            "starstone:powered": true
        }[name])
    }
};
const lampDesc = descriptorForBlock(withConduit);
check("a flat device on a matching y conduit support gains the back port", lampDesc.lanes[0].ports.has("back"));

const withoutConduit = {
    isValid: true,
    type: { id: "starstone:lamp" },
    location: { x: 1, y: 2, z: 3 },
    dimension: {
        getBlock: () => ({
            isValid: true,
            permutation: { getState: (name) => ("starstone:axis" === name ? "x" : undefined) }
        })
    },
    permutation: {
        getState: (name) => ({
            "minecraft:block_face": "up",
            "starstone:powered": true
        }[name])
    }
};
const lampNoConduit = descriptorForBlock(withoutConduit);
check("a flat device on a non-matching conduit support has no back port", !lampNoConduit.lanes[0].ports.has("back"));

// Resolve a descriptor port to its world vector, mirroring the network graph's
// intended contract: an absolute world_* port, the back contact along the
// support offset, or a tangent arm of the mounting face.
function worldDirOfPort(mountFace, port) {
    const absolute = {
        world_up: [0, 1, 0],
        world_down: [0, -1, 0],
        world_north: [0, 0, -1],
        world_south: [0, 0, 1],
        world_east: [1, 0, 0],
        world_west: [-1, 0, 0]
    };
    if (port in absolute) {
        return absolute[port];
    }
    if (mountFace && port === "back") {
        return supportOffset(mountFace);
    }
    if (mountFace) {
        return worldOffset(mountFace, port);
    }
    return undefined;
}

function vecEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Whether a neighbour descriptor exposes a port pointing along target, the world
// direction from the generator back to that neighbour.
function neighborHasPortDir(descriptor, mountFace, target) {
    for (const lane of descriptor.lanes) {
        for (const port of lane.ports) {
            const dir = worldDirOfPort(mountFace, port);
            if (dir && vecEquals(dir, target)) {
                return true;
            }
        }
    }
    return false;
}

console.log("descriptor: the generator exposes one joined source lane on all six world faces");
const gen = generatorDescriptor();
eq(gen.kind, "source", "the generator kind is source");
eq(gen.lanes.length, 1, "the generator has exactly one lane");
eq(gen.mountFace, undefined, "the full-cube generator has no mounting face");
eq(gen.lanes[0].sourceOn, true, "the generator lane is a source");
eq(portSet(gen, "main").size, 6, "the generator exposes six world ports in a single lane");
for (const face of FACE_LIST) {
    check(`the generator carries the world contact of ${face}`, portSet(gen, "main").has(worldNameForVec(NORMALS[face])));
}
check("every generator contact lives in the one source lane", portSet(gen, "main").size === 6 && [...portSet(gen, "main")].every((p) => p.startsWith("world_")));

console.log("descriptor: descriptorForBlock reports the enabled generator as a six-contact source");
const genStandIn = {
    isValid: true,
    type: { id: "starstone:generator" },
    location: { x: 0, y: 0, z: 0 },
    dimension: { getBlock: () => undefined },
    permutation: { getState: (name) => ("starstone:enabled" === name ? true : undefined) }
};
const genBlockDesc = descriptorForBlock(genStandIn);
eq(genBlockDesc.kind, "source", "the generator block descriptor is a source");
eq(genBlockDesc.lanes.length, 1, "the generator block descriptor has one lane");
eq(genBlockDesc.lanes[0].sourceOn, true, "an enabled generator flags its source lane");
eq(portSet(genBlockDesc, "main").size, 6, "the generator block descriptor contacts all six faces");

console.log("descriptor: a cable backed by a generator support gains a reciprocal back contact");
const genBlock = {
    isValid: true,
    type: { id: "starstone:generator" },
    location: { x: 0, y: 0, z: 0 },
    dimension: { getBlock: () => genBlock },
    permutation: { getState: () => undefined }
};
const backedCableStandIn = {
    isValid: true,
    type: { id: "starstone:cable" },
    location: { x: 0, y: 0, z: 0 },
    dimension: { getBlock: () => genBlock },
    permutation: { getState: (name) => ("minecraft:block_face" === name ? "up" : undefined) }
};
const backedCableDesc = descriptorForBlock(backedCableStandIn);
check("a cable mounted on a generator support gains the back contact", backedCableDesc.lanes[0].ports.has("back"));

console.log("descriptor: a cable mounted on a generator face reciprocates on each of the six faces");
for (const face of FACE_LIST) {
    const outward = NORMALS[face];
    const inward = outward.map((v) => -v);
    check(`the generator points toward ${face} along its world port`, vecEquals(worldDirOfPort(undefined, worldNameForVec(outward)), outward));
    const backed = addBackContact(cableDescriptor({ mountFace: face, connections: 1 }));
    check(`a ${face}-mounted cable gains a back contact`, backed.lanes[0].ports.has("back"));
    check(`the ${face}-mounted cable's back contact points back at the generator`, neighborHasPortDir(backed, face, inward));
}

console.log("descriptor: a cable arm touching a generator face connects on each of the six faces");
for (const face of FACE_LIST) {
    const inward = NORMALS[face].map((v) => -v);
    let side = null;
    for (const m of FACE_LIST) {
        for (const arm of ARM_NAMES) {
            if (vecEquals(worldOffset(m, arm), inward)) {
                side = { mountFace: m, arm };
                break;
            }
        }
        if (side) {
            break;
        }
    }
    check(`a tangent arm reaches back into the ${face} face of the generator`, side !== null);
    if (side) {
        const touching = cableDescriptor({ mountFace: side.mountFace, connections: ARM_BITS[side.arm] });
        check(`the ${face}-touching cable arm reaches the generator`, neighborHasPortDir(touching, side.mountFace, inward));
    }
}

console.log("descriptor: the lamp stays a joined conducting consumer, not a leaf");
for (const face of FACE_LIST) {
    const lamp = flatDescriptor({ mountFace: face });
    eq(lamp.kind, "consumer", `the lamp kind is consumer on ${face}`);
    eq(lamp.lanes.length, 1, `the lamp has one joined lane on ${face}`);
    eq(lamp.lanes[0].sourceOn, false, `the lamp is not a source on ${face}`);
    eq(portSet(lamp, "main").size, 4, `the lamp has four joined tangent ports on ${face}`);
    const ports = [...portSet(lamp, "main")];
    check(`the lamp can receive on one tangent port and propagate through another on ${face}`, ports.length >= 2);
}

if (failures > 0) {
    console.error(`\ndescriptor: ${failures} failure(s) across ${failuresByCategory.size} check group(s).`);
    process.exit(1);
}

console.log("descriptor: all checks passed");
