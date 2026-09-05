/**
 * REPARO DO CANDLE DIÁRIO DA CRIPTO PELAS BARRAS HORÁRIAS.
 *
 * Nasceu de 04/09/2026: o Yahoo publicou a barra DIÁRIA de BTC, ETH e USDC com
 * `close: null` enquanto as horárias do mesmo dia estavam lá (23 de 24 válidas,
 * a última às 22:00Z). Ação e FII têm o arquivo da B3 para esse caso; cripto não
 * tem arquivo nenhum.
 *
 * O que estes testes protegem é o LIMITE da aproximação. Aceitar barra horária
 * como fechamento é uma concessão consciente, e ela só se sustenta enquanto os
 * dois guardas estiverem de pé: cobertura do dia e última barra no fim do dia.
 * Sem eles, uma queda da fonte às 10h viraria "fechamento" das 10h — que é pior
 * que o buraco, porque entra na série parecendo dado bom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalMarketService, HOURLY_MIN_BARS } from '../services/externalMarketService.js';
import { calendarWindowDays, missingCalendarDays, previousUtcDay } from '../services/cryptoCandleRepairService.js';

const yahoo = vi.hoisted(() => ({ chart: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class {
    chart(...args) { return yahoo.chart(...args); }
  },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/errorLogService.js', () => ({ recordIngestionError: vi.fn() }));

/** Dia completo de barras horárias; `ate` é a última hora COM preço. */
const diaHorario = (dia, { ate = 23, base = 100 } = {}) => Array.from({ length: 24 }, (_, h) => ({
  date: new Date(`${dia}T${String(h).padStart(2, '0')}:00:00.000Z`),
  close: h <= ate ? base + h : null,
  volume: 10,
}));

beforeEach(() => vi.clearAllMocks());

describe('fetchDailyCloseFromHourly', () => {
  it('deriva o fechamento da última barra válida do dia', async () => {
    // O caso real: 23 barras boas, a das 23:00Z nula.
    yahoo.chart.mockResolvedValue({ quotes: diaHorario('2026-09-04', { ate: 22 }) });

    const r = await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04');

    expect(r).toEqual({ date: '2026-09-04', close: 122, volume: 240 });
  });

  // O volume do dia é a SOMA das horas. Gravar a fatia da última hora
  // subestimaria o dia em ~24x, e volume alimenta o filtro dos sinais.
  it('soma o volume das horas em vez de copiar o da última', async () => {
    yahoo.chart.mockResolvedValue({ quotes: diaHorario('2026-09-04') });

    const r = await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04');

    expect(r.volume).toBe(240);
  });

  it('recusa quando a última barra válida não está no fim do dia', async () => {
    // Fonte caiu às 10h: 11 barras boas, e a última é do meio do dia.
    yahoo.chart.mockResolvedValue({ quotes: diaHorario('2026-09-04', { ate: 10 }) });

    expect(await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04')).toBeNull();
  });

  it('recusa quando o dia tem poucas barras, mesmo com a última no fim', async () => {
    const esparso = diaHorario('2026-09-04').filter((c, i) => i >= 22 || i < 2);
    yahoo.chart.mockResolvedValue({ quotes: esparso });

    expect(esparso.length).toBeLessThan(HOURLY_MIN_BARS);
    expect(await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04')).toBeNull();
  });

  // O Yahoo entrega a barra viva ALÉM do period2, e ela é do dia seguinte:
  // deixá-la entrar faria o "fechamento de ontem" ser o preço de agora.
  it('ignora barras que não pertencem ao dia pedido', async () => {
    yahoo.chart.mockResolvedValue({
      quotes: [...diaHorario('2026-09-04', { ate: 22 }), ...diaHorario('2026-09-05', { ate: 3, base: 900 })],
    });

    const r = await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04');

    expect(r.close).toBe(122);
  });

  it('dia inteiro nulo devolve null em vez de inventar fechamento', async () => {
    yahoo.chart.mockResolvedValue({ quotes: diaHorario('2026-09-04', { ate: -1 }) });

    expect(await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04')).toBeNull();
  });

  it('erro da fonte e data inválida devolvem null', async () => {
    yahoo.chart.mockRejectedValue(new Error('fetch failed'));
    expect(await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', '2026-09-04')).toBeNull();

    expect(await externalMarketService.fetchDailyCloseFromHourly('BTC-USD', 'ontem')).toBeNull();
    expect(await externalMarketService.fetchDailyCloseFromHourly('', '2026-09-04')).toBeNull();
  });
});

describe('janela de varredura', () => {
  it('anda em dias CORRIDOS — cripto não pula fim de semana', () => {
    // 05 e 06/09/2026 são sábado e domingo: numa régua de dia útil eles sumiriam
    // da janela, e dois buracos legítimos por semana ficariam fora do radar.
    expect(calendarWindowDays('2026-09-07', 5)).toEqual([
      '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07',
    ]);
  });

  it('vira o mês e o ano sem depender do fuso da máquina', () => {
    expect(previousUtcDay('2026-09-01')).toBe('2026-08-31');
    expect(previousUtcDay('2026-01-01')).toBe('2025-12-31');
  });

  it('acha o buraco no MEIO da janela, não só na ponta', () => {
    // É o caso que faz este serviço existir: quando o candle de 05 chega, a ponta
    // se fecha por cima do buraco de 04 e ele sumiria de uma régua de atraso.
    const datas = ['2026-09-03', '2026-09-05', '2026-09-06', '2026-09-07'];

    expect(missingCalendarDays(datas, '2026-09-07', 5)).toEqual(['2026-09-04']);
  });

  it('não pede dias anteriores ao início da série', () => {
    // Ativo listado ontem não tem buraco na semana passada; pedir seria gastar
    // chamada para receber "não existe".
    expect(missingCalendarDays(['2026-09-06', '2026-09-07'], '2026-09-07', 5)).toEqual([]);
  });

  it('série vazia não vira 5 buscas inúteis', () => {
    expect(missingCalendarDays([], '2026-09-07', 5)).toEqual([]);
  });
});
