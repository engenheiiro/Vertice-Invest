/**
 * Casamento entre o nosso provento e o calendário da fonte.
 *
 * Trava as três coisas que decidem se uma data importada é confiável:
 *  1) o deslocamento entre ex-date (Yahoo) e "última data com" (B3/Fundamentus);
 *  2) o teto honesto — pagamento dividido em datas diferentes NÃO vira data;
 *  3) a evidência fraca (só data) só é aceita quando o chamador declara que o
 *     nosso valor é aproximado.
 *
 * Os casos vêm da medição de 09/09/2026 contra a base real, e não de exemplo
 * inventado: PETR4, CMIG4, SHUL4 e GGRC11 são os que quebraram a regra ingênua.
 */
import { describe, it, expect } from 'vitest';
import { matchPaymentDate, DESFECHO, EVIDENCIA } from '../utils/dividendPaymentMatch.js';

const dia = (iso) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const fonte = (dataCom, dataPagamento, valor) => ({
    dataCom: dia(dataCom),
    dataPagamento: dataPagamento ? dia(dataPagamento) : null,
    valor,
});

describe('matchPaymentDate — o caso limpo', () => {
    // GGRC11: data-com 01/09/2026 (terça), ex-date 02/09, pagamento 09/09. É o
    // evento que motivou tudo — a tela exibia 16/09 (ex+15).
    it('casa ex-date com data-com + 1 pregão e devolve a data oficial', () => {
        const r = matchPaymentDate(
            { date: dia('2026-09-02'), amount: 0.1 },
            [fonte('2026-09-01', '2026-09-09', 0.1)],
        );
        expect(r.desfecho).toBe(DESFECHO.CASADO);
        expect(iso(r.dataPagamento)).toBe('2026-09-09');
        expect(r.evidencia).toBe(EVIDENCIA.VALOR_E_DATA);
    });

    it('casa por cima do fim de semana: data-com na sexta, ex-date na segunda', () => {
        // +3 dias corridos, que na medição real são 34% dos casamentos — é a
        // mesma regra de +1 pregão, não uma exceção.
        const r = matchPaymentDate(
            { date: dia('2026-09-07'), amount: 0.45 },
            [fonte('2026-09-04', '2026-09-15', 0.45)],
        );
        expect(r.desfecho).toBe(DESFECHO.CASADO);
        expect(iso(r.dataPagamento)).toBe('2026-09-15');
    });

    it('tolera divergência de arredondamento entre fontes', () => {
        // O mesmo pagamento vem 0,109829 de uma fonte e 0,109744 de outra.
        const r = matchPaymentDate(
            { date: dia('2026-09-02'), amount: 0.109829 },
            [fonte('2026-09-01', '2026-09-09', 0.109744)],
        );
        expect(r.desfecho).toBe(DESFECHO.CASADO);
    });

    it('ignora pagamento distante da ex-date', () => {
        const r = matchPaymentDate(
            { date: dia('2026-09-02'), amount: 0.1 },
            [fonte('2026-08-01', '2026-08-10', 0.1)],
        );
        expect(r.desfecho).toBe(DESFECHO.SEM_EVENTO);
    });
});

describe('matchPaymentDate — o Yahoo agrega o que a fonte separa', () => {
    it('reconhece nosso evento como SOMA de um subconjunto, quando todos pagam no mesmo dia', () => {
        // Um DIVIDENDO + um JCP na mesma data-com, ambos pagos em 20/05.
        const r = matchPaymentDate(
            { date: dia('2026-04-23'), amount: 0.6262 },
            [
                fonte('2026-04-22', '2026-05-20', 0.3131),
                fonte('2026-04-22', '2026-05-20', 0.3131),
            ],
        );
        expect(r.desfecho).toBe(DESFECHO.CASADO);
        expect(iso(r.dataPagamento)).toBe('2026-05-20');
        expect(r.evidencia).toBe(EVIDENCIA.SOMA_E_DATA);
    });

    it('CMIG4: soma 2 dos 3 pagamentos publicados, e recusa porque as datas divergem', () => {
        // Caso real de 26/12/2025. Nosso valor é exatamente 2 × 0,11840131614;
        // esses dois pagam em 30/06/2027 e 30/12/2027. Não existe "a" data.
        const r = matchPaymentDate(
            { date: dia('2025-12-26'), amount: 0.236803 },
            [
                fonte('2025-12-23', '2027-06-30', 0.11840131614),
                fonte('2025-12-23', '2027-12-30', 0.11840131614),
                fonte('2025-12-23', '2027-06-30', 0.1458748316),
            ],
        );
        expect(r.desfecho).toBe(DESFECHO.AMBIGUO);
        expect(r.dataPagamento).toBeUndefined();
    });

    it('PETR4: dois pagamentos do mesmo valor em datas diferentes não viram data', () => {
        const r = matchPaymentDate(
            { date: dia('2026-06-02'), amount: 0.70097272 },
            [
                fonte('2026-06-01', '2026-08-20', 0.35048636),
                fonte('2026-06-01', '2026-09-21', 0.35048636),
            ],
        );
        expect(r.desfecho).toBe(DESFECHO.AMBIGUO);
        expect(r.datas).toEqual(expect.arrayContaining(['2026-08-20', '2026-09-21']));
    });

    it('vários pagamentos iguais no MESMO dia continuam sendo uma resposta só', () => {
        const r = matchPaymentDate(
            { date: dia('2026-06-02'), amount: 0.35048636 },
            [
                fonte('2026-06-01', '2026-08-20', 0.35048636),
                fonte('2026-06-01', '2026-08-20', 0.35048636),
            ],
        );
        expect(r.desfecho).toBe(DESFECHO.CASADO);
        expect(iso(r.dataPagamento)).toBe('2026-08-20');
    });
});

