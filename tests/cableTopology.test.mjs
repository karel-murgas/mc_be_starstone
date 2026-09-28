// Cable neighbor rule tests for Task 2.1.
//
// Run: node tests/cableTopology.test.mjs
// Exits nonzero on the first failed assertion.

import {
    cableConnectionMask,
    hasReciprocalPort,
    ARM_BITS
} from "../starstone_bp/scripts/cableTopology.js";

let failures = 0;
const failuresByCategory = new Map();

function check(name, condition) {
    if (condition) return;
    failures += 1;
    failuresByCategory.set(name, (failuresByCategory.get(name) || 0) + 1);
    console.error(`  FAIL: ${name}`);
}

function eq(a, b, label) {
    check(label || `${a} == ${b}`, a === b);
}

// A coplanar cable neighbor on the same face exposes all four joined local ports.
function sameFaceCable(face) {
    return {
        kind: "cable",
        mountFace: face,
        lanes: [{ id: "main", ports: new Set(["local_n", "local_e", "local_s", "local_w"]) }]
    };
}

// A flat device (generator/lamp/adapter): one joined main lane, four tangent
// local ports. A restricted device may omit ports to model a one-directional
// contact.
function sameFaceDevice(face, ports = ["local_n", "local_e", "local_s", "local_w"]) {
    return {
        kind: "device",
        mountFace: face,
        lanes: [{ id: "main", ports: new Set(ports) }]
    };
}

// A bridge: ns lane carries the local n/s ports, ew lane carries the local
// e/w ports. The two lanes are independent.
function sameFaceBridge(face) {
    return {
        kind: "bridge",
        mountFace: face,
        lanes: [
            { id: "ns", ports: new Set(["local_n", "local_s"]) },
            { id: "ew", ports: new Set(["local_e", "local_w"]) }
        ]
    };
}

function conduitNeighbor() {
    return {
        kind: "conduit",
        mountFace: "up",
        lanes: [{ id: "main", ports: new Set(["world_up", "world_down"]) }]
    };
}

const FACE = "north";

console.log("cableTopology: isolated");
eq(cableConnectionMask(FACE, {}), 0, "isolated dot is mask 0");

console.log("cableTopology: endpoint");
eq(cableConnectionMask(FACE, { local_n: sameFaceCable(FACE) }), ARM_BITS.local_n, "one north neighbor is a single endpoint bit");

console.log("cableTopology: straight");
eq(cableConnectionMask(FACE, { local_n: sameFaceCable(FACE), local_s: sameFaceCable(FACE) }),
    ARM_BITS.local_n | ARM_BITS.local_s, "opposite neighbors form a straight");

console.log("cableTopology: L/elbow");
eq(cableConnectionMask(FACE, { local_n: sameFaceCable(FACE), local_e: sameFaceCable(FACE) }),
    ARM_BITS.local_n | ARM_BITS.local_e, "adjacent neighbors form an L");

console.log("cableTopology: T");
eq(cableConnectionMask(FACE, {
    local_n: sameFaceCable(FACE),
    local_e: sameFaceCable(FACE),
    local_s: sameFaceCable(FACE)
}), ARM_BITS.local_n | ARM_BITS.local_e | ARM_BITS.local_s, "three neighbors form a T");

console.log("cableTopology: joined four-way intersection");
eq(cableConnectionMask(FACE, {
    local_n: sameFaceCable(FACE),
    local_e: sameFaceCable(FACE),
    local_s: sameFaceCable(FACE),
    local_w: sameFaceCable(FACE)
}), 15, "four neighbors form the joined intersection");

console.log("cableTopology: bridge-lane contact");
eq(cableConnectionMask(FACE, { local_n: sameFaceBridge(FACE) }), ARM_BITS.local_n, "bridge north side contacts the ns lane");
eq(cableConnectionMask(FACE, { local_e: sameFaceBridge(FACE) }), ARM_BITS.local_e, "bridge east side contacts the ew lane");
eq(cableConnectionMask(FACE, { local_n: sameFaceBridge(FACE), local_w: sameFaceBridge(FACE) }),
    ARM_BITS.local_n | ARM_BITS.local_w, "bridge lanes are contacted independently on their own sides");

console.log("cableTopology: different-face rejection");
eq(cableConnectionMask(FACE, { local_n: sameFaceCable("east") }), 0, "a neighbor on a different mounting face connects nothing");

console.log("cableTopology: conduit is not a tangent mask bit");
eq(cableConnectionMask(FACE, { local_n: conduitNeighbor() }), 0, "a conduit neighbor sets no tangent bit");

console.log("cableTopology: reciprocal device port checks");
eq(cableConnectionMask(FACE, { local_s: sameFaceDevice(FACE) }), ARM_BITS.local_s, "a flat device with a joined port on the reciprocal side connects");
eq(cableConnectionMask(FACE, { local_n: sameFaceDevice(FACE, ["local_n"]) }), 0, "a device port pointing away from the neighbor is not reciprocal");
eq(
    hasReciprocalPort(FACE, conduitNeighbor(), [0, -1, 0]),
    false,
    "hasReciprocalPort rejects a conduit on the tangent surface"
);
eq(
    hasReciprocalPort(FACE, sameFaceCable("east"), [0, -1, 0]),
    false,
    "hasReciprocalPort rejects a different-face neighbor"
);

if (failures > 0) {
    console.error(`\ncableTopology: ${failures} failure(s) across ${failuresByCategory.size} check group(s).`);
    process.exit(1);
}

console.log("cableTopology: all checks passed");
