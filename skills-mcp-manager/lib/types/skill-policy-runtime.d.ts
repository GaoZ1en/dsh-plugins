/** Supported SDK bridge: deny-only tombstones in each live Agent's nearest skill layer. */
import type { Context } from '@deepseek-ai/cordis';
import { SkillPolicyStore } from './skill-policy.ts';
/**
 * Does not edit source files, rewrite prompt assembly, activate cold sessions, or wake Agents.
 * Each declared skills-dependency child fiber belongs to its Agent and to the manager's cleanup.
 * Await mounting so already-live Agents are protected before the manager reports successful startup.
 */
export declare function mountSkillPolicy(ctx: Context, policy: SkillPolicyStore, options?: {
    resolveCwd?: (cwd?: string) => string | undefined;
    mappingRevision?: () => string;
}): Promise<() => Promise<void>>;
//# sourceMappingURL=skill-policy-runtime.d.ts.map