/**
 * (D10) "Build" do servidor.
 *
 * O backend é Node ESM puro (sem transpile/bundle), então o build é um GATE de
 * validação: roda `node --check` em todos os arquivos-fonte para garantir que
 * cada um compila (pega erro de sintaxe antes do deploy, não em runtime).
 * Falha com código !=0 se qualquer arquivo não compilar — pronto para CI.
 */
import { execFileSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', 'logs', 'coverage', '.git']);

const collect = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...collect(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
};

const files = collect(ROOT);
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    const detail = err.stderr ? err.stderr.toString() : err.message;
    console.error(`✗ ${path.relative(ROOT, file)}\n${detail}`);
  }
}

if (failed > 0) {
  console.error(`\n✗ Build do servidor falhou: ${failed} arquivo(s) com erro de sintaxe.`);
  process.exit(1);
}

console.log(`✓ Build do servidor OK — ${files.length} arquivos validados.`);
