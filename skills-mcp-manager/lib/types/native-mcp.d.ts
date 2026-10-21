/** Native MCP enablement delegates exclusively to the public profile lifecycle API. */
import type { Context } from '@deepseek-ai/cordis';
/** Only these two public methods are needed; tests need no profile or real plugin manager. */
export interface NativeMcpContext {
    pluginManager?: Pick<Context['pluginManager'], 'listPlugins' | 'setPluginEnabled'>;
}
export declare function listToggleableNativeIds(ctx: NativeMcpContext): Promise<Set<string>>;
export declare function setNativeMcpEnabled(ctx: NativeMcpContext, id: string, enabled: boolean): Promise<void>;
//# sourceMappingURL=native-mcp.d.ts.map