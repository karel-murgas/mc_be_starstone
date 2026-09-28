// Task 4.4 merge-and-apply contract. Run with:
// node tests/networkMerge.test.mjs

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
    "./minecraft-server-loader.mjs",
    new URL("./shims/", import.meta.url)
);

const { createRuntime } = await import(
    "../starstone_bp/scripts/networkRuntime.js"
);
const { registerAndApplyNetwork } = await import(
    "../starstone_bp/scripts/networkController.js"
);

let failures = 0;
function check(name, condition) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL: ${name}`);
}

const A = "overworld|0|0|0#main";
const B = "overworld|1|0|0#main";
const JOIN = "overworld|2|0|0#main";
const UNRELATED = "overworld|50|0|0#main";

console.log("networkRuntime: separately created runtimes stay isolated");
{
    const first = createRuntime();
    const second = createRuntime();
    first.addNetwork({ nodes: new Set([A]) });
    check("first runtime retains its network", first.networkCount() === 1);
    check("second runtime remains empty", second.networkCount() === 0);
}

console.log("networkController: joining networks registers once and applies power");
{
    const runtime = createRuntime();
    runtime.addNetwork({ nodes: new Set([A]) });
    runtime.addNetwork({ nodes: new Set([B]) });
    const unrelated = runtime.addNetwork({ nodes: new Set([UNRELATED]) });

    const discovered = {
        nodes: new Set([A, JOIN, B]),
        sources: new Set([A]),
        consumers: new Set([B]),
        unresolvedBoundaries: new Set()
    };
    const dimension = { id: "overworld" };
    const applied = [];
    const merged = registerAndApplyNetwork(
        discovered,
        true,
        dimension,
        runtime,
        (network, targetDimension) => applied.push({ network, targetDimension })
    );

    check("two touched networks become one", runtime.networkCount() === 2);
    check("all joined nodes share the merged id",
        runtime.networkIdOf(A) === merged.id &&
        runtime.networkIdOf(B) === merged.id &&
        runtime.networkIdOf(JOIN) === merged.id);
    check("unrelated network keeps its id", runtime.networkIdOf(UNRELATED) === unrelated.id);
    check("merged component is powered", merged.powered === true);
    check("power is applied exactly once", applied.length === 1);
    check("the registered record is applied", applied[0]?.network === merged);
    check("the seed dimension is used", applied[0]?.targetDimension === dimension);
    check("runtime invariant holds", runtime.invariantHolds());
}

if (failures > 0) {
    console.error(`\nnetworkMerge: ${failures} failure(s).`);
    process.exit(1);
}
console.log("networkMerge: all checks passed");
