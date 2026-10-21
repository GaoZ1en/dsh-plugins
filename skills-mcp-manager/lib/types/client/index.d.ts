import type { Context } from '@deepseek-ai/cordis';
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';
import { type SkillsMcpKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'koishi-skills-mcp-manager': SkillsMcpKey;
    }
}
/** Narrow face of the current inspected Client services; no Host Client runtime imports. */
export type ManagerClientContext = Pick<Context, 'effect'> & {
    locale: LocaleRuntime;
    uiWorkspace: Pick<UiWorkspace, 'pickDirectory'>;
    slots: Pick<SlotCore, 'register'> & {
        inject(owner: 'settings.section', factory: () => () => void): () => void;
    };
};
export declare const inject: string[];
export declare function apply(ctx: ManagerClientContext): void;
//# sourceMappingURL=index.d.ts.map