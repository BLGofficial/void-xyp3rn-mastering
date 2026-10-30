import type { Server } from 'node:http';

/** Serve a static export directory on 127.0.0.1 (port 0 = any free port). */
export function serve(root: string, port?: number): Promise<Server>;
