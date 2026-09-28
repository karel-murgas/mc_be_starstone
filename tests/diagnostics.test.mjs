import assert from 'node:assert/strict';
import { mc, fixture, player, drain, renderRawMessage } from './runtimeFixture.mjs';
import { readFileSync } from 'node:fs';
const diagnostics = await import('../starstone_bp/scripts/diagnostics.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const props = new Map();
mc.world.getDynamicProperty = key => props.get(key);
mc.world.setDynamicProperty = (key,value) => props.set(key,value);
mc.world.getDynamicPropertyIds = () => [...props.keys()];
let byteQueries=0;
mc.world.getDynamicPropertyTotalByteCount = () => { byteQueries++; return 1234; };
let handler, options;
mc.system.afterEvents = { scriptEventReceive: { subscribe(cb, filter) { handler = cb; options = filter; } } };
diagnostics.registerDiagnostics();
assert.deepEqual(options, { namespaces: ['starstone'] });
const { dim, put } = fixture();
const generator = put('starstone:generator',0,0,0);
const cable = put('starstone:cable',1,0,0);
const lamp = put('starstone:lamp',2,0,0);
put('minecraft:stone',1,-1,0); put('minecraft:stone',2,-1,0);
const user = player(dim, cable);
handler({ id: 'starstone:diagnose', sourceEntity: user });
assert.equal(user.messages.length,1);
assert.match(user.messages[0], /networks=0/);
assert.match(user.messages[0], /powerQueue=0 peak=0 planning=0/);
assert.match(user.messages[0], /inputSources=0 inputPolled=0/);
assert.match(user.messages[0], /addon world dynamic-property bytes=1234/);
assert.equal(byteQueries,1);
assert.ok(user.rawMessages[0].rawtext.every(part=>part.translate.startsWith('starstone.message.') && part.with.every(arg=>typeof arg==='string')));
assert.equal(cable.writes,0);
assert.equal(diagnostics.startRebuildNearby(user,{ radius:2, height:1 }),true);
assert.equal(diagnostics.startRebuildNearby(user),false);
await drain();
assert.equal(diagnostics.isRebuildRunning(),false);
assert.ok(user.rawMessages.filter(raw=>raw.translate).every(raw=>raw.translate.startsWith('starstone.message.')),'debug and rebuild messages use resource keys');
assert.throws(()=>renderRawMessage({translate:'starstone.message.missing',with:[]}),/Missing message translation/);
assert.throws(()=>renderRawMessage({translate:'starstone.message.rebuild.start',with:['8']}),/Translation argument count/);
assert.throws(()=>renderRawMessage({translate:'starstone.message.debug.on',with:['unused']}),/Translation argument count/);

// Explicit load probes are bounded and cannot accidentally load/read blocks.
const queries=[];
const probeDimension={
    id:'minecraft:overworld',
    isChunkLoaded(position) { queries.push(position); return false; },
    getBlock() { throw new Error('chunk probe must not read blocks'); }
};
const probe=player(probeDimension);
probe.location.y=42.75;
probe.getBlockFromViewDirection=()=>{ throw new Error('chunk probe must not raycast'); };
const bytesBefore=byteQueries;
handler({id:'starstone:diagnose',sourceEntity:probe,message:'chunk -2 3 70'});
assert.deepEqual(queries,[{x:-24,y:70,z:56}]);
assert.match(probe.messages.at(-1),/dimension=minecraft:overworld chunk=\(-2,3\) y=70 loaded=false/);
probeDimension.isChunkLoaded=position=>{queries.push(position); return true;};
diagnostics.diagnose(probe,'chunk 0 1');
assert.deepEqual(queries.at(-1),{x:8,y:42,z:24});
assert.match(probe.messages.at(-1),/loaded=true/);
probeDimension.isChunkLoaded=()=>{throw new Error('outside bounds');};
diagnostics.diagnose(probe,'chunk 0 1 -1000');
assert.match(probe.messages.at(-1),/load status unavailable/);
for(const request of ['chunk 1.5 2','chunk 0','chunk 0 1 2 3','chunk NaN 2','chunk 99999999999999999 0','invalid']) {
    diagnostics.diagnose(probe,request);
    assert.match(probe.messages.at(-1),/Coordinates must be integers/);
}
assert.equal(byteQueries,bytesBefore,'chunk probes skip general storage diagnostics');
assert.equal(queries.length,2);
mc.world.getDynamicPropertyTotalByteCount=()=>{throw new Error('storage unavailable');};
diagnostics.diagnose(user);
assert.match(user.messages.at(-1),/dynamic-property bytes=\?/,'failed byte counter is not reported as zero');
assert.equal(runtime.networkCount(),1);
assert.equal(runtime.nodeCount(),3);
assert.equal(lamp.permutation.getState('starstone:powered'),true);
assert.equal(cable.permutation.getState('starstone:connections'),10);
const cableWrites=cable.writes;
handler({id:'starstone:diagnose',sourceEntity:user,message:'cable'});
assert.match(user.messages.at(-1),/cable=\(1,0,0\) face=up mask=10 arms=off:n\(0,0,-1\) on:e\(1,0,0\) off:s\(0,0,1\) on:w\(-1,0,0\)/);
assert.equal(cable.writes,cableWrites,'cable probe is read-only');
const eastOnly=put('starstone:cable',6,0,0,{'starstone:connections':2});
const eastViewer=player(dim,eastOnly);
diagnostics.diagnose(eastViewer,'cable');
assert.match(eastViewer.messages.at(-1),/mask=2 arms=off:n\(0,0,-1\) on:e\(1,0,0\) off:s\(0,0,1\) off:w\(-1,0,0\)/);
const invalidCable=put('starstone:cable',5,0,0,{'starstone:connections':32});
const invalidViewer=player(dim,invalidCable);
diagnostics.diagnose(invalidViewer,'cable');
assert.match(invalidViewer.messages.at(-1),/unreadable face or connection mask/);
assert.equal(generator.writes,0);
handler({ id: 'starstone:debug', sourceEntity:user, message:'on' });
assert.equal(diagnostics.debugEnabled(),true);
handler({ id: 'starstone:debug', sourceEntity:{ ...user, typeId:'minecraft:pig' }, message:'off' });
assert.equal(diagnostics.debugEnabled(),true);
handler({ id: 'starstone:debug', sourceEntity:user, message:'off' });
assert.equal(diagnostics.debugEnabled(),false);
const stone = put('minecraft:stone',4,0,0);
const observer = player(dim,stone);
diagnostics.diagnose(observer);
assert.match(observer.messages[0], /minecraft:stone/);
diagnostics.diagnose(observer,'cable');
assert.match(observer.messages.at(-1),/Look directly at a Starstone cable/);
const disconnected = player(dim); disconnected.sendMessage = () => { throw new Error('gone'); };
assert.throws(() => diagnostics.startRebuildNearby(disconnected));
assert.equal(diagnostics.isRebuildRunning(),false);
console.log('diagnostics: registration, read-only diagnose, real rebuild, concurrent rejection, debug and cleanup passed');

// Requests cannot silently increase the scan budget, even through internal APIs.
let scanned = 0;
const empty = player({ getBlock() { scanned++; return undefined; } });
assert.equal(diagnostics.startRebuildNearby(empty,{radius:100000,height:100000}),true);
await drain();
assert.equal(scanned,2601);
assert.equal(diagnostics.isRebuildRunning(),false);

// Exercise remaining conditional keys and verify only the runtime namespace.
const noTarget=player(dim);
diagnostics.setDebugEnabled(true);
diagnostics.diagnose(noTarget);
diagnostics.handleDebug(noTarget,'');
diagnostics.setDebugEnabled(false);
diagnostics.handleDebug(noTarget,'');
const emitted=new Set();
function remember(raw) {
    if (raw.rawtext) for(const part of raw.rawtext) remember(part);
    else emitted.add(raw.translate);
}
for(const account of [user,observer,probe,noTarget,empty,invalidViewer,eastViewer]) for(const raw of account.rawMessages) remember(raw);
const languageText=readFileSync('starstone_rp/texts/en_US.lang','utf8');
const runtimeTemplates=languageText.split(/\r?\n/).filter(line=>line.startsWith('starstone.message.')).map(line=>{
    const equals=line.indexOf('='); return [line.slice(0,equals),line.slice(equals+1)];
});
for(const [key,template] of runtimeTemplates) {
    assert.doesNotMatch(template,/(^|[^%])%[1-9]\d*/,`${key} must not use unsupported bare %1 placeholders`);
    assert.ok(emitted.has(key),`runtime translation ${key} exercised through actual player messages`);
}
assert.deepEqual([...emitted].sort(),runtimeTemplates.map(([key])=>key).sort(),'all emitted message keys resolve exactly once');
