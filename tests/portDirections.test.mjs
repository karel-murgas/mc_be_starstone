// Port-direction back-contact tests for Task 3.5A.
//
// Prove the repaired graph direction logic: a surface element's "back" port
// resolves to supportOffset(mountFace), never to worldOffset, and absolute
// world_* ports still resolve without a mount face so the full-cube generator's
// six absolute contacts work. Reciprocal directions are checked for three
// cases: (1) a cable mounted directly on every generator face, (2) a cable arm
// in an adjacent block touching every generator face, and (3) a surface cable
// backed by a matching conduit. Absolute generator ports must stay one joined
// source lane.
//
// Run: node tests/portDirections.test.mjs
// Exits nonzero on the first failed assertion.

import { worldDirOfPort, WORLD_PORTS } from "../starstone_bp/scripts/portDirections.js";
import {
    generatorDescriptor,
    conduitDescriptor,
    cableDescriptor,
    addBackContact
} from "../starstone_bp/scripts/electricalBlocks.js";
import { supportOffset, worldOffset, NORMALS } from "../starstone_bp/scripts/surfaceFrame.js";
import {
    FACE_LIST,
    ARM_NAMES,
    ARM_BITS,
    AXIS_X,
    AXIS_Y,
    AXIS_Z,
    AXIS_FOR_FACE
} from "../starstone_bp/scripts/constants.js";

let failures = 0;

function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}

function eq(a, b, label) {
    check(label || `${a} == ${b}`, a === b);
}

function vecEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function negate(v) {
    return [-v[0], -v[1], -v[2]];
}

// Mirror networkGraph.findReciprocalLane: the lane of this descriptor that
// exposes a port pointing along targetDir, or undefined when none does.
function reciprocalLane(descriptor, targetDir) {
    for (const lane of descriptor.lanes) {
        for (const port of lane.ports) {
            const dir = worldDirOfPort(descriptor.mountFace, port);
            if (dir && vecEquals(dir, targetDir)) {
                return lane.id;
            }
        }
    }
    return undefined;
}

// The absolute world_* port name whose vector equals v.
function worldNameForVec(v) {
    for (const [port, vec] of Object.entries(WORLD_PORTS)) {
        if (vecEquals(vec, v)) {
            return port;
        }
    }
    throw new Error(`no world port for ${v}`);
}

// A conduit axis and one mount face whose support normal lies on that axis.
const CONDUIT_AXIS_FOR_FACE = {
    [AXIS_X]: "east",
    [AXIS_Y]: "up",
    [AXIS_Z]: "north"
};

console.log("portDirections: the generator keeps one joined source lane on six absolute contacts");
const generator = generatorDescriptor();
eq(generator.lanes.length, 1, "the generator has exactly one lane");
eq(generator.mountFace, undefined, "the full-cube generator has no mount face");
check(
    "every generator contact is an absolute world_* port",
    generator.lanes[0].ports.size === 6 && [...generator.lanes[0].ports].every((p) => p.startsWith("world_"))
);
for (const [port, vec] of Object.entries(WORLD_PORTS)) {
    check(`worldDirOfPort resolves ${port} without a mount face`, vecEquals(worldDirOfPort(undefined, port), vec));
}

console.log("portDirections: back resolves to supportOffset, never to worldOffset");
eq(worldDirOfPort("up", "back"), supportOffset("up"), "back resolves to supportOffset(up)");
let worldOffsetThrows = false;
try {
    worldOffset("up", "back");
} catch {
    worldOffsetThrows = true;
}
check("worldOffset rejects 'back', so a non-throwing back resolution proves it did not go there", worldOffsetThrows && worldDirOfPort("up", "back") !== undefined);
eq(worldDirOfPort(undefined, "back"), undefined, "a mount-face-less source has no back direction");
eq(worldDirOfPort("up", "local_n"), worldOffset("up", "local_n"), "local arms still resolve through worldOffset");

console.log("graph direction: a cable mounted directly on every generator face");
for (const face of FACE_LIST) {
    const backed = addBackContact(cableDescriptor({ mountFace: face, connections: 0 }));
    check(`${face}: the backed cable carries a back contact`, backed.lanes[0].ports.has("back"));
    const towardGen = worldDirOfPort(face, "back");
    check(`${face}: the cable's back points to the supporting generator`, vecEquals(towardGen, supportOffset(face)));
    eq(reciprocalLane(generator, negate(towardGen)), "main", `${face}: generator reciprocates the cable's back on main`);
    const genPort = worldNameForVec(NORMALS[face]);
    eq(reciprocalLane(backed, negate(worldDirOfPort(undefined, genPort))), "main", `${face}: cable reciprocates the generator on main`);
}

console.log("graph direction: a cable arm in an adjacent block touching every generator face");
for (const face of FACE_LIST) {
    const inward = negate(NORMALS[face]);
    let side = null;
    for (const m of FACE_LIST) {
        for (const arm of ARM_NAMES) {
            if (vecEquals(worldOffset(m, arm), inward)) {
                side = { mountFace: m, arm };
                break;
            }
        }
        if (side) break;
    }
    check(`${face}: a tangent arm reaches back into the generator ${face} face`, side !== null);
    if (side) {
        const touching = cableDescriptor({ mountFace: side.mountFace, connections: ARM_BITS[side.arm] });
        const towardGen = worldOffset(side.mountFace, side.arm);
        eq(reciprocalLane(generator, negate(towardGen)), "main", `${face}: generator reciprocates the touching arm on main`);
        const genPort = worldNameForVec(NORMALS[face]);
        eq(reciprocalLane(touching, negate(worldDirOfPort(undefined, genPort))), "main", `${face}: touching arm reciprocates the generator on main`);
    }
}

console.log("graph direction: a surface cable backed by a matching conduit");
for (const [axis, face] of Object.entries(CONDUIT_AXIS_FOR_FACE)) {
    const conduit = conduitDescriptor({ axis });
    check(`axis ${axis}: the mount face ${face} lies on the conduit axis`, AXIS_FOR_FACE[face] === axis);
    const backed = addBackContact(cableDescriptor({ mountFace: face, connections: 0 }));
    check(`${axis}: the backed cable carries a back contact`, backed.lanes[0].ports.has("back"));
    const towardConduit = worldDirOfPort(face, "back");
    check(`${axis}: the cable's back points to the supporting conduit`, vecEquals(towardConduit, supportOffset(face)));
    eq(reciprocalLane(conduit, negate(towardConduit)), "main", `${axis}: conduit reciprocates the cable's back on main`);
    const conduitPort = worldNameForVec(NORMALS[face]);
    eq(reciprocalLane(backed, negate(worldDirOfPort(undefined, conduitPort))), "main", `${axis}: cable reciprocates the conduit on main`);
}

if (failures > 0) {
    console.error(`\nportDirections: ${failures} failure(s).`);
    process.exit(1);
}

console.log("portDirections: all checks passed");
