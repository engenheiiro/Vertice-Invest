import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordEscalation,
    getEscalations,
    getSourceStats,
    resetSourceStats,
} from '../utils/sourceHealth.js';
import { buildEscalationView, buildSourceStatuses } from '../utils/dataSourceStatus.js';

/**
 * O LEDGER POR ATIVO nasceu da lacuna que sobrou do painel de fontes: ele dizia
 * "a Brapi está instável — 80 chamadas, 24 sem dado" e parava aí. Quais ativos
 * chegaram até ela, ninguém sabia. E os dois diagnósticos por trás daquele número
 * pedem ações opostas: 24 ativos diferentes falhando é fonte degradada; o mesmo
 * papel morto tentado 24 vezes é ticker para aposentar.
 */

const cadeiaCompleta = (subject, resolvedBy, extra = {}) => recordEscalation({
    chain: 'quotes',
    subject,
    tried: ['yahoo.quotes', 'google.finance', 'brapi'],
    resolvedBy,
    reason: 'O Yahoo não trouxe o preço deste ativo',
    ...extra,
});

describe('ledger de escaladas', () => {
    beforeEach(() => resetSourceStats());

    it('guarda o caminho completo, incluindo a fonte principal que falhou', () => {
        cadeiaCompleta('PETR4', 'brapi');
        const [ev] = getEscalations();
        expect(ev.tried).toEqual(['yahoo.quotes', 'google.finance', 'brapi']);
        expect(ev.resolvedBy).toBe('brapi');
    });

    // Sem isto, um ticker morto tentado a cada 15 minutos empurraria todo o resto
    // para fora do teto em duas horas: a lista viraria a mesma linha repetida.
    it('repetição atualiza a MESMA linha e conta as ocorrências', () => {
        cadeiaCompleta('EURP11', null);
        cadeiaCompleta('EURP11', null);
        cadeiaCompleta('EURP11', null);
        expect(getEscalations()).toHaveLength(1);
        expect(getEscalations()[0].count).toBe(3);
    });

    it('escalada é registro de ATIVO, não de chamada — não mexe nos contadores da fonte', () => {
        cadeiaCompleta('PETR4', 'brapi');
        expect(getSourceStats().find((s) => s.id === 'brapi').attempts).toBe(0);
    });

    it('ignora evento sem cadeia ou sem assunto', () => {
        recordEscalation({ chain: 'quotes', subject: '', tried: ['yahoo.quotes'] });
        recordEscalation({ chain: '', subject: 'PETR4', tried: ['yahoo.quotes'] });
        expect(getEscalations()).toHaveLength(0);
    });
});

describe('cruzamento do ledger com as fontes', () => {
    const stats = () => [
        { id: 'yahoo.quotes', short: 'Yahoo', chain: 'quotes', schedule: { kind: 'minutes', at: [0] } },
        { id: 'google.finance', short: 'Google', chain: 'quotes', schedule: { kind: 'onFailure' } },
        { id: 'brapi', short: 'Brapi', chain: 'quotes', schedule: { kind: 'onFailure' } },
        { id: 'coinbase', short: 'Coinbase', chain: 'fx', schedule: { kind: 'onFailure' } },
    ];

    beforeEach(() => resetSourceStats());

    it('conta, por fonte, quem chegou / quem ela salvou / quem passou direto', () => {
        cadeiaCompleta('PETR4', 'brapi');
        recordEscalation({ chain: 'quotes', subject: 'NGRD3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance' });
        cadeiaCompleta('EURP11', null);

        const { bySource } = buildEscalationView(getEscalations(), stats());

        // A principal aparece em todas as escaladas: é o que permite ao card do
        // Yahoo dizer em quantos ativos ELE não entregou.
        //
        // `orphaned` é o subconjunto de `missed` que NINGUÉM salvou, e é o que
        // separa "esta fonte falhou onde a seguinte deu conta" de "o ativo não
        // negocia mais". Só EURP11 é órfão aqui — PETR4 saiu pela Brapi e NGRD3
        // pelo Google, então nesses dois a falha é mesmo da fonte.
        expect(bySource.get('yahoo.quotes')).toEqual({ reached: 3, rescued: 0, missed: 3, orphaned: 1 });
        expect(bySource.get('google.finance')).toEqual({ reached: 3, rescued: 1, missed: 2, orphaned: 1 });
        expect(bySource.get('brapi')).toEqual({ reached: 2, rescued: 1, missed: 1, orphaned: 1 });
    });

    it('resume a cadeia com o "sem preço" contado à parte', () => {
        cadeiaCompleta('PETR4', 'brapi');
        cadeiaCompleta('EURP11', null);
        recordEscalation({ chain: 'quotes', subject: 'B3SA3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance', expected: true });

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.total).toBe(3);
        expect(chains.quotes.unresolved).toBe(1);
        expect(chains.quotes.expected).toBe(1);
        // Ordem da cadeia, com o "ninguém" no fim — a leitura natural da frase.
        expect(chains.quotes.byResolver.map((r) => r.id)).toEqual(['google.finance', 'brapi', null]);
    });

    // A lista tem teto de transporte; o que sobra tem que ser o menos importante.
    it('lista quem ficou sem preço PRIMEIRO', () => {
        cadeiaCompleta('AAAA3', 'google.finance');
        cadeiaCompleta('BBBB3', 'google.finance');
        cadeiaCompleta('ZZZZ11', null);

        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.quotes.items[0].subject).toBe('ZZZZ11');
    });

    // Zero afirma que nada escalou; ausência admite que não medimos. Uma cadeia
    // sem instrumentação não tem direito à primeira afirmação.
    it('só cria resumo para cadeia com ledger — a de câmbio não entra', () => {
        recordEscalation({ chain: 'fx', subject: 'USD', tried: ['yahoo.currencies', 'ptax'], resolvedBy: 'ptax' });
        const { chains } = buildEscalationView(getEscalations(), stats());
        expect(chains.fx).toBeUndefined();
        expect(chains.quotes).toBeDefined();
        expect(chains.quotes.total).toBe(0);
    });

    it('fonte de cadeia sem ledger vem com escalated null, nunca zerado', () => {
        const facts = { now: new Date(), macro: {}, fundamentals: {} };
        const linhas = buildSourceStatuses(facts, stats(), getEscalations());
        expect(linhas.find((l) => l.id === 'coinbase').escalated).toBeNull();
        expect(linhas.find((l) => l.id === 'brapi').escalated).toEqual({ reached: 0, rescued: 0, missed: 0 });
    });
});
