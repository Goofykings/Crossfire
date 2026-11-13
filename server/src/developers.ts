/** Verified server guest capability hashes, never display names or browser UUIDs.
 * Invalid entries fail closed. This list is server configuration only. */
export function developerAccounts(config=''):string[]{return [...new Set(config.split(',').map(s=>s.trim()).filter(s=>/^[a-f0-9]{64}$/.test(s)))];}
export const isDeveloper=(identity:string|undefined,config?:string):boolean=>!!identity&&developerAccounts(config).includes(identity);
