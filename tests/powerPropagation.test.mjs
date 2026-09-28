// powerPropagation tests for Task 4.3.
//
// Prove that power planning writes exactly one entry per changed cable/lamp/
// bridge lane, writes nothing when the state is unchanged, leaves unloaded
// nodes pending, and that the runtime pass spreads writes over ticks.
//
// The module imports "@minecraft/server", which Node cannot resolve, so a
// resolve hook redirects it to the permanent test shim before import.
//
// Run: node tests/powerPropagation.test.mjs
// Exits nonzero on the first failed assertion.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Redirect "@minecraft/server" to the local fake for the duration of this run.
register(
    "./minecraft-server-loader.mjs",
    new URL("./shims/", import.meta.url)
);

const mod = await import(
    "../starstone_bp/scripts/powerPropagation.js"
);
const { planPowerWrites, applyPower, poweredStateForLane, WRITE_BATCH } = mod;

let failures = 0;
function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}
function eq(a, b, label) {
    check(`${label || a} (${a}) == ${b}`, a === b);
}

const CABLE_ID = "starstone:cable";
const GENERATOR_ID = "starstone:generator";

const GEN = "overworld|0|0|0#main";
const CABLE_1 = "overworld|1|0|0#main";
const CABLE_2 = "overworld|2|0|0#main";
const LAMP = "overworld|3|0|0#main";
const BRIDGE_NS = "overworld|5|0|0#ns";
const BRIDGE_EW = "overworld|5|0|0#ew";
const CABLE_OFF = "overworld|4|0|0#main";

function net(nodes, powered) {
    return { nodes: new Set(nodes), powered };
}

console.log("poweredStateForLane: maps each lane to its block state");
eq(poweredStateForLane("ns"), "starstone:powered_ns", "ns lane -> powered_ns");
eq(poweredStateForLane("ew"), "starstone:powered_ew", "ew lane -> powered_ew");
eq(poweredStateForLane("main"), "starstone:powered", "main lane -> powered");

console.log("planPowerWrites: one write per changed cable/lamp, source skipped");
{
    const currentPowered = (ref) => {
        if (ref === GEN) return "none"; // source owns `enabled`, not `powered`
        if (ref === CABLE_1 || ref === CABLE_2 || ref === LAMP) {
            return { state: "starstone:powered", value: false };
        }
        return "none";
    };
    const { writes, unresolved } = planPowerWrites(
        net([GEN, CABLE_1, CABLE_2, LAMP], true),
        currentPowered
    );
    eq(writes.length, 3, "three changed nodes are written");
    eq(unresolved.length, 0, "nothing is left pending");
    check(
        writes.every((w) => w.state === "starstone:powered" && w.value === true),
        "each write targets the powered state with value true"
    );
    check(
        !writes.some((w) => w.ref === GEN),
        "the generator source is never written here"
    );
}

console.log("planPowerWrites: no state change writes nothing");
{
    const { writes } = planPowerWrites(
        net([CABLE_1, CABLE_2, LAMP], true),
        () => ({ state: "starstone:powered", value: true })
    );
    eq(writes.length, 0, "an already-powered network writes nothing");
}

console.log("planPowerWrites: bridge lanes update independently");
{
    const currentPowered = (ref) =>
        ref === BRIDGE_NS
            ? { state: "starstone:powered_ns", value: false }
            : { state: "starstone:powered_ew", value: false };
    const first = planPowerWrites(net([BRIDGE_NS, BRIDGE_EW], true), currentPowered);
    eq(first.writes.length, 2, "both lanes write on the transition");
    const states = first.writes.map((w) => w.state).sort();
    eq(states[0], "starstone:powered_ew", "the ew lane uses powered_ew");
    eq(states[1], "starstone:powered_ns", "the ns lane uses powered_ns");

    const after = planPowerWrites(
        net([BRIDGE_NS, BRIDGE_EW], true),
        () => ({ state: "starstone:powered", value: true })
    );
    eq(after.writes.length, 0, "toggling again with no change writes nothing");
}

console.log("planPowerWrites: unloaded node is left pending, not written");
{
    const currentPowered = (ref) =>
        ref === CABLE_OFF ? "unloaded" : { state: "starstone:powered", value: false };
    const { writes, unresolved } = planPowerWrites(
        net([CABLE_OFF, CABLE_1], true),
        currentPowered
    );
    eq(writes.length, 1, "only the loaded cable is written");
    eq(unresolved.length, 1, "the unloaded cable is left pending");
    eq(unresolved[0], CABLE_OFF, "the pending node is the unloaded one");
}

// --- Runtime pass: writes are applied once and spread over ticks -----------

let runCalls = [];
let invoke = true;
globalThis.__mcRun = (cb) => {
    runCalls.push(cb);
    if (invoke) cb();
};
globalThis.__mcRunJob = () => {};
globalThis.__mcRunInterval = () => {};

const applied = [];
function makeBlock(key) {
    const state = { "starstone:powered": false };
    return {
        isValid: true,
        type: { id: CABLE_ID },
        permutation: {
            getState: (name) => state[name],
            withState: (name, value) => {
                state[name] = value;
                return { __state: name, __value: value };
            }
        },
        setPermutation: (perm) => {
            applied.push({ key, state: perm.__state, value: perm.__value });
        }
    };
}

function makeDimension(keys) {
    const store = new Map();
    for (const key of keys) {
        store.set(key, makeBlock(key));
    }
    return {
        isChunkLoaded: () => true,
        getBlock: ({ x, y, z }) => store.get(`${x},${y},${z}`)
    };
}

console.log("applyPower: writes every loaded cable and lamp once");
{
    applied.length = 0;
    runCalls.length = 0;
    invoke = true;
    const dimension = makeDimension(["1,0,0", "2,0,0", "3,0,0"]);
    const result = applyPower(net([GEN, CABLE_1, CABLE_2, LAMP], true), dimension);
    eq(result.written, 3, "three writes scheduled");
    eq(applied.length, 3, "three permutation writes applied");
    eq(
        new Set(applied.map((a) => a.key)).size,
        3,
        "each block is written exactly once"
    );
    check(
        applied.every((a) => a.state === "starstone:powered" && a.value === true),
        "every applied write is powered=true"
    );

    console.log("applyPower: toggling again with no change writes nothing");
    const again = applyPower(net([GEN, CABLE_1, CABLE_2, LAMP], true), dimension);
    eq(again.written, 0, "a re-applied powered network writes nothing new");
    eq(applied.length, 3, "no new permutation writes were applied");
}

console.log("applyPower: writes are spread across ticks by batch");
{
    runCalls.length = 0;
    invoke = true;
    const keys = [];
    for (let i = 1; i <= 20; i++) keys.push(`${i},0,0`);
    const dimension = makeDimension(keys);
    const nodes = [];
    for (let i = 1; i <= 20; i++) nodes.push(`overworld|${i}|0|0#main`);
    const result = applyPower(net(nodes, true), dimension);
    eq(result.written, 20, "twenty writes are scheduled");
    eq(runCalls.length, 2, `the queue drains in two tick batches (<=${WRITE_BATCH} each)`);
}

if (failures > 0) {
    console.error(`\npowerPropagation: ${failures} failure(s).`);
    process.exit(1);
}
console.log("powerPropagation: all checks passed");
