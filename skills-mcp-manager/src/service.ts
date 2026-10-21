/** One validated application boundary, shared by the authenticated UI and agent tool. */
import type { SkillsManager } from './skills.ts'
import type { McpManager } from './mcp.ts'
import type { ManagerAction, ManagerRequest, WorkspaceItem, SkillSummary, SkillDetail } from './protocol.ts'
import type { SkillPolicyStore } from './skill-policy.ts'
import { createHash } from 'node:crypto'

const actions = new Set<ManagerAction>(['workspaces', 'skills.list', 'skills.read', 'skills.toggle', 'skills.trash', 'skills.scan', 'skills.import', 'trash.list', 'trash.restore', 'mcp.list', 'mcp.save', 'mcp.toggle', 'mcp.delete', 'mcp.test'])
const safeKeys = new Set(['action', 'cwd', 'id', 'revision', 'enabled', 'dir', 'items', 'server'])
const mutations = new Set<ManagerAction>(['skills.toggle', 'skills.trash', 'skills.import', 'trash.restore', 'mcp.save', 'mcp.toggle', 'mcp.delete', 'mcp.test'])
export class ManagerError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'ManagerError' }
}
export function requiresApproval(action: ManagerAction): boolean { return mutations.has(action) }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0')) throw new ManagerError('INVALID_INPUT', `${label} is required`)
  return value
}
function revision(value: unknown, kind: 'skill' | 'mcp'): string | number {
  if (kind === 'skill' && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value
  if (kind === 'mcp' && Number.isSafeInteger(value) && (value as number) >= 0) return value as number
  throw new ManagerError('INVALID_INPUT', 'A fresh revision from the list is required')
}
export function parseRequest(value: unknown): ManagerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManagerError('INVALID_INPUT', 'Expected an action object')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !safeKeys.has(key))) throw new ManagerError('INVALID_INPUT', 'Unknown request field')
  if (typeof record.action !== 'string' || !actions.has(record.action as ManagerAction)) throw new ManagerError('INVALID_INPUT', 'Unknown action')
  if (record.cwd !== undefined && (typeof record.cwd !== 'string' || record.cwd.length > 8192 || record.cwd.includes('\0'))) throw new ManagerError('INVALID_INPUT', 'Invalid workspace')
  return record as unknown as ManagerRequest
}
export interface ManagerDeps {
  skills: SkillsManager
  policy: SkillPolicyStore
  mcp: McpManager
  workspaces: () => WorkspaceItem[]
}
export class ManagerService {
  private readonly deps: ManagerDeps
  constructor(deps: ManagerDeps) { this.deps = deps }
  private policyView<T extends SkillSummary | SkillDetail>(skill: T, cwd?: string): T {
    const policy = this.deps.policy
    return { ...skill, sourceEnabled: skill.enabled, enabled: skill.enabled && policy.isEnabled(skill.name, cwd || undefined), toggleable: true,
      revision: createHash('sha256').update(`${skill.revision}:${policy.snapshot().revision}`).digest('hex') }
  }
  async execute(input: unknown, signal?: AbortSignal, caller: 'ui' | 'agent' = 'ui', actorCwd?: string): Promise<unknown> {
    signal?.throwIfAborted()
    const r = parseRequest(input)
    const { skills, mcp } = this.deps
    switch (r.action) {
      case 'workspaces': return this.deps.workspaces()
      case 'skills.list': {
        await this.deps.policy.load()
        return (await skills.listSkills(r.cwd || undefined)).map(s => this.policyView(s, r.cwd))
      }
      case 'skills.read': {
        await this.deps.policy.load()
        const skill = await skills.readSkill(text(r.id, 'id'), r.cwd || undefined)
        if (caller === 'agent' && (!actorCwd || !this.deps.policy.isEnabled(skill.name, actorCwd) || !this.deps.policy.isEnabled(skill.name, r.cwd || undefined))) throw new ManagerError('POLICY_DISABLED', 'This skill is disabled for the agent or selected DSH scope; its body is only available in the manager UI preview')
        return this.policyView(skill, r.cwd)
      }
      case 'skills.toggle': {
        if (typeof r.enabled !== 'boolean') throw new ManagerError('INVALID_INPUT', 'enabled must be boolean')
        await this.deps.policy.load()
        const skill = await skills.readSkill(text(r.id, 'id'), r.cwd || undefined)
        if (this.policyView(skill, r.cwd).revision !== revision(r.revision, 'skill')) throw new ManagerError('REVISION_CONFLICT', 'Skill or DSH visibility changed; refresh and retry')
        if (r.enabled && !skill.enabled) throw new ManagerError('SOURCE_DISABLED', 'The source skill itself is disabled; enabling in DSH cannot override its source invocation policy')
        signal?.throwIfAborted()
        await this.deps.policy.setEnabled(skill.name, r.enabled, this.deps.policy.snapshot().revision, r.cwd || undefined)
        return null
      }
      case 'skills.trash': {
        await this.deps.policy.load()
        const skill = await skills.readSkill(text(r.id, 'id'), r.cwd || undefined)
        if (this.policyView(skill, r.cwd).revision !== revision(r.revision, 'skill')) throw new ManagerError('REVISION_CONFLICT', 'Skill or DSH visibility changed; refresh and retry')
        await skills.deleteSkill(skill.id, skill.revision, r.cwd || undefined)
        return null
      }
      case 'skills.scan': return skills.scanSkills(text(r.dir, 'dir'))
      case 'skills.import':
        if (!Array.isArray(r.items) || !r.items.length || r.items.length > 100 || r.items.some(i => !i || typeof i !== 'object' || Object.keys(i).some(k => k !== 'id' && k !== 'revision') || typeof i.id !== 'string' || typeof i.revision !== 'string')) throw new ManagerError('INVALID_INPUT', 'Select between 1 and 100 scanned items')
        return skills.importSkills(r.items)
      case 'trash.list': return skills.listTrash()
      case 'trash.restore': await skills.restoreSkill(text(r.id, 'id')); return null
      case 'mcp.list': return mcp.list()
      case 'mcp.save':
        if (!r.server) throw new ManagerError('INVALID_INPUT', 'server is required')
        await mcp.save(r.server, revision(r.revision, 'mcp') as number); return null
      case 'mcp.toggle':
        if (typeof r.enabled !== 'boolean') throw new ManagerError('INVALID_INPUT', 'enabled must be boolean')
        await mcp.setEnabled(text(r.id, 'id'), r.enabled, revision(r.revision, 'mcp') as number); return null
      case 'mcp.delete': await mcp.delete(text(r.id, 'id'), revision(r.revision, 'mcp') as number); return null
      case 'mcp.test':
        if (!r.server) throw new ManagerError('INVALID_INPUT', 'server is required')
        return mcp.testConnect(r.server, signal)
    }
  }
}
/** Only these application errors have intentionally public, credential-free messages. */
const publicErrors = new Set(['INVALID_INPUT', 'BODY_TOO_LARGE', 'APPROVAL_REQUIRED', 'CONFLICT', 'REVISION_CONFLICT', 'BACKUP_CONFLICT', 'READ_ONLY', 'NOT_FOUND', 'INVALID_WORKSPACE', 'INVALID_SCAN', 'INVALID_SKILL', 'UNSAFE_YAML', 'UNSAFE_PATH', 'UNSAFE_FILE', 'UNSAFE_STATE', 'CORRUPT_STATE', 'CORRUPT_CONFIG', 'STATE_LIMIT', 'BUSY', 'LOCKED', 'ALREADY_EXISTS', 'NATIVE_UNAVAILABLE', 'WRITE_FAILED', 'DISPOSE_FAILED', 'DISPOSED', 'POLICY_DISABLED', 'SOURCE_DISABLED', 'NATIVE_RESTART_REQUIRED', 'NATIVE_APPLY_FAILED', 'NATIVE_STATE_CHANGED'])
/** Never forward an arbitrary SDK/OS error or stack, even one carrying an uppercase code. */
export function safeError(error: unknown): { code: string; message: string } {
  const e = error as { code?: unknown; message?: unknown }
  const code = typeof e?.code === 'string' && publicErrors.has(e.code) ? e.code : 'OPERATION_FAILED'
  if (code === 'OPERATION_FAILED') return { code, message: 'Operation failed; no changes are implied. Refresh the list and check the configuration.' }
  return { code, message: typeof e.message === 'string' ? e.message.slice(0, 1000) : code }
}
