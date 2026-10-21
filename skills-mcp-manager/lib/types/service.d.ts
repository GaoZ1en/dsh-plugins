/** One validated application boundary, shared by the authenticated UI and agent tool. */
import type { SkillsManager } from './skills.ts';
import type { McpManager } from './mcp.ts';
import type { ManagerAction, ManagerRequest, WorkspaceItem } from './protocol.ts';
import type { SkillPolicyStore } from './skill-policy.ts';
export declare class ManagerError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function requiresApproval(action: ManagerAction): boolean;
export declare function parseRequest(value: unknown): ManagerRequest;
export interface ManagerDeps {
    skills: SkillsManager;
    policy: SkillPolicyStore;
    mcp: McpManager;
    workspaces: () => WorkspaceItem[];
}
export declare class ManagerService {
    private readonly deps;
    constructor(deps: ManagerDeps);
    private policyView;
    execute(input: unknown, signal?: AbortSignal, caller?: 'ui' | 'agent', actorCwd?: string): Promise<unknown>;
}
/** Never forward an arbitrary SDK/OS error or stack, even one carrying an uppercase code. */
export declare function safeError(error: unknown): {
    code: string;
    message: string;
};
//# sourceMappingURL=service.d.ts.map