import { describe, it, expect, beforeEach } from 'vitest';
import {
    judgeQuote, contestsChange, resolveContestedChange, MOVE_LIMIT_PCT,
} from '../utils/quoteSanity.js';
import { recordSuspectQuote, getSuspectQuotes, resetSourceStats } from '../utils/sourceHealth.js';
import { buildSuspectView } from '../utils/dataSourceStatus.js';

/**
 * A terceira pergunta da cadeia de cotação. As duas primeiras — "chegou preço?" e
 * "de onde veio?" — já tinham dono. Faltava "o número faz sentido?", que é a
 * única cujo defeito não deixa rastro: cotação errada volta 200, datada, com
 * failCount zerado, e entra no ranking como se fosse boa.
 *
 * Os casos vêm da base real de 05/09/2026.
 */
describe('juiz de magnitude da cotação', () => {
    const hoje = new Date('2026-09-05T12:00:00.000Z');

    it('deixa passar o dia normal, sem inventar achado', () => {
        expect(judgeQuote({
            type: 'STOCK', price: 40, previousClose: 39.5, change: 1.2658,
            storedPrice: 39.5, storedPriceDate: '2026-09-04', now: hoje,
        })).toHaveLength(0);
    });

    // XPIN11 em 05/09/2026: 62,04 contra previousClose de 29,82, no mesmo payload.
    it('pega o salto contra o fechamento anterior da própria fonte', () => {
        const achados = judgeQuote({
            type: 'FII', price: 62.04, previousClose: 29.8159, change: 108.0769, now: hoje,
        });
        expect(achados.map((a) => a.code)).toContain('SALTO_NA_FONTE');
        expect(achados[0].movePct).toBeGreaterThan(100);
    });

    // NAUI11: preço idêntico ao anterior e change de 4,02% — a fonte se contradiz.
    it('pega a fonte que declara variação incompatível com os próprios preços', () => {
        const achados = judgeQuote({
            type: 'FII', price: 1000, previousClose: 1000, change: 4.021322, now: hoje,
        });
        expect(achados.map((a) => a.code)).toEqual(['VARIACAO_INCOERENTE']);
    });

    // O caso Seagate/Stacks: resposta coerente consigo mesma, sobre outro ativo.
    it('pega o preço distante do que estava no banco, com preço guardado recente', () => {
        const achados = judgeQuote({
            type: 'STOCK_US', price: 0.0028, previousClose: 0.0027, change: 3.7,
            storedPrice: 849.28, storedPriceDate: '2026-09-04', now: hoje,
        });
        expect(achados.map((a) => a.code)).toContain('SALTO_VS_BANCO');
    });

    // Sem isto a régua vira "variação do trimestre" e acusa o que é normal.
    it('não compara com preço guardado velho — sem base, não julga', () => {
        const achados = judgeQuote({
            type: 'STOCK', price: 40, previousClose: 39.8, change: 0.5,
            storedPrice: 20, storedPriceDate: '2026-06-01', now: hoje,
        });
        expect(achados.map((a) => a.code)).not.toContain('SALTO_VS_BANCO');
    });

    // O `change` do Yahoo em cripto são 24h CORRIDAS e o previousClose é do
    // fechamento: divergir é o comportamento correto dos dois campos.
    it('não cobra coerência de change em cripto', () => {
        const achados = judgeQuote({
            type: 'CRYPTO', price: 110000, previousClose: 108000, change: 5.2, now: hoje,
        });
        expect(achados.map((a) => a.code)).not.toContain('VARIACAO_INCOERENTE');
    });

    it('usa régua por classe: o mesmo salto acusa no FII e passa na cripto', () => {
        const entrada = { price: 130, previousClose: 100, change: 30, now: hoje };
        expect(judgeQuote({ ...entrada, type: 'FII' }).length).toBeGreaterThan(0);
        expect(judgeQuote({ ...entrada, type: 'CRYPTO' })).toHaveLength(0);
        expect(MOVE_LIMIT_PCT.CRYPTO).toBeGreaterThan(MOVE_LIMIT_PCT.FII);
    });

    it('preço ausente não é assunto daqui — quem responde é o caminho de falha', () => {
        expect(judgeQuote({ type: 'STOCK', price: 0, previousClose: 30, now: hoje })).toHaveLength(0);
    });
});

