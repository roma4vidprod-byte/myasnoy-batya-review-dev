import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push(path);
  }
}
for (const directory of ['api', 'lib', 'scripts', 'test', 'tools/yandex-cookie-metadata']) walk(resolve(root, directory));
let checked = 0;
for (const file of files) {
  if (/\.(?:m?js)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`Syntax check failed: ${relative(root, file)}`);
      process.exit(1);
    }
    checked += 1;
  } else if (/\.json$/.test(file)) {
    JSON.parse(readFileSync(file, 'utf8'));
    checked += 1;
  } else if (/\.ps1$/.test(file)) {
    // Parse only; never execute an operator script or read its process keys.
    const quoted = file.replaceAll("'", "''");
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      `$tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tokens,[ref]$errors); if($errors.Count){exit 1}`], {encoding:'utf8'});
    if (result.status !== 0) {
      console.error(`PowerShell parse failed: ${relative(root,file)}`);
      process.exit(1);
    }
    checked += 1;
  }
}
for (const file of ['package.json', 'vercel.json']) JSON.parse(readFileSync(resolve(root, file), 'utf8'));
// Parse inline scripts without executing browser code, credentials or API calls.
for (const file of readdirSync(root).filter(file => file.endsWith('.html'))) {
  const html = readFileSync(resolve(root, file), 'utf8');
  for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json|application\/json/i.test(attributes) || !source.trim()) continue;
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`Inline script syntax check failed: ${file}`);
      process.exit(1);
    }
    checked += 1;
  }
}
console.log(`PASS: ${checked} source/fixture/inline-script checks; configuration JSON valid. No code executed or network called.`);
