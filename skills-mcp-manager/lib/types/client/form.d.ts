import type { McpServerConfig } from '../protocol.ts';
import type { Translate } from './locales.ts';
export interface McpForm {
    id?: string;
    revision?: number;
    name: string;
    transport: 'stdio' | 'streamable-http';
    enabled: boolean;
    command: string;
    args: string;
    cwd: string;
    url: string;
    envRefs: string;
    headerRefs: string;
}
export declare const emptyForm: () => McpForm;
export declare function refsText(refs?: Record<string, string>): string;
/** Pure wire-payload builder shared by Save and Test. Host validates reference syntax and paths. */
export declare function buildMcpServer(form: McpForm, t: Translate): McpServerConfig;
//# sourceMappingURL=form.d.ts.map