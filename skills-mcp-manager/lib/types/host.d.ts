/** Version-pinned DSH adapters. The engines themselves do not import the SDK. */
import type { Context } from '@deepseek-ai/cordis';
import type { McpHandle } from './mcp.ts';
import type { McpServerConfig, McpServerSummary, WorkspaceItem } from './protocol.ts';
export declare function workspaces(ctx: Context): WorkspaceItem[];
export declare function policyWorkspace(ctx: Context, cwd?: string): string | undefined;
export declare function nativeServers(ctx: Context): Promise<McpServerSummary[]>;
export declare function connectMcp(ctx: Context, config: McpServerConfig, resolved: {
    env: Record<string, string>;
    headers: Record<string, string>;
    signal?: AbortSignal;
}, probe: boolean): Promise<McpHandle>;
//# sourceMappingURL=host.d.ts.map