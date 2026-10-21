import type { McpServerSummary, SkillSummary } from '../protocol.ts';
/** Source writes and DSH invocation policy are independent permissions. */
export declare function skillCapabilities(skill: Pick<SkillSummary, 'writable' | 'toggleable' | 'sourceEnabled'>): {
    toggle: boolean;
    trash: boolean;
    sourceDisabled: boolean;
};
/** Native configuration stays read-only even when its DSH connection may be switched. */
export declare function mcpCapabilities(server: Pick<McpServerSummary, 'writable' | 'toggleable' | 'source' | 'cleanupPending'>): {
    toggle: boolean;
    edit: boolean;
    remove: boolean;
};
//# sourceMappingURL=capabilities.d.ts.map