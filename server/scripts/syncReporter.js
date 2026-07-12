/**
 * syncReporter — camada de apresentação para o sync:prod (e scripts longos).
 *
 * Objetivo (pedido do produto):
 *   • TERMINAL minimalista: só etapa + progresso + resumo. Sem debug/warning,
 *     sem linha-a-cada-lote. Se algo falhar, aponta para o TXT.
 *   • TXT completo e bonito (server/logs/sync-report.txt), sobrescrito a cada
 *     run, com TUDO (info/warn/debug/error) indentado e dividido em duas partes:
 *     Parte 1 para humanos leigos, Parte 2 para IA/desenvolvedor.
 *
 * Como funciona: anexa um transport coletor ao winston (captura toda a saída,
 * inclusive debug) e SILENCIA o transport de console durante a run. As etapas
 * são impressas direto no stdout por este módulo — limpas e diretas.
 */
import fs from 'fs';
import path from 'path';
import util from 'util';
import Transport from 'winston-transport';
import logger from '../config/logger.js';

const RESERVED = new Set(['level', 'message', 'timestamp', 'stack', 'requestId']);
const CLR = String.fromCharCode(27) + '[K'; // ANSI: limpa até o fim da linha

// ── Formatação ────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

function clockOf(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function fmtDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec ? `${min}m${pad2(sec)}s` : `${min}m`;
}

function metaToText(meta) {
    const keys = Object.keys(meta || {}).filter((k) => !RESERVED.has(k));
    if (keys.length === 0) return '';
    const pairs = keys.map((k) => {
        const v = meta[k];
        return `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`;
    });
    return ` | ${pairs.join(' ')}`;
}

// ── Transport coletor (buffer em memória de TODOS os eventos) ──────────────
class CollectorTransport extends Transport {
    constructor(opts) {
        super(opts);
        this.entries = [];
        // Callback que devolve o índice da etapa ativa no instante do log — assim
        // cada evento pertence a EXATAMENTE uma etapa (sem sobreposição de janela).
        this.stageRef = opts.stageRef || (() => -1);
    }

    log(info, callback) {
        setImmediate(() => this.emit('logged', info));
        const { level, message, stack, ...rest } = info;
        this.entries.push({
            time: Date.now(),
            stageIdx: this.stageRef(),
            level: String(level),
            message: String(message ?? ''),
            meta: rest,
            stack: stack || null,
        });
        callback();
    }
}

