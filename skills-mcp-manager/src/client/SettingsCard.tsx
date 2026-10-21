import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SkillsMcpManager } from './manager.tsx'
import css from './settings-card.module.css'

export type SkillsMcpSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'koishi-skills-mcp-manager'>
  & InjectFace<{ pickDirectory: () => Promise<string | null> }>

export function SkillsMcpSection(props: SkillsMcpSectionProps) {
  return <div className={css.sectionPage}>
    <h2 className={css.pageHeading}>{props.t('title')}</h2>
    <p className={css.note}>{props.t('description')}</p>
    <SkillsMcpManager t={props.t} pickDirectory={props.pickDirectory} />
  </div>
}