describe('matchPaymentDate — evidência fraca é opcional e estreita', () => {
    const nosso = { date: dia('2026-09-02'), amount: 0.815 };
    const publicado = [fonte('2026-09-01', '2026-09-09', 0.66)];

    it('sem permissão, valor que não bate NÃO vira data', () => {
        const r = matchPaymentDate(nosso, publicado);
        expect(r.desfecho).toBe(DESFECHO.VALOR_DIVERGENTE);
    });

    it('com permissão, um único pagamento no dia exato vira data marcada como fraca', () => {
        // É o provento PROVISÓRIO: o valor vem do gap do dia-ex e é aproximado
        // por construção. Sem esta porta, os eventos mais recentes — os que a
        // tela mostra como "a receber" — nunca seriam datados.
        const r = matchPaymentDate(nosso, publicado, { permitirSoData: true });
        expect(r.desfecho).toBe(DESFECHO.CASADO);
        expect(r.evidencia).toBe(EVIDENCIA.SO_DATA);
        expect(iso(r.dataPagamento)).toBe('2026-09-09');
    });

    it('a permissão NÃO vale quando há mais de um pagamento por perto', () => {
        const r = matchPaymentDate(nosso, [
            fonte('2026-09-01', '2026-09-09', 0.66),
            fonte('2026-09-01', '2026-10-09', 0.30),
        ], { permitirSoData: true });
        expect(r.desfecho).not.toBe(DESFECHO.CASADO);
    });

    it('a permissão NÃO vale fora do dia exato, mesmo dentro da folga', () => {
        // Data-com 31/08 → ex-date esperada 01/09. Nossa ex-date é 02/09: cai na
        // folga de 3 dias, mas não é o dia exato, então a evidência fraca não vale.
        const r = matchPaymentDate(nosso, [fonte('2026-08-31', '2026-09-09', 0.66)], { permitirSoData: true });
        expect(r.desfecho).toBe(DESFECHO.VALOR_DIVERGENTE);
    });
});

describe('matchPaymentDate — entradas degeneradas', () => {
    it('lista vazia devolve SEM_EVENTO', () => {
        expect(matchPaymentDate({ date: dia('2026-09-02'), amount: 1 }, []).desfecho).toBe(DESFECHO.SEM_EVENTO);
    });

    it('pagamento sem data publicada devolve SEM_DATA, não uma data nula', () => {
        const r = matchPaymentDate(
            { date: dia('2026-09-02'), amount: 0.1 },
            [fonte('2026-09-01', null, 0.1)],
        );
        expect(r.desfecho).toBe(DESFECHO.SEM_DATA);
        expect(r.dataPagamento).toBeUndefined();
    });

    it('evento sem ex-date não casa com nada', () => {
        expect(matchPaymentDate({ amount: 1 }, [fonte('2026-09-01', '2026-09-09', 1)]).desfecho)
            .toBe(DESFECHO.SEM_EVENTO);
    });

    it('data-com ausente na fonte é descartada em vez de virar hoje', () => {
        const r = matchPaymentDate(
            { date: dia('2026-09-02'), amount: 0.1 },
            [{ dataCom: null, dataPagamento: dia('2026-09-09'), valor: 0.1 }],
        );
        expect(r.desfecho).toBe(DESFECHO.SEM_EVENTO);
    });
});