// ── Reporter ───────────────────────────────────────────────────────────────
export function createSyncReporter({ reportFile, title = 'sync:prod' }) {
    const startedAt = new Date();
    const stages = []; // { idx, label, start, end, status, detail }
    let current = null;
    const collector = new CollectorTransport({
        level: 'debug',
        stageRef: () => (current ? current.idx : -1),
    });
    const isTTY = Boolean(process.stdout.isTTY);
    const RULE = '─'.repeat(56);

    let consoleTransport = null;
    let prevLevel = null;
    let fatal = null;
    let origConsole = null;

    const out = (s) => process.stdout.write(s);

    // Bibliotecas (ex.: yahoo-finance2) escrevem direto no console, driblando o
    // winston. Interceptamos console.* para jogar isso no TXT, mantendo o terminal
    // limpo. Não afeta a saída do próprio reporter (usa process.stdout.write via out()).
    function patchConsole() {
        const map = { log: 'info', info: 'info', warn: 'warn', error: 'error', debug: 'debug' };
        origConsole = {};
        for (const [fn, lvl] of Object.entries(map)) {
            origConsole[fn] = console[fn];
            console[fn] = (...args) => {
                const msg = args
                    .map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 2, breakLength: 120 })))
                    .join(' ');
                collector.log({ level: lvl, message: msg }, () => {});
            };
        }
    }
    function restoreConsole() {
        if (!origConsole) return;
        for (const [fn, orig] of Object.entries(origConsole)) console[fn] = orig;
        origConsole = null;
    }

    // status da etapa a partir dos eventos que pertencem a ela: 'ok' | 'warn'
    function stageStatus(idx) {
        const own = collector.entries.filter((e) => e.stageIdx === idx);
        if (own.some((e) => e.level === 'error' || e.level === 'warn')) return 'warn';
        return 'ok';
    }

    function begin() {
        prevLevel = logger.level;
        logger.level = 'debug'; // captura debug no TXT
        consoleTransport = logger.transports.find((t) => t.name === 'console');
        if (consoleTransport) consoleTransport.silent = true; // terminal limpo
        logger.add(collector);
        patchConsole(); // captura console.* de libs (yahoo-finance2 etc.)

        out(`\n  ${title} · Vértice\n`);
        out(`  ${startedAt.toISOString().slice(0, 10)} ${clockOf(startedAt)}\n`);
        out(`  ${RULE}\n\n`);
    }

    function stageLine(icon, label, dur) {
        const dots = '.'.repeat(Math.max(3, 30 - [...label].length));
        return `  ${icon} ${label} ${dots} ${dur}`;
    }

    async function runStage(label, fn, { critical = true } = {}) {
        current = { idx: stages.length, label, start: Date.now(), end: null, status: 'run', detail: null };
        stages.push(current);
        out(isTTY ? `  ▶ ${label} …` : `  ▶ ${label} …\n`);

        try {
            const res = await fn();
            current.end = Date.now();
            current.status = stageStatus(current.idx);
            const icon = current.status === 'warn' ? '⚠' : '✔';
            const text = stageLine(icon, label, fmtDuration(current.end - current.start));
            out(isTTY ? `\r${text}${CLR}\n` : `${text}\n`);
            current = null;
            return res;
        } catch (err) {
            current.end = Date.now();
            current.status = 'fail';
            const text = stageLine('✖', label, fmtDuration(current.end - current.start));
            out(isTTY ? `\r${text}  (erro — ver TXT)${CLR}\n` : `${text}  (erro — ver TXT)\n`);
            logger.error(`[${label}] ${err.message}`, { stage: label });
            current = null;
            if (critical) {
                fatal = err;
                throw err;
            }
            return null;
        }
    }

    // Anexa um detalhe curto à última etapa (ex.: "1.234 ativos").
    function detail(text) {
        if (stages.length) stages[stages.length - 1].detail = text;
    }

    function fatalError(err) {
        fatal = err;
    }

    function finish({ success }) {
        // Restaura logger e console antes de imprimir o resumo.
        restoreConsole();
        logger.remove(collector);
        if (consoleTransport) consoleTransport.silent = false;
        if (prevLevel) logger.level = prevLevel;

        const totalDur = fmtDuration(Date.now() - startedAt.getTime());
        const errs = collector.entries.filter((e) => e.level === 'error');
        const warns = collector.entries.filter((e) => e.level === 'warn');

        const overall = !success
            ? '✖ FALHOU'
            : errs.length
                ? '⚠ concluído com erros'
                : warns.length
                    ? '⚠ concluído com avisos'
                    : '✔ concluído';

        out(`\n  ${RULE}\n`);
        out(`  ${overall} em ${totalDur}   ·   ${warns.length} avisos   ·   ${errs.length} erros\n`);
        out(`  Relatório detalhado: ${path.relative(process.cwd(), reportFile)}\n`);
        out(`  ${RULE}\n\n`);

        try {
            writeReport({ success, totalDur, errs, warns });
        } catch (err) {
            out(`  (não foi possível gravar o TXT: ${err.message})\n`);
        }
    }

    // ── Geração do TXT ──────────────────────────────────────────────────────
    function collectNotFound() {
        const set = new Set();
        for (const e of collector.entries) {
            const m =
                e.message.match(/Quote not found for symbol:\s*([A-Za-z0-9.-]+)/) ||
                e.message.match(/Falhou\s+([A-Za-z0-9.-]+)\s*:/);
            if (m) set.add(m[1]);
        }
        return [...set];
    }

    function attentionPoints(errs, warns) {
        const points = [];
        // Remove emoji/símbolo de nível já embutido na mensagem para não duplicar.
        const clean = (m) => m.replace(/^[\s️\p{Extended_Pictographic}]+/u, '').trim();
        const dedup = (arr) => [...new Set(arr.map((e) => clean(e.message)))];

        for (const msg of dedup(errs)) points.push(`❌ ${msg}`);
        for (const msg of dedup(warns)) points.push(`⚠️  ${msg}`);

        const notFound = collectNotFound();
        if (notFound.length) {
            points.push(
                `⚠️  ${notFound.length} ativo(s) sem cotação na fonte (provável mudança de ` +
                `ticker ou saída de bolsa): ${notFound.join(', ')}`
            );
        }
        return points;
    }

    function entriesForStage(stage) {
        return collector.entries.filter((e) => e.stageIdx === stage.idx);
    }

    function fmtEntry(e, indent = '      ') {
        const t = clockOf(new Date(e.time));
        const lvl = e.level.toUpperCase().padEnd(5);
        let line = `${indent}${t}  ${lvl} ${e.message}${metaToText(e.meta)}`;
        if (e.stack) line += `\n${indent}  STACK: ${e.stack.split('\n').join(`\n${indent}  `)}`;
        return line;
    }

    function writeReport({ success, totalDur, errs, warns }) {
        const finishedAt = new Date();
        const L = [];
        const box = '═'.repeat(58);
        const SEP = '─'.repeat(64);

        L.push(`╔${box}╗`);
        L.push('║  RELATÓRIO DE SINCRONIZAÇÃO — VÉRTICE  (sync:prod)');
        L.push(`╚${box}╝`);
        L.push('');
        L.push(`Gerado em ....... ${finishedAt.toISOString().slice(0, 10)} ${clockOf(finishedAt)}`);
        L.push(`Duração total ... ${totalDur}`);
        L.push(
            `Resultado ....... ${!success ? '❌ FALHA' : errs.length ? '⚠️  SUCESSO COM ERROS' : warns.length ? '⚠️  SUCESSO COM AVISOS' : '✅ SUCESSO'}`
        );
        L.push('');

        // ── PARTE 1 — humanos ────────────────────────────────────────────────
        L.push(SEP);
        L.push('PARTE 1 — RESUMO PARA HUMANOS');
        L.push(SEP);
        L.push('');
        L.push('O que este processo faz: atualiza cotações e indicadores macro,');
        L.push('coleta os fundamentos das empresas e recalcula o ranking de');
        L.push('investimentos, o Radar Alpha e a auditoria de precisão.');
        L.push('');
        L.push('Etapas:');
        for (const s of stages) {
            const icon = s.status === 'fail' ? '❌' : s.status === 'warn' ? '⚠️ ' : '✅';
            const dur = fmtDuration((s.end || Date.now()) - s.start);
            const dots = '.'.repeat(Math.max(3, 34 - [...s.label].length));
            const extra = s.detail ? `   (${s.detail})` : '';
            L.push(`  ${icon} ${s.label} ${dots} ${dur.padStart(6)}${extra}`);
        }
        L.push('');

        const points = attentionPoints(errs, warns);
        L.push('Pontos de atenção (o que vale olhar):');
        if (points.length === 0) {
            L.push('  ✅ Nada exigiu atenção nesta execução.');
        } else {
            for (const p of points) L.push(`  • ${p}`);
        }
        L.push('');

        // ── PARTE 2 — IA / desenvolvedor ─────────────────────────────────────
        L.push(SEP);
        L.push('PARTE 2 — DETALHE TÉCNICO (para IA / desenvolvedor)');
        L.push(SEP);
        L.push('');

        const byLevel = collector.entries.reduce((acc, e) => {
            acc[e.level] = (acc[e.level] || 0) + 1;
            return acc;
        }, {});
        L.push('Contadores de log:');
        for (const lvl of ['error', 'warn', 'info', 'http', 'debug']) {
            if (byLevel[lvl]) L.push(`  ${lvl.padEnd(6)} : ${byLevel[lvl]}`);
        }
        L.push('');

        L.push(`[ERROS] (${errs.length})`);
        if (errs.length === 0) L.push('  (nenhum)');
        else for (const e of errs) L.push(fmtEntry(e, '  '));
        L.push('');

        L.push(`[AVISOS] (${warns.length})`);
        if (warns.length === 0) L.push('  (nenhum)');
        else for (const e of warns) L.push(fmtEntry(e, '  '));
        L.push('');

        L.push('[LOG COMPLETO POR ETAPA]');
        L.push('');
        for (const s of stages) {
            const icon = s.status === 'fail' ? '✖' : s.status === 'warn' ? '⚠' : '✔';
            const dur = fmtDuration((s.end || Date.now()) - s.start);
            const tail = '─'.repeat(Math.max(2, 30 - [...s.label].length));
            L.push(`  ── ${icon} ${s.label}  (${dur})${s.detail ? ` · ${s.detail}` : ''} ${tail}`);
            const entries = entriesForStage(s);
            if (entries.length === 0) L.push('      (sem log)');
            else for (const e of entries) L.push(fmtEntry(e));
            L.push('');
        }

        // Eventos fora de qualquer etapa (raro — entre etapas ou no encerramento).
        const orphans = collector.entries.filter((e) => e.stageIdx === -1);
        if (orphans.length) {
            L.push('  ── (fora das etapas) ──');
            for (const e of orphans) L.push(fmtEntry(e));
            L.push('');
        }

        if (fatal) {
            L.push('[ERRO FATAL]');
            L.push(`  ${fatal.stack || fatal.message}`);
            L.push('');
        }

        L.push(`Fim do relatório · ${finishedAt.toISOString()}`);
        L.push('');

        fs.writeFileSync(reportFile, L.join('\n'), 'utf8');
    }

    return { begin, runStage, detail, fatalError, finish };
}
