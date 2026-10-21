/** Native MCP enablement delegates exclusively to the public profile lifecycle API. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { McpManagerError } from './mcp.ts'

/** Only these two public methods are needed; tests need no profile or real plugin manager. */
export interface NativeMcpContext {
  pluginManager?: Pick<Context['pluginManager'], 'listPlugins' | 'setPluginEnabled'>
}
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'
type Entry = Awaited<ReturnType<NonNullable<NativeMcpContext['pluginManager']>['listPlugins']>>[number]
function manageable(entry: Entry): boolean {
  return entry.moduleName === MCP_MODULE && !entry.readOnlyReason && typeof entry.patchId === 'string' && entry.patchId.length > 0
}

export async function listToggleableNativeIds(ctx: NativeMcpContext): Promise<Set<string>> {
  if (!ctx.pluginManager) return new Set()
  try {
    const entries = await ctx.pluginManager.listPlugins()
    return new Set(entries.filter(manageable).map(entry => `native:${entry.entryId}`))
  } catch {
    // Inventory failures must never make arbitrary native entries appear mutable.
    throw new McpManagerError('NATIVE_UNAVAILABLE', 'Native MCP management inventory is unavailable')
  }
}

export async function setNativeMcpEnabled(ctx: NativeMcpContext, id: string, enabled: boolean): Promise<void> {
  if (typeof enabled !== 'boolean' || typeof id !== 'string' || !id.startsWith('native:') || id.length <= 'native:'.length || id.length > 4096 || /[\x00-\x1f\x7f]/.test(id)) {
    throw new McpManagerError('INVALID_INPUT', 'Invalid native MCP enablement request')
  }
  const manager = ctx.pluginManager
  if (!manager) throw new McpManagerError('READ_ONLY', 'Native MCP management is unavailable in this profile')
  let entries: Entry[]
  try { entries = await manager.listPlugins() }
  catch { throw new McpManagerError('NATIVE_UNAVAILABLE', 'Native MCP management inventory is unavailable') }
  // Use the exact inventory identity; do not infer a patch id from a name or edit configuration.
  const entry = entries.find(candidate => `native:${candidate.entryId}` === id)
  if (!entry || entry.moduleName !== MCP_MODULE) throw new McpManagerError('NOT_FOUND', 'Native MCP entry not found')
  if (!manageable(entry)) throw new McpManagerError('READ_ONLY', 'Native MCP entry cannot be managed through this profile')
  let result: Awaited<ReturnType<typeof manager.setPluginEnabled>>
  try { result = await manager.setPluginEnabled(entry.entryId, enabled) }
  catch { throw new McpManagerError('NATIVE_APPLY_FAILED', 'Native MCP change failed; its saved state may have changed. Refresh before retrying') }
  if (result.application === 'restart-required') {
    throw new McpManagerError('NATIVE_RESTART_REQUIRED', 'Native MCP change was saved but requires restart; refresh before retrying')
  }
  if (result.application !== 'applied' || result.error || (result.enabled !== undefined && result.enabled !== enabled)) {
    throw new McpManagerError('NATIVE_APPLY_FAILED', 'Native MCP change was not applied live; its saved state may have changed. Refresh before retrying')
  }
}
