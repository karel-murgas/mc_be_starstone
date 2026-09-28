// Demonstrate that the acceptance suite rejects a deliberately wrong edge.
// Only isolated copies in temp are changed; production files remain untouched.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder=resolve('temp',`starstone-edge-mutation-${Date.now()}`);
mkdirSync(folder,{recursive:true});
const source=resolve('starstone_bp/scripts');
for (const name of readdirSync(source).filter(name=>name.endsWith('.js'))) {
    let text=readFileSync(join(source,name),'utf8');
    if (name==='chunkIndex.js') {
        const rule='if (a.mountFace && b.mountFace && a.mountFace !== b.mountFace) return false;';
        assert.ok(text.includes(rule),'mounting rule must exist before mutation');
        text=text.replace(rule,'// Deliberately wrong: allow incompatible mounting faces.');
    }
    writeFileSync(join(folder,name),text);
}
let test=readFileSync('tests/segmentGraph.test.mjs','utf8');
test=test.replace("'./runtimeFixture.mjs'",JSON.stringify(pathToFileURL(resolve('tests/runtimeFixture.mjs')).href));
test=test.replaceAll('../starstone_bp/scripts/',pathToFileURL(folder+'/').href);
const file=join(folder,'mutated-test.mjs');
writeFileSync(file,test);
const result=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:30000});
assert.notEqual(result.status,0,'wrong mounting edge must fail acceptance');
assert.match(result.stderr,/AssertionError/,'failure must be a test assertion, not a loader or syntax error');
assert.match(result.stderr,/mount|plane|face/i,'failure must identify the deliberately broken edge rule');
console.log('PASS: isolated incompatible-face edge mutation was rejected by segmentGraph acceptance tests.');
