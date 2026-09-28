import { register } from 'node:module';
register('./shims/minecraft-server-loader.mjs', import.meta.url);
import { readFileSync } from 'node:fs';
export const mc = await import('./shims/minecraft-server.mjs');
const runs = [], jobs = [];
export const intervals = [];
globalThis.__mcRun = cb => { runs.push(cb); return runs.length; };
globalThis.__mcRunJob = job => { jobs.push(job); return jobs.length; };
globalThis.__mcRunInterval = cb => intervals.push(cb);
globalThis.__mcWorldSubscribers = {};
const language = new Map(readFileSync('starstone_rp/texts/en_US.lang','utf8')
    .split(/\r?\n/).filter(line=>line && !line.startsWith('#')).map(line=>{
        const equals=line.indexOf('=');
        return [line.slice(0,equals),line.slice(equals+1)];
    }));
export function renderRawMessage(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value?.rawtext)) return value.rawtext.map(renderRawMessage).join('');
    if (typeof value?.text === 'string') return value.text;
    if (typeof value?.translate !== 'string' || !language.has(value.translate)) throw new Error(`Missing message translation: ${value?.translate}`);
    const args=value.with || [];
    if (!Array.isArray(args) || !args.every(arg=>typeof arg === 'string')) throw new Error('Translation arguments must be strings');
    const template=language.get(value.translate);
    if (value.translate.startsWith('starstone.message.')) {
        if (/(^|[^%])%[1-9]\d*/.test(template)) throw new Error(`Unsupported bare positional placeholder: ${value.translate}`);
        const count=(template.match(/%s/g)||[]).length;
        if (args.length!==count) throw new Error(`Translation argument count ${args.length} does not match ${count}: ${value.translate}`);
    }
    let sequential=0;
    return template.replace(/%%([1-9]\d*)|%s/g,(_,index)=>{
        const position=index ? Number(index)-1 : sequential++;
        if (args[position] === undefined) throw new Error(`Missing translation argument ${position+1}: ${value.translate}`);
        return args[position];
    });
}
export async function drain() {
    for (let turn = 0; turn < 100000; turn++) {
        for (const cb of runs.splice(0)) cb();
        for (const job of jobs.splice(0)) if (!job.next().done) jobs.push(job);
        await Promise.resolve();
        await Promise.resolve();
        if (!runs.length && !jobs.length) return;
    }
    throw new Error('Scheduler did not finish');
}
function permutation(id, states) {
    return {
        type: { id },
        getState: key => states[key],
        withState(key, value) {
            if (!(key in states)) throw new Error(`Unknown state ${key} on ${id}`);
            return permutation(id, { ...states, [key]: value });
        },
        isLiquidBlocking: () => id === 'minecraft:stone' || id === 'starstone:generator' || id === 'starstone:conduit'
    };
}
export function fixture() {
    const store = new Map();
    const unloaded = new Set();
    const dim = {
        id: 'minecraft:overworld',
        isChunkLoaded: ({ x,y,z }) => !unloaded.has(`${x},${y},${z}`),
        getBlock(p) {
            if (p.y < -64 || p.y > 319) throw new Error('Out of bounds');
            if (!dim.isChunkLoaded(p)) return undefined;
            return store.get(`${p.x},${p.y},${p.z}`) || make('minecraft:air', p.x,p.y,p.z, {});
        },
        runCommand(command) {
            const [,x,y,z] = command.split(' ');
            store.delete(`${x},${y},${z}`);
            return { successCount: 1 };
        }
    };
    function make(id,x,y,z,states) {
        return {
            type: { id }, typeId: id, isValid: true, isAir: id === 'minecraft:air', isLiquid: false,
            dimension: dim, location: { x,y,z }, permutation: permutation(id, states), writes: 0,
            setPermutation(perm) { this.permutation = perm; this.writes++; }
        };
    }
    function put(id,x,y,z,states = {}) {
        const defaults = id === 'starstone:generator' ? { 'starstone:enabled': true } :
            id === 'starstone:inner_corner' ? { 'starstone:face_mask_low': 0, 'starstone:face_mask_high': 0, 'starstone:arms_low': 0, 'starstone:arms_high': 0, 'starstone:powered': false } :
            id === 'starstone:bridge' ? { 'minecraft:block_face': 'up', 'starstone:powered_ns': false, 'starstone:powered_ew': false } :
            id === 'starstone:conduit' ? { 'starstone:axis': 'y', 'starstone:powered': false } :
            id === 'starstone:redstone_input' || id === 'starstone:redstone_output' ?
                { 'minecraft:block_face': 'up', 'starstone:powered': false, 'starstone:star_powered': false, 'starstone:connections': 0, 'starstone:redstone_connections': 0 } :
            { 'minecraft:block_face': 'up', 'starstone:powered': false, 'starstone:connections': 0 };
        const block = make(id,x,y,z, { ...defaults, ...states });
        store.set(`${x},${y},${z}`, block);
        return block;
    }
    return { dim, put, store, unloaded };
}
export function player(dim, target) {
    return {
        typeId: 'minecraft:player', isValid: true, dimension: dim, location: { x:0,y:0,z:0 }, messages: [], rawMessages: [],
        sendMessage(text) { this.messages.push(renderRawMessage(text)); this.rawMessages.push(text); },
        getBlockFromViewDirection() { return target ? { block: target } : undefined; }
    };
}
