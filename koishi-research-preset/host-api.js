/** Import public exports through their owning Host Loader tree, preserving the
 * Host's module identity. A linked plugin's Node import resolution does not see
 * app.asar's node_modules; installing another SDK copy is not equivalent.
 * Loader.entries, Entry.moduleNamespace and EntryTree.import are public Cordis
 * APIs. This reads entries; it never enables, rewrites, or activates them. */
export async function importHostModule(ctx, specifier) {
  const entries = [...ctx.loader.entries()].filter(entry => entry.options.name === specifier);
  const entry = entries.find(item => item.moduleNamespace) ?? entries[0];
  if (!entry) throw new Error(`Research preset requires the Host module ${specifier}; no matching Loader entry exists.`);
  return entry.moduleNamespace ?? await entry.parent.tree.import(entry.options.name);
}
