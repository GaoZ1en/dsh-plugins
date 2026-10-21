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
  const deny = inheritedManagementTools(ctx.tools);
  if (deny.length) ctx.tools.restrict({ deny });
}
