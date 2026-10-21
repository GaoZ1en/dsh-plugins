/** koishi's maintained Skills & MCP Manager; no global prompt injection. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { ManagerService } from './service.ts';
export declare const name = "koishi-skills-mcp-manager";
export declare const inject: string[];
export interface Config {
    stateDir?: string;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    stateDir: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    stateDir: z<string, string, "defined">;
}>>, "plain">;
declare module '@deepseek-ai/cordis' {
    interface Context {
        koishiSkillsMcpManager: ManagerService;
    }
}
/** Keep tool results bounded; the UI still receives complete lists. */
export declare function boundedValue(value: unknown): unknown;
export declare function apply(ctx: Context, config?: Config): Promise<void>;
//# sourceMappingURL=index.d.ts.map