export interface SkillPolicyRule {
    name: string;
    cwd?: string;
    enabled: boolean;
}
export interface SkillPolicySnapshot {
    revision: number;
    rules: SkillPolicyRule[];
}
export declare class SkillPolicyStore {
    private readonly stateDir;
    private current;
    private diskHash;
    private readonly listeners;
    constructor(options: {
        stateDir: string;
    });
    private path;
    private ordered;
    private ready;
    private observe;
    /** Startup read only: absent policy is revision zero and creates no files or directories. */
    load(): Promise<void>;
    snapshot(): SkillPolicySnapshot;
    isEnabled(name: string, cwd?: string): boolean;
    subscribe(listener: () => void): () => void;
    private notify;
    setEnabled(name: string, enabled: boolean, expectedRevision: number, cwd?: string): Promise<void>;
}
//# sourceMappingURL=skill-policy.d.ts.map