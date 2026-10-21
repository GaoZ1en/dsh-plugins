import type { McpServerConfig } from '../protocol.ts'
import type { Translate } from './locales.ts'

export interface McpForm {
  id?: string
  revision?: number
  name: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command: string
  args: string
  cwd: string
  url: string
  envRefs: string
  headerRefs: string
}
export const emptyForm = (): McpForm => ({
  name: '', transport: 'stdio', enabled: false, command: '', args: '', cwd: '', url: '', envRefs: '', headerRefs: '',
})
export function refsText(refs?: Record<string, string>): string {
  return Object.entries(refs || {}).map(([key, value]) => `${key}=${value}`).join('\n')
}
function parseRefs(text: string, t: Translate): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const at = line.indexOf('=')
    const key = line.slice(0, at).trim(), value = line.slice(at + 1).trim()
    if (at <= 0 || !key || !value || Object.hasOwn(result, key)) throw new Error(t('invalidRefs'))
    result[key] = value
  }
  return result
}

/** Pure wire-payload builder shared by Save and Test. Host validates reference syntax and paths. */
export function buildMcpServer(form: McpForm, t: Translate): McpServerConfig {
  if (!form.name.trim() || !(form.transport === 'stdio' ? form.command.trim() : form.url.trim())) throw new Error(t('required'))
  const base: McpServerConfig = {
    ...(form.id ? { id: form.id } : {}), name: form.name.trim(), transport: form.transport, enabled: form.enabled,
  }
  if (form.transport === 'streamable-http') return { ...base, url: form.url.trim(), headerRefs: parseRefs(form.headerRefs, t) }
  const cwd = form.cwd.trim()
  return {
    ...base, command: form.command.trim(), args: form.args.split('\n').filter(value => value !== ''),
    ...(cwd ? { cwd } : {}), envRefs: parseRefs(form.envRefs, t),
  }
}
