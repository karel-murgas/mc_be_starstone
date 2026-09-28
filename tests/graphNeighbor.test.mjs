// Graph neighbor rule tests for Task 2.7.
//
// Prove bridge lane isolation: a single bridge contributes two isolated node
// references, a neighboring cable joins only its matching lane, and two
// generators feeding perpendicular lines through the bridge can independently
// drive off/off, on/off, off/on, and on/on at two distant lamps.
//
// Run: node tests/graphNeighbor.test.mjs
// Exits nonzero on the first failed assertion.

import {
    bridgeNodeRefs,
    bridgeLaneAt,
    buildBridgeEdges,
    laneHasPort,
    LANE_NS,
    LANE_EW,
    LANE_MAIN
} from "../starstone_bp/scripts/electricalBlocks.js";

let failures = 0;

function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}

function eq(a, b, label) {
    check(label || `${a} == ${b}`, a === b);
}

// An undirected line graph of #main cable nodes with a lamp or generator at one
// end and the bridge lane node at the other. Edges are stored both directions so
// power reaches either end.
class Line {
    constructor() {
        this.edges = new Set();
        this.adj = new Map();
    }

    add(a, b) {
        const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        if (this.edges.has(key)) return;
        this.edges.add(key);
        if (!this.adj.has(a)) this.adj.set(a, []);
        if (!this.adj.has(b)) this.adj.set(b, []);
        this.adj.get(a).push(b);
        this.adj.get(b).push(a);
    }

    reachable(from) {
        const seen = new Set([from]);
        const stack = [from];
        while (stack.length > 0) {
            const node = stack.pop();
            for (const next of (this.adj.get(node) || [])) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        return seen;
    }
}

const BRIDGE = "bridge";
const FACE = "up";

// Neighbor descriptors around the bridge, one per local arm, each carrying its
// own block key so buildBridgeEdges can target the correct #main node.
function bridgeNeighbors() {
    return {
        local_n: { key: "cable_n" },
        local_e: { key: "cable_e" },
        local_s: { key: "cable_s" },
        local_w: { key: "cable_w" }
    };
}

console.log("electricalBlocks: two node refs per bridge");
const refs = bridgeNodeRefs(BRIDGE);
eq(refs.length, 2, "a bridge yields exactly two node references");
eq(refs[0], `${BRIDGE}#${LANE_NS}`, "first reference is the ns lane");
eq(refs[1], `${BRIDGE}#${LANE_EW}`, "second reference is the ew lane");
check("no reference is unsuffixed", refs.every((r) => r.includes("#")));
check("the two references differ", refs[0] !== refs[1]);

console.log("electricalBlocks: a neighbor joins only its matching lane");
eq(bridgeLaneAt(FACE, "local_n"), LANE_NS, "north arm contacts the ns lane");
eq(bridgeLaneAt(FACE, "local_s"), LANE_NS, "south arm contacts the ns lane");
eq(bridgeLaneAt(FACE, "local_e"), LANE_EW, "east arm contacts the ew lane");
eq(bridgeLaneAt(FACE, "local_w"), LANE_EW, "west arm contacts the ew lane");
check("ns lane carries the north and south ports", laneHasPort(LANE_NS, "local_n") && laneHasPort(LANE_NS, "local_s"));
check("ew lane carries the east and west ports", laneHasPort(LANE_EW, "local_e") && laneHasPort(LANE_EW, "local_w"));

const bridgeEdges = buildBridgeEdges(BRIDGE, FACE, bridgeNeighbors());
const nsEdgeTargets = bridgeEdges.filter(([, to]) => to === `${BRIDGE}#${LANE_NS}`).length;
const ewEdgeTargets = bridgeEdges.filter(([, to]) => to === `${BRIDGE}#${LANE_EW}`).length;
eq(nsEdgeTargets, 2, "both north and south neighbors target the ns lane");
eq(ewEdgeTargets, 2, "both east and west neighbors target the ew lane");
check(
    "there is never an edge between the ns and ew lanes",
    bridgeEdges.every(([from, to]) => !(from === `${BRIDGE}#${LANE_NS}` && to === `${BRIDGE}#${LANE_EW}`) && !(from === `${BRIDGE}#${LANE_EW}` && to === `${BRIDGE}#${LANE_NS}`))
);

console.log("bridge: two perpendicular lines stay isolated in all power states");
const graph = new Line();
// North-south line feeds lamp_s through the ns lane.
graph.add("gen_n#main", "cable_n#main");
graph.add("cable_s#main", "lamp_s#main");
// East-west line feeds lamp_w through the ew lane.
graph.add("gen_e#main", "cable_e#main");
graph.add("cable_w#main", "lamp_w#main");
// The bridge joins each cable to the lane that matches its arm.
for (const [from, to] of bridgeEdges) {
    graph.add(from, to);
}

const states = [];
for (const genN of [false, true]) {
    for (const genE of [false, true]) {
        const sources = [];
        if (genN) sources.push("gen_n#main");
        if (genE) sources.push("gen_e#main");
        const seen = new Set();
        for (const s of sources) for (const node of graph.reachable(s, sources)) seen.add(node);
        const lampS = seen.has("lamp_s#main");
        const lampW = seen.has("lamp_w#main");
        states.push({ genN, genE, lampS, lampW });
    }
}

const key = (s) => `${s.genN ? 1 : 0},${s.genE ? 1 : 0}->${s.lampS ? 1 : 0},${s.lampW ? 1 : 0}`;
const covered = new Set(states.map(key));
check("off/off at both lamps", covered.has("0,0->0,0"));
check("on/off: ns generator powers only lamp_s", covered.has("1,0->1,0"));
check("on/off: ew generator powers only lamp_w", covered.has("0,1->0,1"));
check("on/on: both generators power their own lamp", covered.has("1,1->1,1"));

const genNOnlyReachLampW = states.filter((s) => s.genN && !s.genE).some((s) => s.lampW);
const genEOnlyReachLampS = states.filter((s) => !s.genN && s.genE).some((s) => s.lampS);
check("the ns generator never reaches the ew lamp", !genNOnlyReachLampW);
check("the ew generator never reaches the ns lamp", !genEOnlyReachLampS);

if (failures > 0) {
    console.error(`\nelectricalBlocks: ${failures} failure(s).`);
    process.exit(1);
}

console.log("electricalBlocks: all checks passed");
