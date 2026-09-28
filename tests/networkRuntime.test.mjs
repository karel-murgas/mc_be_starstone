// Runtime network index tests for Task 4.1.
//
// Prove that pure tests can add/remove networks, that every NodeRef belongs to
// at most one runtime network, and that one bridge block can legally contribute
// two nodes to two different networks.
//
// Run: node tests/networkRuntime.test.mjs
// Exits nonzero on the first failed assertion.

import { createRuntime } from "../starstone_bp/scripts/networkRuntime.js";

let failures = 0;

function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}

function eq(a, b, label) {
    check(label || `${a} == ${b}`, a === b);
}

// A NodeRef is "<dim>|<x>|<y>|<z>#<lane>".
const CABLE_A = "overworld|0|0|0#main";
const CABLE_B = "overworld|1|0|0#main";
const LAMP_C = "overworld|2|0|0#main";

// A bridge at 5|0|0 contributes an ns node and an ew node.
const BRIDGE_NS = "overworld|5|0|0#ns";
const BRIDGE_EW = "overworld|5|0|0#ew";

function nodes(...refs) {
    return new Set(refs);
}

console.log("networkRuntime: add assigns ids and indexes nodes");
let rt = createRuntime();
const a = rt.addNetwork({ nodes: nodes(CABLE_A), sources: new Set([CABLE_A]) }, { assignId: false, id: 1 });
eq(a.id, 1, "an explicit id is preserved");
eq(a.powered, false, "a partial record defaults powered to false");
eq(rt.networkIdOf(CABLE_A), 1, "the node maps to its network");
eq(rt.networkCount(), 1, "one network is registered");
eq(rt.nodeCount(), 1, "one node is indexed");
const b = rt.addNetwork({ nodes: nodes(CABLE_B), consumers: new Set([CABLE_B]) });
eq(b.id, 2, "an omitted id is allocated");
eq(rt.networkIdOf(CABLE_B), 2, "the second node maps to the second network");
check(rt.networkIds().has(1) && rt.networkIds().has(2), "both ids are reported by networkIds");
check(rt.invariantHolds(), "every indexed node sits in its matching network");

console.log("networkRuntime: remove releases nodes");
check(rt.removeNetwork(1), "removeNetwork returns true for a live id");
eq(rt.networkIdOf(CABLE_A), undefined, "the removed node no longer maps anywhere");
eq(rt.networkCount(), 1, "only the second network remains");
check(rt.removeNetwork(999) === false, "removeNetwork returns false for a missing id");
// The freed node can now join a fresh network without tripping the invariant.
const c = rt.addNetwork({ nodes: nodes(CABLE_A) });
eq(rt.networkIdOf(CABLE_A), c.id, "a freed node joins a new network");

console.log("networkRuntime: a node belongs to at most one network");
rt = createRuntime();
rt.addNetwork({ nodes: nodes(CABLE_A) }, { assignId: false, id: 1 });
let threw = false;
try {
    // A second network that also claims CABLE_A must be rejected.
    rt.addNetwork({ nodes: nodes(CABLE_A, CABLE_B) }, { assignId: false, id: 2 });
} catch (err) {
    threw = true;
    console.log(`  (rejected: ${err.message})`);
}
check(threw, "adding a node already held by another network is rejected");
eq(rt.networkIdOf(CABLE_A), 1, "the node keeps its first owner");
eq(rt.networkIdOf(CABLE_B), undefined, "the rejected network indexed nothing");
check(rt.invariantHolds(), "the one-network-per-node invariant still holds");

console.log("networkRuntime: a bridge feeds two networks from one block");
rt = createRuntime();
// North-south line: a source cable through the bridge ns lane to a lamp.
const nsNet = rt.addNetwork({
    nodes: nodes(CABLE_A, BRIDGE_NS, LAMP_C),
    sources: new Set([CABLE_A])
}, { assignId: false, id: 1 });
nsNet.powered = true;
// East-west line: a consumer lamp through the bridge ew lane, a different network.
const ewNet = rt.addNetwork({
    nodes: nodes(BRIDGE_EW, CABLE_B),
    consumers: new Set([CABLE_B])
}, { assignId: false, id: 2 });
check(rt.networkIdOf(BRIDGE_NS) !== rt.networkIdOf(BRIDGE_EW), "the bridge's two lanes live in different networks");
eq(rt.networkIdOf(BRIDGE_NS), 1, "the ns lane is on the north-south network");
eq(rt.networkIdOf(BRIDGE_EW), 2, "the ew lane is on the east-west network");
check(
    rt.networkIdOf(CABLE_A) === 1 && rt.networkIdOf(CABLE_B) === 2,
    "each cable stays on its own network"
);
check(rt.invariantHolds(), "the bridge block contributes two nodes to two networks cleanly");

// Removing the north-south network must not disturb the east-west one.
check(rt.removeNetwork(1), "the ns network is removed");
eq(rt.networkIdOf(BRIDGE_NS), undefined, "the ns node is released");
eq(rt.networkIdOf(BRIDGE_EW), 2, "the ew node keeps its network");
eq(rt.networkIdOf(CABLE_B), 2, "the east-west cable keeps its network");
eq(rt.networkCount(), 1, "only the east-west network remains");

console.log("networkRuntime: register replaces overlapping cached networks");
rt = createRuntime();
rt.addNetwork({ nodes: nodes(CABLE_A, CABLE_B) }, { assignId: false, id: 1 });
rt.addNetwork({ nodes: nodes(LAMP_C) }, { assignId: false, id: 2 });
const merged = rt.registerNetwork({ nodes: nodes(CABLE_A, CABLE_B, LAMP_C), sources: new Set([CABLE_A]), powered: true });
eq(merged.id, 3, "the merged network gets the next allocated id");
eq(rt.networkCount(), 1, "the two overlapping networks are replaced by one");
check(rt.networkIdOf(CABLE_A) === 3 && rt.networkIdOf(CABLE_B) === 3 && rt.networkIdOf(LAMP_C) === 3, "every node now belongs to the merged network");
check(merged.powered, "powered is carried from the discovery");
check(rt.invariantHolds(), "the one-network-per-node invariant holds after the merge");

console.log("networkRuntime: register leaves unrelated networks untouched");
rt = createRuntime();
rt.addNetwork({ nodes: nodes(CABLE_A) }, { assignId: false, id: 1 });
rt.addNetwork({ nodes: nodes(LAMP_C) }, { assignId: false, id: 2 });
const nearby = rt.registerNetwork({ nodes: nodes(CABLE_B), sources: new Set([CABLE_B]), powered: false });
eq(nearby.id, 3, "a non-overlapping discovery is simply allocated");
eq(rt.networkCount(), 3, "the unrelated networks are left in place");
check(rt.networkIdOf(CABLE_A) === 1 && rt.networkIdOf(LAMP_C) === 2, "unrelated networks keep their ids and nodes");

if (failures > 0) {
    console.error(`\nnetworkRuntime: ${failures} failure(s).`);
    process.exit(1);
}

console.log("networkRuntime: all checks passed");
