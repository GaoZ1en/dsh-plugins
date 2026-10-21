/** Shared data-only contract for the koishi fork. Never put credential values on this wire. */
export type SkillSource = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents'
export type SkillLevel = 'project' | 'user'
export interface SkillSummary {
  id: string
  revision: string
  name: string
  description: string
  whenToUse: string
  enabled: boolean
  source: SkillSource
  level: SkillLevel
  kind: 'bundle' | 'file'
  path: string
  /** Source-file edit/trash permission; independent of the DSH-only toggle. */
  writable: boolean
  toggleable?: boolean
  /** Original source invocation policy; a DSH-only enable does not override it. */
  sourceEnabled?: boolean
  readOnlyReason?: string
}
export interface SkillDetail extends SkillSummary { content: string }
export interface ScannedSkill {
  id: string
  revision: string
  name: string
  description: string
  sourcePath: string
  kind: 'bundle' | 'file'
}
export interface ImportItem { id: string; revision: string }
export interface ImportResult { name: string; ok: boolean; reason?: string }
export interface TrashItem { id: string; name: string; originalPath: string; deletedAt: string }
export interface WorkspaceItem { id: string; path: string; title: string }
export type McpTransport = 'stdio' | 'streamable-http'
export interface McpServerConfig {
  id?: string
  name: string
  transport: McpTransport
  enabled: boolean
  command?: string
  args?: string[]
  /** Environment variable name on child -> DSH CredentialRef/environment name. */
  envRefs?: Record<string, string>
  cwd?: string
  url?: string
  /** HTTP header name -> DSH CredentialRef/environment name. Value is used literally. */
  headerRefs?: Record<string, string>
}
export type McpConnectionStatus = 'loading' | 'loaded' | 'failed' | 'stopped' | 'external'
export interface McpServerSummary extends McpServerConfig {
  id: string
  status: McpConnectionStatus
  error?: string
  toolCount: number
  source: 'managed' | 'native'
  writable: boolean
  toggleable?: boolean
  /** Saved deletion whose previous connection has not finished disposal. Only removal may be retried. */
  cleanupPending?: boolean
}
export interface McpList { revision: number; servers: McpServerSummary[]; legacyAvailable: boolean }
export type ManagerAction = 'workspaces' | 'skills.list' | 'skills.read' | 'skills.toggle' | 'skills.trash' | 'skills.scan' | 'skills.import' | 'trash.list' | 'trash.restore' | 'mcp.list' | 'mcp.save' | 'mcp.toggle' | 'mcp.delete' | 'mcp.test'
export interface ManagerRequest {
  action: ManagerAction
  cwd?: string
  id?: string
  revision?: string | number
  enabled?: boolean
  dir?: string
  items?: ImportItem[]
  server?: McpServerConfig
}
export interface ManagerErrorBody { code: string; message: string }
export const MANAGER_API = '/api/koishi-skills-mcp/action'
export const MANAGER_TOOL = 'skills_mcp_manager'
export const MANAGER_ID = 'koishi-skills-mcp-manager'
