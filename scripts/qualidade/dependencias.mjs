#!/usr/bin/env node
/**
 * Etapa "dependências" do check completo: npm audit + npm outdated nos três
 * manifestos (raiz, client, server). Grava .qualidade/deps.json para a
 * catraca. Precisa de rede; sem ela os números saem nulos e o check completo
 * acusa "não medido" — nunca um zero inventado.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { contarMajorAtras } from './lib/medidas.mjs';
import { RAIZ, PASTA_ARTEFATOS } from './lib/coleta.mjs';

const PARTES = ['.', 'client', 'server'];

function npmJson(args, cwd) {
  // npm audit/outdated saem com 1 quando encontram algo: o JSON vem mesmo assim.
  const r = spawnSync('npm', [...args, '--json'], { cwd, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout || 'null'); } catch { return null; }
}

function medirParte(parte) {
  const cwd = path.join(RAIZ, parte);
  const audit = npmJson(['audit'], cwd);
  const outdated = npmJson(['outdated'], cwd);
  const v = audit?.metadata?.vulnerabilities;
  return {
    parte,
    vulnAltas: v ? v.high + v.critical : null,
    moderadas: v ? v.moderate : null,
    depsMajorAtras: outdated ? contarMajorAtras(outdated) : null,
  };
}

const partes = PARTES.map(medirParte);
const somar = (campo) => (partes.some((p) => p[campo] === null) ? null : partes.reduce((a, p) => a + p[campo], 0));
const resumo = { vulnAltas: somar('vulnAltas'), depsMajorAtras: somar('depsMajorAtras'), partes };

fs.mkdirSync(PASTA_ARTEFATOS, { recursive: true });
fs.writeFileSync(path.join(PASTA_ARTEFATOS, 'deps.json'), `${JSON.stringify(resumo, null, 2)}\n`);
for (const p of partes) {
  const v = (n) => n ?? '—';
  console.log(`${p.parte.padEnd(7)} altas/críticas ${v(p.vulnAltas)} · moderadas ${v(p.moderadas)} · >1 major atrás ${v(p.depsMajorAtras)}`);
}
process.exit(resumo.vulnAltas === null ? 1 : 0);
