/**
 * Relato do caminho do candle em carteira: ledger do painel de fontes e logs.
 * Não busca nem grava nada — só conta o desfecho que a busca já decidiu.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), escalation: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/sourceHealth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordEscalation: mocks.escalation,
}));
vi.mock('../services/b3DailyFileService.js', () => ({ fetchB3DailyCloses: vi.fn() }));

const { recordDayCandleChain, logDayCandleOutcome, logGapHealOutcome } = await import('../services/candles/walletCandleReport.js');

beforeEach(() => vi.clearAllMocks());

describe('recordDayCandleChain', () => {
  it('papel sem negócio vira ausência esperada; cripto tem trilha de um elo só', () => {
    recordDayCandleChain(
      [
        { ticker: 'KNRI11', type: 'FII', reason: 'sem série na fonte' },
        { ticker: 'BTC', type: 'CRYPTO', reason: 'erro na busca (x)' },
      ],
      { recuperados: new Set(), semNegocio: new Set(['KNRI11']) },
      '2026-09-08',
    );
    const [fii, btc] = mocks.escalation.mock.calls.map(([e]) => e);
    expect(fii).toMatchObject({ chain: 'candle', tried: ['yahoo.history', 'b3'], expected: true, session: '2026-09-08' });
    expect(fii.reason).toContain('não negociou em 2026-09-08');
    expect(btc).toMatchObject({ tried: ['yahoo.history'], resolvedBy: null, expected: false, reason: 'erro na busca (x)' });
  });

  it('quem a B3 socorreu sai resolvido por ela', () => {
    recordDayCandleChain([{ ticker: 'BOVA11', type: 'ETF', reason: 'r' }], { recuperados: new Set(['BOVA11']), semNegocio: new Set() }, 'd');
    expect(mocks.escalation.mock.calls[0][0].resolvedBy).toBe('b3');
  });
});

describe('logs', () => {
  it('candle do dia: warn só quando algum ativo ficou sem fechamento', () => {
    logDayCandleOutcome({ dayStr: 'd', pending: 1, fetched: 1, recuperados: new Set(), semCandle: [] });
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();

    logDayCandleOutcome({ dayStr: 'd', pending: 2, fetched: 0, recuperados: new Set(['A']), semCandle: [{ ticker: 'B', reason: 'r' }] });
    expect(mocks.info).toHaveBeenCalledTimes(3);
    expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ assets: ['B: r'] }));
  });

  it('varredura: distingue lacuna fechada de lacuna sem cobertura', () => {
    logGapHealOutcome('d', new Map([['X', ['d1', 'd2']]]), new Map());
    expect(mocks.info.mock.calls[0][1].assets).toEqual(['X: d1, d2']);
    logGapHealOutcome('d', new Map(), new Map([['Y', ['d3']]]));
    expect(mocks.info.mock.calls[1][0]).toContain('sem cobertura');
    expect(mocks.info.mock.calls[1][1].assets).toEqual(['Y: d3']);
  });
});
