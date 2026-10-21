import type { ImportItem, ImportResult, ManagerRequest, McpList, McpServerConfig, ScannedSkill, SkillDetail, SkillSummary, TrashItem, WorkspaceItem } from '../protocol.ts';
export declare class SkillsMcpApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** The same action contract is shared with the Host's agent tool. */
export declare class SkillsMcpApi {
    request<T>(request: ManagerRequest): Promise<T>;
    workspaces(): Promise<WorkspaceItem[]>;
    listSkills(cwd: string): Promise<SkillSummary[]>;
    readSkill(cwd: string, skill: SkillSummary): Promise<SkillDetail>;
    toggleSkill(cwd: string, skill: SkillSummary, enabled: boolean): Promise<void>;
    trashSkill(cwd: string, skill: SkillSummary): Promise<void>;
    scanSkills(cwd: string, dir: string): Promise<ScannedSkill[]>;
    importSkills(cwd: string, items: ImportItem[]): Promise<ImportResult[]>;
    listTrash(cwd: string): Promise<TrashItem[]>;
    restoreTrash(cwd: string, id: string): Promise<void>;
    listMcp(): Promise<McpList>;
    saveMcp(server: McpServerConfig, revision: number): Promise<void>;
    setMcpEnabled(id: string, enabled: boolean, revision: number): Promise<void>;
    deleteMcp(id: string, revision: number): Promise<void>;
    testMcp(server: McpServerConfig): Promise<{
        ok: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=api.d.ts.map