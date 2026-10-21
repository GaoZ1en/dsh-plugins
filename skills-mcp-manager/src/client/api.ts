import { MANAGER_API } from '../protocol.ts'
import type { ImportItem, ImportResult, ManagerErrorBody, ManagerRequest, McpList, McpServerConfig, ScannedSkill, SkillDetail, SkillSummary, TrashItem, WorkspaceItem } from '../protocol.ts'

export class SkillsMcpApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'SkillsMcpApiError'
  }
}

/** The same action contract is shared with the Host's agent tool. */
export class SkillsMcpApi {
  async request<T>(request: ManagerRequest): Promise<T> {
    const response = await fetch(MANAGER_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    let body: { ok: true; value: T } | { ok: false; error: ManagerErrorBody }
    try { body = await response.json() }
    catch { throw new SkillsMcpApiError('INVALID_RESPONSE', `HTTP ${response.status}`) }
    if (body?.ok === false && body.error && typeof body.error.message === 'string') {
      throw new SkillsMcpApiError(body.error.code, body.error.message)
    }
    if (!response.ok || body?.ok !== true) throw new SkillsMcpApiError('INVALID_RESPONSE', `HTTP ${response.status}`)
    return body.value
  }
  workspaces() { return this.request<WorkspaceItem[]>({ action: 'workspaces' }) }
  listSkills(cwd: string) { return this.request<SkillSummary[]>({ action: 'skills.list', cwd }) }
  readSkill(cwd: string, skill: SkillSummary) { return this.request<SkillDetail>({ action: 'skills.read', cwd, id: skill.id, revision: skill.revision }) }
  toggleSkill(cwd: string, skill: SkillSummary, enabled: boolean) { return this.request<void>({ action: 'skills.toggle', cwd, id: skill.id, revision: skill.revision, enabled }) }
  trashSkill(cwd: string, skill: SkillSummary) { return this.request<void>({ action: 'skills.trash', cwd, id: skill.id, revision: skill.revision }) }
  scanSkills(cwd: string, dir: string) { return this.request<ScannedSkill[]>({ action: 'skills.scan', cwd, dir }) }
  importSkills(cwd: string, items: ImportItem[]) { return this.request<ImportResult[]>({ action: 'skills.import', cwd, items }) }
  listTrash(cwd: string) { return this.request<TrashItem[]>({ action: 'trash.list', cwd }) }
  restoreTrash(cwd: string, id: string) { return this.request<void>({ action: 'trash.restore', cwd, id }) }
  listMcp() { return this.request<McpList>({ action: 'mcp.list' }) }
  saveMcp(server: McpServerConfig, revision: number) { return this.request<void>({ action: 'mcp.save', server, revision }) }
  setMcpEnabled(id: string, enabled: boolean, revision: number) { return this.request<void>({ action: 'mcp.toggle', id, enabled, revision }) }
  deleteMcp(id: string, revision: number) { return this.request<void>({ action: 'mcp.delete', id, revision }) }
  testMcp(server: McpServerConfig) { return this.request<{ ok: boolean; error?: string }>({ action: 'mcp.test', server }) }
}
