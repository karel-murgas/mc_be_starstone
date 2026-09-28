import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Suites use paths relative to the mod root, so run each one from there,
// whatever directory this runner was started from.
const modRoot = fileURLToPath(new URL('..', import.meta.url));
let failures = 0, suites = 0;
for (const file of readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort()) {
    suites++;
    const result = spawnSync(process.execPath,[`tests/${file}`],{ cwd:modRoot, encoding:'utf8', timeout:30000 });
    if (result.status !== 0) {
        failures++;
        console.error(`FAIL ${file}\n${result.stdout}\n${result.stderr}\n${result.error?.message || ""}`);
    } else console.log(`PASS ${file}`);
}
console.log(`${suites-failures}/${suites} test suites passed`);
process.exitCode = failures ? 1 : 0;
