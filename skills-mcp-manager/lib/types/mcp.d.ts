import type { McpList, McpServerConfig, McpServerSummary } from './protocol.ts';
export interface McpHandle {
    dispose(): Promise<void>;
    toolCount(): number;
}
export interface McpManagerOptions {
    stateDir: string;
    resolveCredential: (ref: string) => Promise<string | undefined>;
    nativeServers: () => Promise<McpServerSummary[]>;
    /** Public profile lifecycle adapter; never copies or rewrites a native server configuration. */
    nativeSetEnabled?: (id: string, enabled: boolean) => Promise<void>;
    /** Must abort/dispose its scope when signal aborts, including during initial connection. */
    connect: (config: McpServerConfig, resolved: {
        env: Record<string, string>;
        headers: Record<string, string>;
        signal?: AbortSignal;
    }, probe: boolean) => Promise<McpHandle>;
    legacyPath?: string;
    connectTimeoutMs?: number;
}
export declare class McpManagerError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Validation never includes untrusted config or credential values in error messages. */
export declare function normalizeMcpServer(input: McpServerConfig): McpServerConfig;
export declare function validateMcpServer(input: unknown): string | null;
export declare class McpManager {
    private readonly target;
    private readonly lock;
    private readonly live;
    private readonly probes;
    private readonly probeTasks;
    private readonly pendingCleanup;
    private queue;
    private disposed;
    private readonly timeout;
    private readonly opts;
    constructor(opts: McpManagerOptions);
    private serial;
    private active;
    private readDocument;
    private natives;
    list(): Promise<McpList>;
    private locked;
    private writeDocument;
    private mutate;
    save(input: McpServerConfig, revision: number): Promise<void>;
    setEnabled(id: string, enabled: boolean, revision: number): Promise<void>;
    delete(id: string, revision: number): Promise<void>;
    reload(): Promise<void>;
    private resolveRefs;
    private awaitCleanup;
    private connection;
    private stop;
    private sync;
    testConnect(input: McpServerConfig, signal?: AbortSignal): Promise<{
        ok: boolean;
        error?: string;
    }>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=mcp.d.ts.map