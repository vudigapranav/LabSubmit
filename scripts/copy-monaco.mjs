// Copies the Monaco editor build into public/ so the exam IDE is served by LabSubmit itself.
// @monaco-editor/react otherwise downloads Monaco from cdn.jsdelivr.net at runtime: on a lab
// network that blocks or throttles that CDN, the editor never leaves "Loading..." and no
// student can write code. Runs before `next build` and `npm run dev`; the copy is gitignored.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// Located directly: monaco-editor's `exports` map does not expose package.json to require.resolve.
const pkgDir = path.join(process.cwd(), 'node_modules', 'monaco-editor');
const version = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
const from = path.join(pkgDir, 'min', 'vs');
const to = path.join(process.cwd(), 'public', 'monaco', 'vs');
if (!existsSync(path.join(from, 'loader.js'))) {
  console.error(`[copy-monaco] ${from} has no AMD loader.js; cannot self-host Monaco.`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`[copy-monaco] Monaco served from /monaco/vs (${version})`);
