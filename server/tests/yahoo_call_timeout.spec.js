/**
 * TODA CHAMADA AO YAHOO LEVA RELÓGIO — invariante de arquivo, não de execução.
 *
 * O defeito que este teste tranca não aparece em teste funcional: ele é a
 * AUSÊNCIA de um argumento numa chamada nova. O câmbio ganhou teto em 04/09/2026
 * e as outras nove chamadas do arquivo continuaram sem; em 13, 14 e 15/09/2026 a
 * rotina 'daily-morning' travou numa delas — três execuções abertas para sempre,
 * cada uma segurando na memória tudo o que tinha carregado, num processo de
 * 512 MB. Uma décima chamada sem teto reabre exatamente isso.
 *
 * O circuit breaker não substitui o teto: ele conta ERROS, e uma resposta que
 * nunca chega não é erro nenhum — não abre circuito, não entra em retry, não
 * vira log. Fica.
 *
 * Fora do escopo daqui: `usStocksFundamentalsService`, que resolve o mesmo
 * problema por outro caminho (`Promise.race` com TICKER_TIMEOUT_MS em cada
 * chamada). Se aquele arquivo passar a chamar o Yahoo direto, traga-o para cá.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = path.resolve(__dirname, '../services/externalMarketService.js');

// Janela de busca a partir do início da chamada: cobre as maiores (chart com
// objeto de query em várias linhas) com folga.
const JANELA = 500;

describe('externalMarketService — teto de tempo nas chamadas ao Yahoo', () => {
    const fonte = fs.readFileSync(ARQUIVO, 'utf8');
    const chamadas = [...fonte.matchAll(/yahooFinance\.(chart|quote|quoteSummary|search)\(/g)];

    it('o arquivo ainda chama o Yahoo (o teste não virou tautologia)', () => {
        expect(chamadas.length).toBeGreaterThanOrEqual(10);
    });

    it('nenhuma chamada sai sem `comTeto`', () => {
        const semTeto = chamadas
            .filter((m) => !fonte.slice(m.index, m.index + JANELA).includes('comTeto('))
            .map((m) => {
                const linha = fonte.slice(0, m.index).split('\n').length;
                return `${m[0]} na linha ${linha}`;
            });

        expect(semTeto).toEqual([]);
    });

    it('o helper monta um AbortSignal e preserva as opções de quem chama', async () => {
        const { comTeto } = await import('../services/externalMarketService.js');
        const opcoes = comTeto(1234, { validateResult: false });
        expect(opcoes.validateResult).toBe(false);
        expect(opcoes.fetchOptions.signal).toBeInstanceOf(AbortSignal);
        expect(opcoes.fetchOptions.signal.aborted).toBe(false);
    });
});
