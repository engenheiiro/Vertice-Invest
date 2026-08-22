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
