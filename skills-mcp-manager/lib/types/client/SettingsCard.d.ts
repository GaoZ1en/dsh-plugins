import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export type SkillsMcpSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'koishi-skills-mcp-manager'> & InjectFace<{
    pickDirectory: () => Promise<string | null>;
}>;
export declare function SkillsMcpSection(props: SkillsMcpSectionProps): import("react").JSX.Element;
//# sourceMappingURL=SettingsCard.d.ts.map