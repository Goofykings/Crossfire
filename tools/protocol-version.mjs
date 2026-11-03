import { readFileSync } from 'node:fs';
// Read the single production version; test clients cannot drift from TypeScript.
export const PROTOCOL_VERSION = Number(readFileSync(new URL('../shared/protocol.ts', import.meta.url), 'utf8').match(/PROTOCOL_VERSION = (\d+)/)[1]);
