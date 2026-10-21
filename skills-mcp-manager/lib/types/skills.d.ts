import type { ImportItem, ImportResult, ScannedSkill, SkillDetail, SkillSummary, TrashItem } from './protocol.ts';
export interface SkillsManagerOptions {
    stateDir: string;
    dshHome: string;
    agentsHome: string;
    workspacePaths: () => string[];
}
export declare class SkillsManager {
    private readonly options;
    private readonly grants;
    constructor(options: SkillsManagerOptions);
    private ordered;
    private roots;
    private snapshot;
    /** An explicitly linked skill is readable even outside the managed root.
     * Only its instruction file is opened; linked resources are not traversed.
     * This snapshot is never eligible for mutation or import.
     */
    private linkedSnapshot;
    private discover;
    private find;
    private checked;
    listSkills(cwd?: string): Promise<SkillSummary[]>;
    readSkill(id: string, cwd?: string): Promise<SkillDetail>;
    private statePath;
    private loadState;
    private saveState;
    private mutation;
    setSkillEnabled(id: string, enabled: boolean, revision: string, cwd?: string): Promise<void>;
    deleteSkill(id: string, revision: string, cwd?: string): Promise<void>;
    listTrash(): Promise<TrashItem[]>;
    restoreSkill(id: string): Promise<void>;
    scanSkills(dir: string): Promise<ScannedSkill[]>;
    importSkills(items: ImportItem[]): Promise<ImportResult[]>;
}
//# sourceMappingURL=skills.d.ts.map