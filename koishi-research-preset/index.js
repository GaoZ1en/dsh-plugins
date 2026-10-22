// This standing preset contribution owns only its own tool restriction.
export const name = 'koishi-research-tool-policy';
export const inject = ['tools'];

export const MANAGEMENT_TOOLS = Object.freeze([
  'plugin_manager', 'skills_mcp_manager',
  'cordis_inspect_list', 'cordis_inspect_query',
  'create_goal', 'get_goal', 'update_goal', 'todo_write',
  'schedule_create', 'schedule_update', 'schedule_delete', 'schedule_list',
  'workflow',
]);

export function inheritedManagementTools(tools) {
  // The no-scope view is the public GLOBAL view. Never build a broad allowlist
  // from it: that would hide the preset's inherited tools from its children.
  const globals = new Set(tools.schemas().map(tool => tool.name));
  return MANAGEMENT_TOOLS.filter(name => globals.has(name));
}

export function apply(ctx) {
  ctx.tools.presentAs('native');
  const denied = new Set();
  const restrictManagement = () => {
    // restrict() rejects unknown names. tools/change is the public, unfiltered
    // notification for late registrations, including globals outside this scope.
    const deny = inheritedManagementTools(ctx.tools).filter(name => !denied.has(name));
    if (!deny.length) return;
    // restrict() itself emits tools/change synchronously: mark before calling it.
    for (const name of deny) denied.add(name);
    try {
      ctx.tools.restrict({ deny });
    } catch (error) {
      for (const name of deny) denied.delete(name);
      throw error;
    }
    // Keep the mask across unregister/re-register; never replace it with an
    // allowlist or briefly lift it. At most MANAGEMENT_TOOLS.length names accrue.
  };
  // Both listener and restrictions belong to this plugin's scoped context and
  // are removed by Cordis on unload. Subscribe before taking the initial view.
  ctx.on('tools/change', restrictManagement);
  restrictManagement();
}
