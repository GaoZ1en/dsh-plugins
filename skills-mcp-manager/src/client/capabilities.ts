import type { McpServerSummary, SkillSummary } from '../protocol.ts'

/** Source writes and DSH invocation policy are independent permissions. */
export function skillCapabilities(skill: Pick<SkillSummary, 'writable' | 'toggleable' | 'sourceEnabled'>) {
  return {
    toggle: skill.toggleable ?? skill.writable,
    trash: skill.writable,
    sourceDisabled: skill.sourceEnabled === false,
  }
}

/** Native configuration stays read-only even when its DSH connection may be switched. */
export function mcpCapabilities(server: Pick<McpServerSummary, 'writable' | 'toggleable' | 'source' | 'cleanupPending'>) {
  const writable = server.writable && server.source === 'managed'
  return {
    toggle: !server.cleanupPending && (server.toggleable ?? server.writable),
    edit: writable && !server.cleanupPending,
    remove: writable,
  }
}