describe('registro de cotações suspeitas', () => {
    beforeEach(() => resetSourceStats());

    it('guarda uma linha por ativo e conta as repetições', () => {
        const evento = {
            subject: 'XPIN11',
            type: 'FII',
            source: 'YAHOO',
            price: 62.04,
            findings: [{ code: 'SALTO_NA_FONTE', detail: '+108%', movePct: 108 }],
        };
        recordSuspectQuote(evento);
        recordSuspectQuote(evento);
        const linhas = getSuspectQuotes();
        expect(linhas).toHaveLength(1);
        expect(linhas[0].count).toBe(2);
    });

    it('ignora evento sem achado — nada a dizer não vira linha', () => {
        recordSuspectQuote({ subject: 'PETR4', findings: [] });
        expect(getSuspectQuotes()).toHaveLength(0);
    });

    // Zero é notícia, e é a que a tela mais mostra: o total precisa existir e ser
    // exato mesmo quando não há uma linha sequer.
    it('a visão da tela é exata no total e limitada na lista', () => {
        for (let i = 0; i < 60; i += 1) {
            recordSuspectQuote({
                subject: `T${i}`,
                findings: [{ code: 'SALTO_NA_FONTE', detail: 'x', movePct: 50 }],
            });
        }
        const view = buildSuspectView(getSuspectQuotes());
        expect(view.total).toBe(60);
        expect(view.items.length).toBeLessThan(60);
        expect(view.items.length + view.truncated).toBe(60);
    });

    it('sem nada registrado, a visão afirma zero (e não some)', () => {
        expect(buildSuspectView(getSuspectQuotes())).toEqual({ total: 0, items: [], truncated: 0 });
    });
});

/**
 * O PREÇO FICA, A VARIAÇÃO NÃO.
 *
 * XPIN11 em 05/09/2026: preço 62,04 (bate com o fechamento oficial da B3 dentro
 * de 1%) e, na mesma resposta, `change` +108% com `previousClose` de 29,82 —
 * enquanto a NOSSA série mostrava 62,04 parado havia semanas. Descartar o preço
 * seria jogar fora o número certo; repetir a variação é servir o errado como
 * "variação de hoje" na carteira.
 */
describe('reancoragem da variação contestada', () => {
    const salto = [{ code: 'SALTO_NA_FONTE', detail: 'x', movePct: 108 }];
    const incoerente = [{ code: 'VARIACAO_INCOERENTE', detail: 'x', movePct: 0 }];
    const precoSuspeito = [{ code: 'SALTO_VS_BANCO', detail: 'x', movePct: -99 }];

    it('só os achados que falam da VARIAÇÃO contestam o par change/previousClose', () => {
        expect(contestsChange(salto)).toBe(true);
        expect(contestsChange(incoerente)).toBe(true);
        // Aqui quem está sob suspeita é o preço novo; o fechamento anterior da
        // fonte segue sendo o melhor palpite que existe.
        expect(contestsChange(precoSuspeito)).toBe(false);
        expect(contestsChange([])).toBe(false);
    });

    it('reancora no NOSSO fechamento: preço parado vira variação zero', () => {
        expect(resolveContestedChange({ price: 62.04, ownClose: 62.04 }))
            .toEqual({ change: 0, previousClose: 62.04 });
    });

    // O movimento real precisa sobreviver: só o que a fonte AFIRMA é descartado.
    it('reancora preservando o movimento que o nosso candle confirma', () => {
        const { change, previousClose } = resolveContestedChange({ price: 135, ownClose: 100 });
        expect(change).toBeCloseTo(35, 6);
        expect(previousClose).toBe(100);
    });

    // Repetir o número da fonte seria afirmar o que acabamos de contestar.
    it('sem candle nosso, a variação é zero e o fechamento anterior fica desconhecido', () => {
        expect(resolveContestedChange({ price: 62.04, ownClose: null }))
            .toEqual({ change: 0, previousClose: 0 });
        expect(resolveContestedChange({ price: 62.04, ownClose: 0 }))
            .toEqual({ change: 0, previousClose: 0 });
    });
});
