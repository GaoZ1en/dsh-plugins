/** Version-pinned DSH adapters. The engines themselves do not import the SDK. */
import type { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-tools'
import type { McpHandle } from './mcp.ts'
import type { McpServerConfig, McpServerSummary, WorkspaceItem } from './protocol.ts'
import { listToggleableNativeIds } from './native-mcp.ts'
import { relative, resolve, isAbsolute, sep } from 'node:path'

export function workspaces(ctx: Context): WorkspaceItem[] {
  return ctx.workspaceRegistry.list().map(w => ({ id: w.id, path: w.path, title: w.title }))
}
export function policyWorkspace(ctx: Context, cwd?: string): string | undefined {
  if (!cwd) return undefined
  const path = resolve(cwd)
  return workspaces(ctx).map(w => resolve(w.path)).filter(root => {
    const rest = relative(root, path)
    return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`))
  }).sort((a, b) => b.length - a.length)[0] || path
}
export async function nativeServers(ctx: Context): Promise<McpServerSummary[]> {
  const toggleableIds = await listToggleableNativeIds(ctx)
  return ctx.configEditor.entries().filter(entry => entry.options.name === '@deepseek-ai/dsh-mcp-client').map(entry => {
    // Pick only non-secret identity fields; never serialize a resolved entry config.
    const config: unknown = entry.fiber?.config || entry.options.config
    const c = config && typeof config === 'object' ? config as Record<string, unknown> : {}
    const name = typeof c.serverName === 'string' ? c.serverName : entry.id
    return {
      id: `native:${entry.id}`, name,
      transport: c.transport === 'streamable-http' ? 'streamable-http' as const : 'stdio' as const,
      enabled: !entry.disabled,
      status: 'external' as const,
      source: 'native' as const, writable: false, toggleable: toggleableIds.has(`native:${entry.id}`),
      toolCount: ctx.tools.schemas().filter(t => t.name.startsWith(`mcp__${name}__`)).length,
    }
  })
}
export async function connectMcp(ctx: Context, config: McpServerConfig, resolved: { env: Record<string, string>; headers: Record<string, string>; signal?: AbortSignal }, probe: boolean): Promise<McpHandle> {
  const key = {}
  const scope = probe ? createScope(ctx, key) : undefined
  const owner = scope?.ctx || ctx
  const base = { serverName: config.name, toolCallTimeoutMs: 60000, failOnStartupError: true, reconnect: { enabled: !probe, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } }
  const actual: mcpClient.Config = config.transport === 'stdio'
    ? { ...base, transport: 'stdio', command: config.command!, args: config.args || [], env: resolved.env, cwd: config.cwd || '' }
    : { ...base, transport: 'streamable-http', url: config.url!, headers: resolved.headers }
  let fiber: ReturnType<Context['plugin']> | undefined
  let cleanup: Promise<void> | undefined
  const dispose = (): Promise<void> => cleanup ??= (async () => {
    resolved.signal?.removeEventListener('abort', aborted)
    // Dispose the child before the scope, draining an in-flight SDK startup.
    try { await fiber?.dispose() } finally { await scope?.dispose() }
  })()
  const aborted = () => { void dispose().catch(() => {}) }
  try {
    resolved.signal?.throwIfAborted()
    fiber = owner.plugin(mcpClient, actual)
    resolved.signal?.addEventListener('abort', aborted, { once: true })
    if (resolved.signal?.aborted) { await dispose(); resolved.signal.throwIfAborted() }
    await fiber
    resolved.signal?.throwIfAborted()
    return { dispose, toolCount: () => owner.tools.schemas(probe ? key : undefined).filter(t => t.name.startsWith(`mcp__${config.name}__`)).length }
  } catch (error) {
    await dispose()
    throw error
  }
}
