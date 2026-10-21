/** koishi's maintained Skills & MCP Manager; no global prompt injection. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { SkillsManager } from './skills.ts'
import { McpManager } from './mcp.ts'
import { ManagerError, ManagerService, parseRequest, requiresApproval, safeError } from './service.ts'
import { makeRoute } from './routes.ts'
import { connectMcp, nativeServers, workspaces, policyWorkspace } from './host.ts'
import { SkillPolicyStore } from './skill-policy.ts'
import { mountSkillPolicy } from './skill-policy-runtime.ts'
import { setNativeMcpEnabled } from './native-mcp.ts'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-working-directory'
import { MANAGER_ID, MANAGER_TOOL } from './protocol.ts'

export const name = MANAGER_ID
export const inject = ['webServer', 'connection', 'tools', 'credentials', 'approval', 'workspaceRegistry', 'configEditor', 'agents', 'skills', 'pluginManager', 'workingDirectory']
export interface Config { stateDir?: string }
export const Config = z.object({ stateDir: z.string().default('') })
declare module '@deepseek-ai/cordis' {
  interface Context { koishiSkillsMcpManager: ManagerService }
}
/** Keep tool results bounded; the UI still receives complete lists. */
export function boundedValue(value: unknown): unknown {
  if (Array.isArray(value) && value.length > 100) return { items: value.slice(0, 100), total: value.length, truncated: true, note: 'Use the Settings manager to browse the complete list.' }
  if (value && typeof value === 'object' && typeof (value as { content?: unknown }).content === 'string') {
    const v = value as Record<string, unknown> & { content: string }
    if (v.content.length > 16000) return { ...v, content: v.content.slice(0, 16000), truncated: true, note: 'Open the Settings manager for the complete skill body.' }
  }
  return value
}
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  // The editor's public documentPath is the mounted profile's authoritative patch path;
  // DSH_* shell metadata is not assumed to exist in the Host process environment.
  const stateDir = config.stateDir || join(dirname(ctx.configEditor.documentPath), 'data', MANAGER_ID)
  if (!isAbsolute(stateDir)) throw new Error('stateDir must be absolute')
  const skills = new SkillsManager({ stateDir: join(stateDir, 'skills'), dshHome, agentsHome: process.env.DSH_AGENTS_HOME || join(homedir(), '.agents'), workspacePaths: () => workspaces(ctx).map(w => w.path) })
  const policy = new SkillPolicyStore({ stateDir })
  await policy.load()
  await mountSkillPolicy(ctx, policy, {
    resolveCwd: cwd => policyWorkspace(ctx, cwd),
    mappingRevision: () => JSON.stringify(workspaces(ctx).map(w => w.path).sort()),
  })
  const mcp = new McpManager({
    stateDir, legacyPath: join(dshHome, 'mcp.json'),
    resolveCredential: async ref => (await ctx.credentials.resolve(ref as CredentialRef))?.value,
    nativeServers: () => nativeServers(ctx),
    nativeSetEnabled: (id, enabled) => setNativeMcpEnabled(ctx, id, enabled),
    connect: (server, resolved, probe) => connectMcp(ctx, server, resolved, probe),
  })
  const service = new ManagerService({ skills, policy, mcp, workspaces: () => workspaces(ctx) })
  ctx.provide('koishiSkillsMcpManager', service)
  ctx.effect(() => ctx.webServer.register(makeRoute({ service, requestRejection: req => ctx.connection.requestRejection(req) })), 'koishi manager authenticated route')
  ctx.effect(() => () => mcp.dispose(), 'koishi manager connections')
  ctx.tools.register({
    name: MANAGER_TOOL,
    description: 'Browse or manage local skills and MCP connections. Start with workspaces, skills.list or mcp.list; mutations require a fresh list revision and approval. Skills switches change DSH-only visibility without editing source files; workspace rules override profile defaults. Trash is recoverable. Native MCP entries support toggling but not editing or deleting. MCP secrets must be existing credential/environment references, never literal values. Settings → Skills & MCP provides the same operations.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['workspaces', 'skills.list', 'skills.read', 'skills.toggle', 'skills.trash', 'skills.scan', 'skills.import', 'trash.list', 'trash.restore', 'mcp.list', 'mcp.save', 'mcp.toggle', 'mcp.delete', 'mcp.test'] },
        cwd: { type: 'string', description: 'Exact registered workspace path; omit for user-level skills.' },
        id: { type: 'string', description: 'Object id returned by the corresponding list.' },
        revision: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Skill list revision or the MCP list revision. Required for toggle, trash, save and delete.' },
        enabled: { type: 'boolean' },
        dir: { type: 'string', description: 'Directory explicitly selected for a read-only import scan.' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, revision: { type: 'string' } }, required: ['id', 'revision'] }, description: 'Up to 100 items returned by skills.scan.' },
        server: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, transport: { type: 'string', enum: ['stdio', 'streamable-http'] }, enabled: { type: 'boolean' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' }, url: { type: 'string' }, envRefs: { type: 'object', description: 'Child environment names mapped to credential/environment reference names.' }, headerRefs: { type: 'object', description: 'Header names mapped to references containing complete header values.' } }, required: ['name', 'transport', 'enabled'] },
      }, required: ['action'],
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: args => { try { return !requiresApproval(parseRequest(args).action) } catch { return false } },
    async execute(args, exec) {
      const request = parseRequest(args)
      if (requiresApproval(request.action)) {
        if (!exec.agent) throw new ManagerError('APPROVAL_REQUIRED', 'A live agent and explicit approval are required')
        const outcome = await ctx.approval.request({ agent: exec.agent, toolName: MANAGER_TOOL, callId: exec.callId, signal: exec.signal, reason: `Manage skills/MCP: ${request.action}`, displayReason: { en: 'This operation changes local skills/MCP state or launches a connection probe.', zh: '此操作将修改本地技能/MCP 状态，或启动真实连接测试。' } })
        if (outcome !== 'allowed-once') throw new ManagerError('APPROVAL_REQUIRED', 'Operation was not approved; use the manager UI or ask the user to change approval policy')
      }
      try {
        const actorCwd = request.action === 'skills.read' && exec.agent
          ? policyWorkspace(ctx, await ctx.workingDirectory.ensure(exec.agent, exec.signal)) : undefined
        return JSON.parse(JSON.stringify(boundedValue(await service.execute(request, exec.signal, 'agent', actorCwd)) ?? null))
      }
      catch (error) { const safe = safeError(error); throw new ManagerError(safe.code, safe.message) }
    },
  })
  // Read/reconcile only this plugin's store. Never adopt the upstream global document.
  await mcp.reload()
}
