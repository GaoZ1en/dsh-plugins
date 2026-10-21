/** Authenticated, loopback-only JSON adapter. All operations live in ManagerService. */
import type { IncomingMessage } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { type ManagerService } from './service.ts';
export interface RouteDeps {
    service: Pick<ManagerService, 'execute'>;
    requestRejection: (request: {
        headers: IncomingMessage['headers'];
    }) => 401 | 403 | undefined;
}
export declare function makeRoute(deps: RouteDeps): WebRoute;
//# sourceMappingURL=routes.d.ts.map