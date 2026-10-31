/**
 * VEREDITO DO sync:prod — etapa que FALHOU ≠ etapa INCOMPLETA.
 *
 * No run de 22/08/2026 a etapa de séries temporais parou em 570/1300 ativos por
 * queda de conexão, mas voltou normalmente (o worker captura o erro). No
 * relatório ela ficou com o mesmo ⚠ de "Cotações & mercado", que só tinha usado
 * o fallback do Google para 3 tickers — e o processo saiu com código 0, como um
 * run limpo. Quem lê o TXT não tinha como separar "o pipeline parou", "entregou
 * menos do que devia" e "teve um aviso à toa".
 *
 * Três níveis, três códigos de saída: 0 ok · 1 falhou · 2 incompleto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createSyncReporter } = await import('../scripts/syncReporter.js');
const logger = (await import('../config/logger.js')).default;

let reportFile;
let writeSpy;

const readReport = () => fs.readFileSync(reportFile, 'utf8');

const novoReporter = () => {
    const reporter = createSyncReporter({ reportFile, title: 'teste' });
    reporter.begin();
    return reporter;
};

describe('syncReporter — níveis de veredito', () => {
    beforeEach(() => {
        reportFile = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), 'vertice-sync-')), 'sync-report.txt');
        // O reporter escreve o resumo direto no stdout; silenciamos para não
        // sujar a saída do vitest.
        writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
    });

    it('run limpo sai com 0', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Etapa boa', async () => {});
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(0);
        expect(readReport()).toContain('✅ SUCESSO');
    });

    it('aviso operacional continua sendo apenas aviso — sai com 0', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Cotações & mercado', async () => {
            logger.warn('⚠️ [MarketService] Yahoo falhou para 1 ativos: [EA]. Tentando Google...');
        });
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(0);
        expect(verdict.incomplete).toEqual([]);
        expect(readReport()).toContain('SUCESSO COM AVISOS');
    });

    it('etapa que voltou COM ERRO é rotulada INCOMPLETA e sai com 2', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Cotações & mercado', async () => {
            logger.warn('⚠️ [MarketService] Yahoo falhou para 1 ativos: [EA].');
        });
        // Exatamente o caso real: o worker captura, loga e retorna.
        await reporter.runStage('Séries temporais', async () => {
            logger.error("❌ [TimeSeriesWorker] Erro após 570/1300 ativos: Socket 'secureConnect' timed out");
        });
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(2);
        expect(verdict.incomplete).toEqual(['Séries temporais']);

        const txt = readReport();
        expect(txt).toContain('❗ CONCLUÍDO COM ETAPA(S) INCOMPLETA(S)');
        expect(txt).toContain('Etapas incompletas .... Séries temporais');
        expect(txt).toContain('Código de saída . 2');
        // A etapa incompleta e a etapa só-com-aviso não podem ter o mesmo rótulo.
        expect(txt).toMatch(/❗ Séries temporais .*INCOMPLETA/);
        expect(txt).not.toMatch(/Cotações & mercado .*INCOMPLETA/);
    });

    it('etapa crítica que LANÇOU sai com 1 e aparece separada das incompletas', async () => {
        const reporter = novoReporter();
        await expect(reporter.runStage('Conexão com o banco', async () => {
            throw new Error('connection <monitor> to 89.192.9.78:27017 closed');
        })).rejects.toThrow();
        const verdict = reporter.finish({ success: false });

        expect(verdict.exitCode).toBe(1);
        const txt = readReport();
        expect(txt).toContain('❌ FALHA');
        expect(txt).toContain('Etapas que falharam ... Conexão com o banco');
    });

    it('erro logado FORA de qualquer etapa não deixa o run passar por limpo', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Etapa boa', async () => {});
        logger.error('❌ [Algo] estourou entre as etapas');
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(2);
        expect(verdict.incomplete).toEqual([]); // nenhuma etapa é dona do erro
        expect(readReport()).toContain('CONCLUÍDO COM ERROS (fora das etapas)');
    });

    it('alerta de performance do backtest não torna a etapa incompleta', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Auditoria de precisão', async () => {
            logger.warn('🚨 [Backtest] ALERTA: PETR4 (STOCK) caiu -22.09% (enquanto publicado)');
        });
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(0);
        expect(readReport()).toContain('com alertas de performance');
    });
});

// 30/10/2026: a rotina das 18:30 ficou órfã de um deploy, a sentinela rodou no
// fim da coleta e o seu ERROR deixou "Cotações & mercado" INCOMPLETA — uma etapa
// que tinha coletado tudo. Estado do host ≠ resultado da etapa.
describe('syncReporter — saúde do sistema fora do veredito das etapas', () => {
    beforeEach(() => {
        reportFile = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), 'vertice-sync-')), 'sync-report.txt');
        writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
    });

    const terminal = () => writeSpy.mock.calls.map(([s]) => String(s)).join('');
    const criticoOrfao = () => logger.error(
        '[DataHealth] CRITICAL — 1 crítico(s), 0 alerta(s), 71 ok (2551ms)',
        {
            trigger: 'SYNC',
            healthStatus: 'CRITICAL',
            failing: ['CRITICAL jobs.daily-evening — Última execução há 4.7h — falhou: Execução órfã'],
        },
    );

    it('CRITICAL da sentinela não deixa a etapa incompleta nem muda o código de saída', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Cotações & mercado', async () => { criticoOrfao(); });
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(0);
        expect(verdict.incomplete).toEqual([]);
        const txt = readReport();
        expect(txt).not.toMatch(/Cotações & mercado .*INCOMPLETA/);
        expect(txt).toContain('Saúde do sistema  CRITICAL');
        expect(txt).toContain('[SAÚDE DO SISTEMA] (CRITICAL)');
    });

    it('nomeia o check que está fora, no terminal e no TXT', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Cotações & mercado', async () => { criticoOrfao(); });
        reporter.finish({ success: true });

        expect(terminal()).toContain('Saúde do sistema: CRITICAL');
        expect(terminal()).toContain('jobs.daily-evening');
        expect(readReport()).toContain('• CRITICAL jobs.daily-evening — Última execução há 4.7h');
    });

    it('falha ao AVALIAR a saúde continua sendo erro de etapa', async () => {
        const reporter = novoReporter();
        await reporter.runStage('Cotações & mercado', async () => {
            logger.error('❌ [DataHealth] Falha ao avaliar saúde dos dados: Cannot read properties of undefined');
        });
        const verdict = reporter.finish({ success: true });

        expect(verdict.exitCode).toBe(2);
        expect(verdict.incomplete).toEqual(['Cotações & mercado']);
    });

    it('a data do cabeçalho é a do mesmo fuso do relógio', async () => {
        vi.useFakeTimers();
        // 22:18 em Brasília = 01:18 UTC do dia seguinte.
        vi.setSystemTime(new Date('2026-10-31T01:18:04.000Z'));
        try {
            const reporter = novoReporter();
            await reporter.runStage('Etapa boa', async () => {});
            reporter.finish({ success: true });
        } finally {
            vi.useRealTimers();
        }
        const agora = new Date('2026-10-31T01:18:04.000Z');
        const p = (n) => String(n).padStart(2, '0');
        const esperado = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())} `
            + `${p(agora.getHours())}:${p(agora.getMinutes())}`;
        expect(terminal()).toContain(esperado);
        expect(readReport()).toContain(`Gerado em ....... ${esperado}`);
    });
});
