// Acceptance ONLY; not installed in the normal worker release or selected by CLI.
import { runOnce } from './worker.mjs';
const result = await runOnce({ processor() { throw Error('SYNTHETIC_UNEXPECTED_DO_NOT_LOG'); } });
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
