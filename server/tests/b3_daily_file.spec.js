/**
 * Arquivo diário da B3 — segunda fonte para o fechamento do pregão.
 *
 * O Yahoo publica a linha do dia com `close` nulo sem aviso (7 ETFs em 27/08/2026;
 * 661 séries de ação/FII/ETF na sexta 28/08/2026) e o buraco é definitivo. O
 * arquivo da B3 traz o mercado inteiro numa requisição — mas é um CSV de terceiro,
 * com vírgula decimal e ~129 mil das ~135 mil linhas sendo opções. Todo o risco de
 * formato mora no parser, e é ele que estes testes prendem.
 */
import { describe, expect, it } from 'vitest';
import { parseB3Number, parseB3TradeFile } from '../services/b3DailyFileService.js';
import { businessWindowDays, missingBusinessDays, missingDaysInWindow } from '../services/walletDayCandleService.js';

const CAB = 'RptDt;TckrSymb;ISIN;SgmtNm;MinPric;MaxPric;TradAvrgPric;LastPric;OscnPctg;AdjstdQt;AdjstdQtTax;RefPric;TradQty;FinInstrmQty;NtlFinVol';
const arquivo = (linhas, status = 'Status do Arquivo: Final') => [status, CAB, ...linhas].join('\n');

// Linhas reais do arquivo de 28/08/2026.
const ITSA4 = '2026-08-28;ITSA4;BRITSAACNPR7;CASH;12,81;12,98;12,9;12,95;0,85;;;;25153;14850800;191244935';
const BOVA11 = '2026-08-28;BOVA11;BRBOVACTF003;CASH;171,11;173,69;172,24;172,72;0,18;;;;66570;3751418;639099966,69';
const OPCAO = '2026-08-28;ITSAH125;BRITSAACNPR7;EQUITY CALL;0,5;0,6;0,55;0,58;1,2;;;;10;1000;580';
const TERMO = '2026-08-28;03BK11;BR03BKCTF019;FORWARD;50,69;50,78;50,73;50,69;-0,11;;;;2;2;101,47';

describe('parseB3Number', () => {
  it('lê a vírgula decimal e o ponto de milhar', () => {
    expect(parseB3Number('12,95')).toBe(12.95);
    expect(parseB3Number('1.987.872.034')).toBe(1987872034);
    expect(parseB3Number('639.099.966,69')).toBe(639099966.69);
  });

  it('campo vazio ou não-numérico é ausência, não zero', () => {
    expect(parseB3Number('')).toBeNull();
    expect(parseB3Number(null)).toBeNull();
    expect(parseB3Number('n/d')).toBeNull();
  });
});

describe('parseB3TradeFile', () => {
  it('extrai o fechamento do à vista', () => {
    const closes = parseB3TradeFile(arquivo([ITSA4, BOVA11]), '2026-08-28');
    expect(closes.get('ITSA4').close).toBe(12.95);
    expect(closes.get('BOVA11').close).toBe(172.72);
  });

  it('volume é a QUANTIDADE negociada, não o número de negócios', () => {
    // A convenção do Yahoo (e da nossa série) é quantidade. Trocar as colunas
    // faria a liquidez do ETF cair por ~600x sem nenhum erro visível.
    const closes = parseB3TradeFile(arquivo([ITSA4]), '2026-08-28');
    expect(closes.get('ITSA4').volume).toBe(14850800);
    expect(closes.get('ITSA4').trades).toBe(25153);
  });

  it('descarta opção e termo — só o segmento à vista', () => {
    const closes = parseB3TradeFile(arquivo([ITSA4, OPCAO, TERMO]), '2026-08-28');
    expect([...closes.keys()]).toEqual(['ITSA4']);
  });

  it('descarta linha de outra data', () => {
    const outroDia = ITSA4.replace('2026-08-28', '2026-08-27');
    const closes = parseB3TradeFile(arquivo([ITSA4, outroDia]), '2026-08-28');
    expect(closes.size).toBe(1);
    expect(closes.get('ITSA4').close).toBe(12.95);
  });

  it('recusa arquivo que não está Final', () => {
    // Preço preliminar entraria numa série que a gente grava para não revisitar.
    expect(parseB3TradeFile(arquivo([ITSA4], 'Status do Arquivo: Parcial'), '2026-08-28')).toBeNull();
  });

  it('lê o cabeçalho por NOME — a ordem das colunas é da B3', () => {
    const cabTrocado = 'TckrSymb;RptDt;SgmtNm;LastPric;FinInstrmQty;TradQty';
    const linha = 'ITSA4;2026-08-28;CASH;12,95;14850800;25153';
    const closes = parseB3TradeFile(['Status do Arquivo: Final', cabTrocado, linha].join('\n'), '2026-08-28');
    expect(closes.get('ITSA4')).toEqual({ close: 12.95, volume: 14850800, trades: 25153 });
  });

  it('cabeçalho sem as colunas essenciais devolve null em vez de lixo', () => {
    const closes = parseB3TradeFile(['Status do Arquivo: Final', 'A;B;C', 'x;y;z'].join('\n'), '2026-08-28');
    expect(closes).toBeNull();
  });

  it('preço zerado não vira candle', () => {
    const semPreco = ITSA4.replace(';12,95;', ';0;');
    expect(parseB3TradeFile(arquivo([semPreco]), '2026-08-28')).toBeNull();
  });

  it('entrada vazia não quebra', () => {
    expect(parseB3TradeFile('', '2026-08-28')).toBeNull();
    expect(parseB3TradeFile(null, '2026-08-28')).toBeNull();
  });
});

