// Resolve through Node so junction aliases share the same module instance.
export async function resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@minecraft/server"
        ? new URL("./minecraft-server.mjs", import.meta.url).href : specifier, context);
}
