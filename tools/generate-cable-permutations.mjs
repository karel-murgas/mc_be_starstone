// Generate the 16 connection-mask geometry visibility mappings for the cable.
//
// Task 2.4. The generated output is deterministic and clearly delimited. The
// sixteen mask -> visible-bone mappings are computed from the connection-bit
// rules below; nothing here hand-maintains a repetitive table.
//
// Run:  node mods/starstone/tools/generate-cable-permutations.mjs [--out <path>]
//       node mods/starstone/tools/generate-cable-permutations.mjs --selfcheck
//
// Default output is a reviewable snippet written to
// mods/starstone/generated/cable-permutations.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Connection bits are local to the cable surface (GRAPHICS.md, section 5.2).
// The order below is also the emission order of visible bones.
const ARM_BONES = ["arm_n", "arm_e", "arm_s", "arm_w"];
const ARM_BITS = { arm_n: 1, arm_e: 2, arm_s: 4, arm_w: 8 };
const CENTER_BONE = "center";

function bonesForMask(mask) {
    const visible = [CENTER_BONE];
    for (const bone of ARM_BONES) {
        if ((mask & ARM_BITS[bone]) !== 0) {
            visible.push(bone);
        }
    }
    return visible;
}

function buildMappings() {
    const mappings = [];
    for (let mask = 0; mask < 16; mask += 1) {
        const present = [];
        for (const bone of ARM_BONES) {
            if ((mask & ARM_BITS[bone]) !== 0) {
                present.push(bone);
            }
        }
        mappings.push({
            mask,
            connections: String(mask).padStart(4, "0"),
            visible: bonesForMask(mask),
            arms: present
        });
    }
    return mappings;
}

function renderSnippet(mappings) {
    const lines = [];
    lines.push("starstone:cable connection-mask visibility (generated, do not edit by hand)");
    lines.push("center is always visible; arm_<n|e|s|w> is connection bit 1|2|4|8");
    lines.push("");
    for (const m of mappings) {
        lines.push(
            `connections ${m.connections}: visible ${m.visible.join(", ")} ` +
            `(bits ${m.arms.length === 0 ? "none" : m.arms.map((a) => a.replace("arm_", "") + "=" + ARM_BITS[a]).join(", ")})`
        );
    }
    return lines.join("\n") + "\n";
}

function main() {
    const args = process.argv.slice(2);

    if (args.includes("--selfcheck")) {
        runSelfCheck();
        return;
    }

    let outPath = path.join(__dirname, "generated", "cable-permutations.json");
    const outIdx = args.indexOf("--out");
    if (outIdx !== -1) {
        outPath = path.resolve(args[outIdx + 1]);
    }

    const mappings = buildMappings();

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(mappings, null, 2) + "\n");

    process.stdout.write(renderSnippet(mappings));
    process.stdout.write(`\nWrote ${mappings.length} mappings to ${path.relative(process.cwd(), outPath)}\n`);
}

function runSelfCheck() {
    const mappings = buildMappings();
    let failures = 0;

    if (mappings.length !== 16) {
        console.error(`expected 16 mappings, got ${mappings.length}`);
        failures += 1;
    }

    for (const m of mappings) {
        const expected = bonesForMask(m.mask);
        const okCount = JSON.stringify(m.visible) === JSON.stringify(expected);
        const okArms = JSON.stringify(m.arms) === JSON.stringify(m.arms.filter((b) => (m.mask & ARM_BITS[b]) !== 0));
        const okCenter = m.visible[0] === CENTER_BONE;
        const okBits = m.arms.every((b) => (m.mask & ARM_BITS[b]) !== 0) && m.arms.length === (m.mask === 0 ? 0 : popcount(m.mask));
        if (!(okCount && okArms && okCenter && okBits)) {
            console.error(`mask ${m.mask}: visible=${JSON.stringify(m.visible)} arms=${JSON.stringify(m.arms)}`);
            failures += 1;
        }
    }

    if (failures > 0) {
        console.error(`selfcheck: ${failures} failure(s)`);
        process.exit(1);
    }
    console.log(`selfcheck: ${mappings.length} mappings OK; every mask shows center plus exactly its set bits`);
}

function popcount(n) {
    let c = 0;
    while (n) {
        c += n & 1;
        n >>= 1;
    }
    return c;
}

main();
