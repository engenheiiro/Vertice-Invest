import { describe, it, expect, beforeEach } from 'vitest';
import {
    judgeQuote, contestsChange, resolveContestedChange, MOVE_LIMIT_PCT,
    effectiveMoveLimit, arbitrateStoredJump, applyStoredJumpArbitration,
    isSettledFinding, needsOwnAnchor,
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
        expect(buildSuspectView(getSuspectQuotes())).toEqual({ total: 0, settled: 0, items: [], truncated: 0 });
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

/**
 * O candle é gravado com a precisão do provedor (62,040000915527344 para um
 * preço de 62,04), então preço PARADO produz -0,0000015% — que a tela mostra
 * como "-0,00%". O sinal de menos sugere uma queda que não houve.
 */
describe('reancoragem — ruído de ponto flutuante', () => {
    it('preço parado contra candle float não vira zero negativo', () => {
        const { change } = resolveContestedChange({ price: 62.04, ownClose: 62.040000915527344 });
        expect(change).toBe(0);
        expect(Object.is(change, -0)).toBe(false);
    });

    it('variação de verdade abaixo de meio centésimo continua sendo zero', () => {
        expect(resolveContestedChange({ price: 100.004, ownClose: 100 }).change).toBe(0);
    });

    it('mas a primeira variação exibível é preservada', () => {
        expect(resolveContestedChange({ price: 100.01, ownClose: 100 }).change).toBeCloseTo(0.01, 6);
    });
});

/**
 * ── PAPEL DE CENTAVOS ────────────────────────────────────────────────────────
 *
 * PMAM3 disparou o alarme em 04/09/2026 com +39,13% (0,23 → 0,32) sendo que o
 * tique da B3 ali é R$ 0,01 — 4,3% do preço. A série mostrava 0,13 → 0,14 →
 * 0,15 → 0,16 → 0,17 → 0,19 → 0,23 → 0,32: alta real, contada em tiques miúdos.
 */
describe('régua de magnitude em papel abaixo de R$ 1,00', () => {
    const hoje = new Date('2026-09-07T12:00:00.000Z');

    it('afrouxa quando o tique domina o denominador', () => {
        // 10 tiques sobre 0,23 valem 43,5% — acima dos 30% da classe.
        expect(effectiveMoveLimit('STOCK', 0.23)).toBeCloseTo(43.48, 1);
    });

    it('não muda nada a partir de R$ 1,00', () => {
        expect(effectiveMoveLimit('STOCK', 1)).toBe(30);
        expect(effectiveMoveLimit('STOCK', 42)).toBe(30);
        expect(effectiveMoveLimit('FII', 100)).toBe(20);
    });

    it('desaparece sozinha conforme o preço sobe (0,90 já não precisa dela)', () => {
        expect(effectiveMoveLimit('STOCK', 0.9)).toBe(30);
    });

    it('tem teto: dobrar de preço num dia merece o olho em qualquer preço', () => {
        expect(effectiveMoveLimit('STOCK', 0.02)).toBe(100);
    });

    it('não vale para ação americana nem cripto — outro tique, outro artefato', () => {
        expect(effectiveMoveLimit('STOCK_US', 0.2)).toBe(35);
        expect(effectiveMoveLimit('CRYPTO', 0.2)).toBe(50);
    });

    it('PMAM3 (0,23 → 0,32) deixa de ser acusado', () => {
        expect(judgeQuote({
            type: 'STOCK', price: 0.32, previousClose: 0.23, change: 39.13,
            storedPrice: 0.23, storedPriceDate: '2026-09-03', now: hoje,
        })).toHaveLength(0);
    });

    it('mas um papel de centavos que TRIPLICA continua sendo acusado', () => {
        const achados = judgeQuote({
            type: 'STOCK', price: 0.69, previousClose: 0.23, change: 200, now: hoje,
        });
        expect(achados.map((f) => f.code)).toContain('SALTO_NA_FONTE');
    });

    it('o alívio é do DENOMINADOR, não do ativo: papel caro segue na régua da classe', () => {
        const achados = judgeQuote({
            type: 'STOCK', price: 60, previousClose: 40, change: 50, now: hoje,
        });
        expect(achados.map((f) => f.code)).toContain('SALTO_NA_FONTE');
    });
});

/**
 * ── QUEM ESTAVA ERRADO: O PREÇO NOVO OU O GUARDADO? ──────────────────────────
 *
 * Os dois casos são reais, de 07/09/2026, e nos dois o alarme apontava para o
 * número CERTO: RBRL11 acusado de sair de 58,45 (que é o preço do RBHG11, e não
 * aparece em nenhum dos nossos 400 candles) e STX acusado de sair de 0,28 (o
 * Stacks, enquanto a série sempre foi da Seagate).
 */
describe('arbitragem do salto contra o banco', () => {
    it('RBRL11 — a série confirma o preço novo; o guardado é que era intruso', () => {
        expect(arbitrateStoredJump({
            type: 'FII', price: 73.91, storedPrice: 58.45, ownClose: 73.54,
        })).toBe('NOVO_CONFIRMADO');
    });

    it('STX — mesma conclusão com a ordem de grandeza toda errada', () => {
        expect(arbitrateStoredJump({
            type: 'STOCK_US', price: 849.28, storedPrice: 0.28, ownClose: 798.61,
        })).toBe('NOVO_CONFIRMADO');
    });

    it('quando a série sustenta o guardado, o suspeito é mesmo o preço novo', () => {
        expect(arbitrateStoredJump({
            type: 'STOCK', price: 300, storedPrice: 40, ownClose: 41,
        })).toBe('GUARDADO_CONFIRMADO');
    });

    it('sem candle nosso não há árbitro, e acusar sem prova é o que se evita', () => {
        expect(arbitrateStoredJump({
            type: 'FII', price: 73.91, storedPrice: 58.45, ownClose: null,
        })).toBeNull();
    });

    it('os dois longe do candle é inconclusivo — o candle também pode estar velho', () => {
        expect(arbitrateStoredJump({
            type: 'STOCK', price: 300, storedPrice: 40, ownClose: 150,
        })).toBeNull();
    });

    it('os dois perto do candle: não havia salto de verdade a julgar', () => {
        expect(arbitrateStoredJump({
            type: 'STOCK', price: 41, storedPrice: 40, ownClose: 40.5,
        })).toBeNull();
    });

    it('a frase do achado passa a dizer o que a série provou', () => {
        const achados = judgeQuote({
            type: 'FII', price: 73.91, previousClose: 73.54, change: 0.5,
            storedPrice: 58.45, storedPriceDate: '2026-09-04',
            now: new Date('2026-09-07T12:00:00.000Z'),
        });
        const arbitrados = applyStoredJumpArbitration(achados, {
            verdict: 'NOVO_CONFIRMADO', ownClose: 73.54, ownCloseDate: '2026-09-03',
        });
        const salto = arbitrados.find((f) => f.code === 'SALTO_VS_BANCO');
        expect(salto.arbitration).toBe('NOVO_CONFIRMADO');
        expect(salto.detail).toMatch(/confirma o preço NOVO/);
        expect(isSettledFinding(salto)).toBe(true);
    });

    it('sem veredito a lista volta intocada — nada é afirmado à toa', () => {
        const achados = [{ code: 'SALTO_VS_BANCO', detail: 'x', movePct: 30 }];
        expect(applyStoredJumpArbitration(achados, { verdict: null })).toBe(achados);
    });

    it('a procedência do preço guardado entra na frase quando é conhecida', () => {
        const [salto] = judgeQuote({
            type: 'FII', price: 73.91, storedPrice: 58.45, storedPriceDate: '2026-09-04',
            storedPriceSource: 'FUNDAMENTUS', now: new Date('2026-09-07T12:00:00.000Z'),
        });
        expect(salto.detail).toMatch(/guardado via FUNDAMENTUS/);
    });

    it('o desempate só é buscado quando há candle a buscar', () => {
        expect(needsOwnAnchor([{ code: 'SALTO_VS_BANCO' }])).toBe(true);
        expect(needsOwnAnchor([{ code: 'VARIACAO_INCOERENTE' }])).toBe(true);
        expect(needsOwnAnchor([])).toBe(false);
    });
});
