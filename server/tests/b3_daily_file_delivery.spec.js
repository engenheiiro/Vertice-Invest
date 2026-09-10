/**
 * O ARQUIVO NÃO PUBLICADO NÃO É ENTREGA DA B3.
 *
 * `downloadDay` aceita 400/404 no `validateStatus` de propósito: a B3 recusa o
 * pedido do token quando o pregão ainda está em apuração, e isso não é exceção de
 * rede. Só que o `trackSource` que envolve a chamada não recebia `isEmpty`, então
 * a recusa entrava como CHAMADA COM DADO — o card da fonte ficava calmo no dia em
 * que o arquivo faltava.
 *
 * Não é hipótese: em 09/09/2026 o arquivo não estava no ar às 18:30, ~584 séries
 * do universo ficaram sem o fechamento do pregão, e o painel mostrava a B3 sem uma
 * única falha ao lado da linha vermelha da própria cadeia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('axios', () => ({ default: { get: (...a) => mocks.get(...a) } }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { clearB3Memo, fetchB3DailyCloses } = await import('../services/b3DailyFileService.js');
const { getSourceStats, resetSourceStats } = await import('../utils/sourceHealth.js');

const b3 = () => getSourceStats().find((s) => s.id === 'b3');

const CAB = 'RptDt;TckrSymb;ISIN;SgmtNm;MinPric;MaxPric;TradAvrgPric;LastPric;OscnPctg;AdjstdQt;AdjstdQtTax;RefPric;TradQty;FinInstrmQty;NtlFinVol';
const linha = (dia) => `${dia};ITSA4;BRITSAACNPR7;CASH;12,81;12,98;12,9;12,95;0,85;;;;25153;14850800;191244935`;
const csv = (dia) => ['Status do Arquivo: Final', CAB, linha(dia)].join('\n');

/** 400 sem `redirectUrl` — a resposta real da B3 para pregão ainda não publicado. */
const semArquivo = { status: 400, data: {} };

beforeEach(() => {
    resetSourceStats();
    clearB3Memo();
    mocks.get.mockReset();
});

afterEach(() => { clearB3Memo(); });

describe('entrega do arquivo diário da B3', () => {
    it('pregão não publicado em dia útil conta como NÃO-entrega', async () => {
        mocks.get.mockResolvedValue(semArquivo);

        // 2026-09-09 é uma quarta-feira.
        const closes = await fetchB3DailyCloses('2026-09-09');

        expect(closes).toBeNull();
        expect(b3().ok).toBe(0);
        expect(b3().failures).toBe(1);
    });

    it('arquivo entregue conta como entrega', async () => {
        mocks.get.mockImplementation(async (url) => (
            String(url).includes('token=')
                ? { status: 200, data: csv('2026-09-09') }
                : { status: 200, data: { redirectUrl: 'https://b3/download?token=abc123' } }
        ));

        const closes = await fetchB3DailyCloses('2026-09-09');

        expect(closes.get('ITSA4').close).toBe(12.95);
        expect(b3().ok).toBe(1);
        expect(b3().failures).toBe(0);
    });

    it('resposta 200 sem token no corpo também é não-entrega', async () => {
        // O endpoint mudou de formato e ninguém avisou: 200, corpo sem
        // `redirectUrl`. Medir pelo STATUS daria entrega; medir pelo token, não.
        mocks.get.mockResolvedValue({ status: 200, data: { mensagem: 'ok' } });

        expect(await fetchB3DailyCloses('2026-09-09')).toBeNull();
        expect(b3().failures).toBe(1);
    });

    it('sábado pedido por script não acusa a B3', async () => {
        // A régua vale para DIA ÚTIL. Num sábado o 400 é a resposta certa da
        // fonte, e marcá-la de amarelo por isso seria o alarme falso que este
        // módulo inteiro existe para evitar. Produção nem chega aqui (os dias
        // saem de `missingBusinessDays`/`businessWindowDays`) — quem chega é o
        // backfill manual.
        mocks.get.mockResolvedValue(semArquivo);

        expect(await fetchB3DailyCloses('2026-09-12')).toBeNull();
        expect(b3().failures).toBe(0);
        expect(b3().ok).toBe(1);
    });
});
