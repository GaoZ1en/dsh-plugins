import type { Context } from '@deepseek-ai/cordis'
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type SkillsMcpKey } from './locales.ts'
import { SkillsMcpSection } from './SettingsCard.tsx'

const NS = 'koishi-skills-mcp-manager'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'koishi-skills-mcp-manager': SkillsMcpKey }
}

/** Narrow face of the current inspected Client services; no Host Client runtime imports. */
export type ManagerClientContext = Pick<Context, 'effect'> & {
  locale: LocaleRuntime
  uiWorkspace: Pick<UiWorkspace, 'pickDirectory'>
  slots: Pick<SlotCore, 'register'> & {
    inject(owner: 'settings.section', factory: () => () => void): () => void
  }
}
export const inject = ['slots', 'locale', 'uiWorkspace']
export function apply(ctx: ManagerClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'koishi-skills-mcp-manager', order: 20,
    label: () => ctx.locale.bind(NS)('title'), locale: NS,
    inject: () => ({ pickDirectory: () => ctx.uiWorkspace.pickDirectory() }),
  }, SkillsMcpSection))
}
