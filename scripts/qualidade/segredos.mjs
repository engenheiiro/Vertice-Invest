#!/usr/bin/env node
/**
 * Varredura de segredos.
 *   node scripts/qualidade/segredos.mjs --staged   (pre-commit: só o que vai entrar)
 *   node scripts/qualidade/segredos.mjs            (todo o repositório versionado)
 *
 * Mostra arquivo, linha e tipo — nunca o valor encontrado, que é justamente o
 * que não pode parar em log de terminal ou de CI.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { encontrarSegredos, ignorarNaVarredura } from './lib/segredos.mjs';
import { RAIZ, listarArquivos } from './lib/coleta.mjs';

const git = (args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const staged = process.argv.includes('--staged');

const arquivos = staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM']).split('\n').filter(Boolean)
  : listarArquivos();
// --staged lê a versão que vai entrar no commit (não a do disco, que pode ter
// mudado depois do `git add`); o modo completo lê o disco.
const conteudo = (f) => (staged ? git(['show', `:${f}`]) : fs.readFileSync(path.join(RAIZ, f), 'utf8'));

const achados = [];
for (const f of arquivos.filter((a) => !ignorarNaVarredura(a))) {
  let texto;
  try { texto = conteudo(f); } catch { continue; /* removido entre a listagem e a leitura */ }
  for (const a of encontrarSegredos(texto)) achados.push(`${f}:${a.linha} — ${a.tipo}`);
}

if (achados.length) {
  console.error(`✖ Possível segredo em ${achados.length} ponto(s):\n  ${achados.join('\n  ')}`);
  console.error('  Tire do commit e use variável de ambiente (.env, nunca versionado).');
  process.exit(1);
}
console.log(`✔ Segredos: nada encontrado em ${arquivos.length} arquivo(s).`);