/**
 * 2026: 27/08 = quinta · 28/08 = sexta · 29 e 30 = fim de semana · 31/08 = segunda.
 */
describe('missingBusinessDays', () => {
  it('devolve a lacuna inteira, não só o dia pedido', () => {
    // Empurrar só o candle de hoje numa série parada na quinta deixaria o buraco
    // de sexta E faria isHistoryStale ver a série como fresca — o defeito que
    // congelou 21 séries em 30/08/2026.
    expect(missingBusinessDays('2026-08-27', '2026-08-31')).toEqual(['2026-08-28', '2026-08-31']);
  });

  it('pula fim de semana', () => {
    expect(missingBusinessDays('2026-08-28', '2026-08-31')).toEqual(['2026-08-31']);
  });

  it('dia pedido em fim de semana não tem pregão para preencher', () => {
    expect(missingBusinessDays('2026-08-27', '2026-08-29')).toEqual([]);
  });

  it('série já com o dia não pede nada', () => {
    expect(missingBusinessDays('2026-08-31', '2026-08-31')).toEqual([]);
  });

  it('sem série guardada, só o dia pedido — o histórico é trabalho do worker', () => {
    expect(missingBusinessDays(null, '2026-08-31')).toEqual(['2026-08-31']);
  });

  it('respeita o teto e devolve os dias mais recentes, em ordem', () => {
    const dias = missingBusinessDays('2026-01-02', '2026-08-31', 5);
    expect(dias).toEqual(['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31']);
  });
});

/**
 * A janela existe porque a ponta engana: quando o candle do dia seguinte chega,
 * a série volta a parecer em dia com o buraco lá dentro (BOVA11 e IVVB11 em
 * 02/09/2026, e antes disso 27 e 28/08).
 */
describe('missingDaysInWindow', () => {
  it('enxerga o buraco no MEIO da série, que a régua da ponta não vê', () => {
    const guardadas = ['2026-08-27', '2026-08-28', '2026-08-31', '2026-09-02'];
    // Série termina em 02/09 — para missingBusinessDays não falta nada.
    expect(missingBusinessDays('2026-09-02', '2026-09-02')).toEqual([]);
    // 01/09 (terça) está faltando no meio.
    expect(missingDaysInWindow(guardadas, '2026-09-02')).toEqual(['2026-09-01']);
  });

  it('cobra o dia da ponta como qualquer outro', () => {
    expect(missingDaysInWindow(['2026-08-31', '2026-09-01'], '2026-09-02')).toEqual(['2026-09-02']);
  });

  it('série completa na janela não pede nada', () => {
    const cheia = ['2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02'];
    expect(missingDaysInWindow(cheia, '2026-09-02')).toEqual([]);
  });

  it('não cobra pregão anterior ao candle mais antigo — ativo comprado ontem', () => {
    expect(missingDaysInWindow(['2026-09-01'], '2026-09-02')).toEqual(['2026-09-02']);
  });

  it('série sem candle na janela não é buraco, é assunto do worker', () => {
    expect(missingDaysInWindow([], '2026-09-02')).toEqual([]);
  });

  it('dia final sem pregão não abre janela', () => {
    expect(missingDaysInWindow(['2026-08-28'], '2026-08-30')).toEqual([]); // domingo
    expect(businessWindowDays('2026-08-30')).toEqual([]);
  });

  it('a janela é de dias ÚTEIS e termina no dia pedido', () => {
    expect(businessWindowDays('2026-09-02')).toEqual([
      '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
  });
});
