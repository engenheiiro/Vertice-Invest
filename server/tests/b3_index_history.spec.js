/**
 * Série do IFIX pela B3. O defeito que isto substitui: a brapi (plano grátis)
 * recusava range 1y/5y com 400 e o IFIX saía nulo de todo backtest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const axios = (await import('axios')).default;
const { parseNumeroBr, parseAnoB3, getB3IndexSeries } = await import('../services/b3IndexHistoryService.js');

const linha = (day, valores) => ({ day, ...Object.fromEntries(valores.map((v, i) => [`rateValue${i + 1}`, v])) });

describe('parseNumeroBr', () => {
  it('lê o formato pt-BR e recusa vazio/zero', () => {
    expect(parseNumeroBr('3.876,65')).toBe(3876.65);
    expect(parseNumeroBr('980,1')).toBe(980.1);
    expect(parseNumeroBr(null)).toBeNull();
    expect(parseNumeroBr('')).toBeNull();
    expect(parseNumeroBr('0,00')).toBeNull();
  });
});

describe('parseAnoB3', () => {
  it('vira pontos ascendentes por data; dia sem pregão (nulo) não vira ponto', () => {
    const resposta = {
      results: [
        linha(2, ['3.100,00', null, '3.300,00']),
        linha(1, [null, '3.200,00', null]),
      ],
    };
    expect(parseAnoB3(resposta, 2025)).toEqual([
      { date: '2025-01-02', close: 3100 },
      { date: '2025-02-01', close: 3200 },
      { date: '2025-03-02', close: 3300 },
    ]);
  });

  it('dia que não existe no mês (31/02) é descartado em vez de rolar para março', () => {
    const resposta = { results: [linha(31, [null, '9.999,00'])] };
    expect(parseAnoB3(resposta, 2025)).toEqual([]);
  });

  it('resposta vazia ou malformada não explode', () => {
    expect(parseAnoB3(null, 2025)).toEqual([]);
    expect(parseAnoB3({}, 2025)).toEqual([]);
  });
});

describe('getB3IndexSeries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T12:00:00-03:00'));
    axios.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('busca um ano por chamada, com timeout, e corta antes de `desde`', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { results: [linha(30, [null, null, null, null, null, null, null, null, null, null, null, '3.000,00'])] } })
      .mockResolvedValueOnce({ data: { results: [linha(5, ['3.050,00', '3.080,00'])] } });
    const serie = await getB3IndexSeries('IFIX', '2025-12-01', new Date());
    expect(serie).toEqual([
      { date: '2025-12-30', close: 3000 },
      { date: '2026-01-05', close: 3050 },
      { date: '2026-02-05', close: 3080 },
    ]);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][1]).toEqual({ timeout: 15000 });
    const payload = JSON.parse(Buffer.from(axios.get.mock.calls[0][0].split('/').pop(), 'base64').toString());
    expect(payload).toEqual({ index: 'IFIX', language: 'pt-br', year: '2025' });
  });

  it('um ano que falha derruba a série (null), nunca devolve série com buraco', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { results: [linha(2, ['3.000,00'])] } })
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(getB3IndexSeries('IFIX', '2025-01-01', new Date())).resolves.toBeNull();
  });
});
