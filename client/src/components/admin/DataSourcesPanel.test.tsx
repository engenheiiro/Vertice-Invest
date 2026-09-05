import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataSourcesPanel } from './DataSourcesPanel';
import type { ChainFlow, DataSource, SourceGroup } from '../../services/health';

// A tela existe para responder, sem intermediário técnico: "de onde vem o dado e
// está chegando?". O que se cobra aqui é a hierarquia de leitura — grade agrupada,
// ordem estável, problema visível pela cor — e a linguagem.

const src = (over: Partial<DataSource>): DataSource => ({
    id: 'yahoo.quotes',
    label: 'Yahoo Finance — cotações',
    short: 'Yahoo',
    role: 'Fonte principal',
    group: 'quotes',
    feeds: 'Preço de ações, FIIs, ETFs e cripto',
    critical: true,
    status: 'OK',
    detail: '40 de 40 chamadas com dado',
    lastDeliveryAt: new Date().toISOString(),
    lastDeliveryHours: 0.1,
    attempts: 40,
    failures: 0,
    failureRate: 0,
    lastError: null,
    lastFailAt: null,
    ...over,
});

const groups: SourceGroup[] = [
    { id: 'quotes', label: 'Cotações de ativos', hint: 'Preço da carteira' },
    { id: 'fx', label: 'Câmbio e cripto', hint: 'Converte dólar em reais' },
];

describe('DataSourcesPanel', () => {
    it('agrupa os cards por função, na ordem que o servidor manda', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'quotes' }),
                src({ id: 'b', short: 'Coinbase', group: 'fx' }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('Cotações de ativos')).toBeInTheDocument();
        expect(screen.getByText('Câmbio e cripto')).toBeInTheDocument();
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
        expect(screen.getByText('Coinbase')).toBeInTheDocument();
    });

    // Sem ordenar por gravidade: numa grade a cor faz a triagem, e card que muda
    // de lugar a cada carregamento não se acha de memória. Todos ficam visíveis.
    it('mostra TODAS as fontes de uma vez, sem esconder as saudáveis', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo' }),
                src({ id: 'b', short: 'Brapi', status: 'CRITICAL' }),
                src({ id: 'c', short: 'Google', status: 'UNKNOWN' }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
        expect(screen.getByText('Brapi')).toBeInTheDocument();
        expect(screen.getByText('Google')).toBeInTheDocument();
    });

    it('o card carrega o papel da fonte na cadeia', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Coinbase', role: '3ª fonte (só Bitcoin)' })]}
            groups={groups}
        />);
        expect(screen.getByText('3ª fonte (só Bitcoin)')).toBeInTheDocument();
    });

    it('o resumo NOMEIA quem está com problema, em vez de só contar', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', status: 'WARN' })]}
            summary={{
                total: 1, ok: 0, degraded: 1, unknown: 0,
                degradedLabels: ['Yahoo Finance — câmbio'], worst: 'WARN',
            }}
            groups={groups}
        />);
        expect(screen.getByText(/Yahoo Finance — câmbio/)).toBeInTheDocument();
        expect(screen.getByText('Atenção')).toBeInTheDocument();
    });

    // A pergunta seguinte à do painel: "caiu — e agora?". Antes não tinha resposta.
    it('o detalhe diz quem assume se a fonte falhar', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Yahoo', label: 'Yahoo Finance — câmbio',
                backups: ['AwesomeAPI', 'Coinbase', 'PTAX — Banco Central'], covers: null,
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Yahoo/ }));
        expect(screen.getByText(/AwesomeAPI → Coinbase → PTAX/)).toBeInTheDocument();
    });

    it('a reserva diz de quem ela é reserva', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Coinbase', label: 'Coinbase',
                backups: ['PTAX — Banco Central'], covers: 'Yahoo Finance — câmbio',
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByText(/Yahoo Finance — câmbio/)).toBeInTheDocument();
    });

    // O aviso mais valioso do modal: onde NÃO há rede de proteção.
    it('fonte sem reserva avisa que é ponto único de falha', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Tesouro', label: 'Tesouro Transparente', backups: [], covers: null })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Tesouro/ }));
        expect(screen.getByText(/Não há fonte alternativa/)).toBeInTheDocument();
    });

    it('o modal fecha no Esc e no clique fora', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'a', short: 'Yahoo', label: 'Yahoo Finance — cotações' })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Yahoo/ }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('o detalhe abre ao clicar no card e fecha ao clicar de novo', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'AwesomeAPI', label: 'AwesomeAPI', status: 'CRITICAL',
                detail: '100% das 8 chamadas falharam', lastError: 'ETIMEDOUT',
            })]}
            groups={groups}
        />);
        expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();

        // Pelo papel de botão: aberto o detalhe, o nome passa a aparecer duas
        // vezes (no card e no cabeçalho do detalhe).
        const card = () => screen.getByRole('button', { name: /AwesomeAPI/ });

        fireEvent.click(card());
        expect(screen.getByText(/ETIMEDOUT/)).toBeInTheDocument();
        expect(screen.getByText('100% das 8 chamadas falharam')).toBeInTheDocument();

        fireEvent.click(card());
        expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();
    });

    // Um deploy zera o contador do processo. Se "sem chamadas ainda" fosse pintado
    // de falha, o painel nasceria em pânico a cada publicação.
    it('fonte sem uso ainda não é tratada como falha', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Tudo chegando')).toBeInTheDocument();
    });

    // O pedido: "preciso saber que horas eles vão rodar". Card cinza sem previsão
    // é indistinguível de card cinza abandonado.
    it('fonte agendada em espera mostra QUANDO volta a rodar', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Aguardando')).toBeInTheDocument();
        expect(screen.getByText('hoje às 18:30')).toBeInTheDocument();
    });

    // Reserva não tem horário — ela entra quando a anterior falha. Mostrar "—" ali
    // faria parecer defeito o que é o sistema funcionando.
    it('fonte de reserva parada aparece como em espera, não como pendência', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Coinbase', status: 'UNKNOWN', attempts: 0,
                lastDeliveryHours: null, trigger: 'onFailure', nextRun: null,
            })]}
            groups={groups}
        />);
        expect(screen.getByText('Em espera')).toBeInTheDocument();
        expect(screen.getByText('reserva')).toBeInTheDocument();
    });

    it('o detalhe diz a periodicidade e a próxima execução', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'a', short: 'Banco Central', label: 'Banco Central — séries',
                cadence: 'A cada 15 minutos', nextRun: 'em 9 min',
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Banco Central/ }));
        expect(screen.getByText(/A cada 15 minutos/)).toBeInTheDocument();
        expect(screen.getByText(/próxima em 9 min/)).toBeInTheDocument();
    });

    it('servidor antigo (sem os blocos) ainda renderiza os cards', () => {
        render(<DataSourcesPanel sources={[src({ id: 'a', short: 'Yahoo', group: undefined })]} />);
        expect(screen.getByText('Yahoo')).toBeInTheDocument();
    });

    it('sem fontes, não renderiza nada (servidor antigo, campo ausente)', () => {
        const { container } = render(<DataSourcesPanel sources={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});

// O pedido veio de uma leitura errada da tela anterior: cards lado a lado leem-se
// como alternativas equivalentes, e no bloco de cotações a B3 aparecia colada na
// Google Finance como se fosse o 4º elo — quando é fonte independente, que cobre
// o fechamento oficial do pregão e não substitui ninguém.
describe('DataSourcesPanel — ordem da cadeia', () => {
    it('numera cada elo da cadeia na ordem de tentativa', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'fx', chain: 'fx', chainPosition: 1, chainSize: 3 }),
                src({ id: 'b', short: 'AwesomeAPI', group: 'fx', chain: 'fx', chainPosition: 2, chainSize: 3 }),
                src({ id: 'c', short: 'Coinbase', group: 'fx', chain: 'fx', chainPosition: 3, chainSize: 3 }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('1ª')).toBeInTheDocument();
        expect(screen.getByText('2ª')).toBeInTheDocument();
        expect(screen.getByText('3ª')).toBeInTheDocument();
    });

    // O ponto todo: fonte sem cadeia não ganha número, porque não tem posição.
    it('fonte independente não recebe ordinal e é separada da cadeia', () => {
        render(<DataSourcesPanel
            sources={[
                src({ id: 'a', short: 'Yahoo', group: 'quotes', chain: 'quotes', chainPosition: 1, chainSize: 1 }),
                src({ id: 'b3', short: 'B3', group: 'quotes', chain: null, chainPosition: null }),
            ]}
            groups={groups}
        />);
        expect(screen.getByText('1ª')).toBeInTheDocument();
        expect(screen.queryByText('2ª')).not.toBeInTheDocument();
        expect(screen.getByText(/Independente/)).toBeInTheDocument();
    });

    it('bloco sem cadeia nenhuma não anuncia independência (não há o que confundir)', () => {
        render(<DataSourcesPanel
            sources={[src({ id: 'tesouro', short: 'Tesouro', group: 'quotes', chain: null, chainPosition: null })]}
            groups={groups}
        />);
        expect(screen.queryByText(/Independente/)).not.toBeInTheDocument();
    });

    it('o detalhe diz a posição na cadeia', () => {
        render(<DataSourcesPanel
            sources={[src({
                id: 'c', short: 'Coinbase', label: 'Coinbase', chain: 'fx', chainPosition: 3, chainSize: 4,
            })]}
            groups={groups}
        />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByText(/3ª de 4/)).toBeInTheDocument();
    });
});

// Cinza juntava dois estados opostos: a fonte agendada que ainda não cumpriu a
// hora (pendência) e a reserva que ninguém precisou acionar (sistema funcionando).
// A cor tem de separar os dois — é a leitura de relance que o painel existe para dar.
describe('DataSourcesPanel — reserva em espera', () => {
    const reserva = () => src({
        id: 'a', short: 'Coinbase', status: 'UNKNOWN', attempts: 0,
        lastDeliveryHours: null, trigger: 'onFailure', nextRun: null,
    });
    const agendada = () => src({
        id: 'b', short: 'Fundamentus', status: 'UNKNOWN', attempts: 0,
        lastDeliveryHours: null, trigger: 'scheduled', nextRun: 'hoje às 18:30',
    });

    const cardDe = (nome: RegExp) => screen.getByRole('button', { name: nome }).className;

    it('a reserva parada é azul, não cinza', () => {
        render(<DataSourcesPanel sources={[reserva()]} groups={groups} />);
        expect(cardDe(/Coinbase/)).toMatch(/blue/);
    });

    it('a agendada em atraso de vez continua cinza', () => {
        render(<DataSourcesPanel sources={[agendada()]} groups={groups} />);
        expect(cardDe(/Fundamentus/)).not.toMatch(/blue/);
    });

    // Azul é "de prontidão", nunca "entregando": quem sustenta o dado agora é verde,
    // e empatar os dois apagaria a diferença que importa no dia da falha.
    it('fonte entregando não vira azul', () => {
        render(<DataSourcesPanel sources={[src({ id: 'c', short: 'Yahoo', status: 'OK' })]} groups={groups} />);
        expect(cardDe(/Yahoo/)).not.toMatch(/blue/);
    });

    it('o detalhe da reserva abre com a mesma cor do card', () => {
        render(<DataSourcesPanel sources={[reserva()]} groups={groups} />);
        fireEvent.click(screen.getByRole('button', { name: /Coinbase/ }));
        expect(screen.getByRole('dialog').innerHTML).toMatch(/text-blue-400/);
    });
});

// --- O trajeto por ativo -----------------------------------------------------
//
// O painel dizia "a Brapi está instável, 24 chamadas sem dado" e parava aí. Quais
// ativos chegaram até ela era pergunta sem resposta na tela — e os dois
// diagnósticos por trás daquele número pedem ações opostas (fonte degradada ×
// ticker morto para aposentar).

const cadeia: DataSource[] = [
    src({ id: 'yahoo.quotes', short: 'Yahoo', chain: 'quotes', chainPosition: 1, chainSize: 3, escalated: { reached: 3, rescued: 0, missed: 3 } }),
    src({ id: 'google.finance', short: 'Google', chain: 'quotes', chainPosition: 2, chainSize: 3, trigger: 'onFailure', escalated: { reached: 3, rescued: 1, missed: 2 } }),
    src({ id: 'brapi', short: 'Brapi', chain: 'quotes', chainPosition: 3, chainSize: 3, trigger: 'onFailure', status: 'WARN', escalated: { reached: 2, rescued: 1, missed: 1 } }),
];

const flow: Record<string, ChainFlow> = {
    quotes: {
        chain: 'quotes',
        total: 3,
        unresolved: 1,
        expected: 0,
        byResolver: [
            { id: 'google.finance', label: 'Google', count: 1 },
            { id: 'brapi', label: 'Brapi', count: 1 },
            { id: null, label: null, count: 1 },
        ],
        items: [
            { subject: 'EURP11', tried: ['yahoo.quotes', 'google.finance', 'brapi'], resolvedBy: null, reason: 'O Yahoo não trouxe o preço deste ativo', expected: false, count: 4, at: new Date().toISOString() },
            { subject: 'PETR4', tried: ['yahoo.quotes', 'google.finance', 'brapi'], resolvedBy: 'brapi', reason: null, expected: false, count: 1, at: new Date().toISOString() },
            { subject: 'NGRD3', tried: ['yahoo.quotes', 'google.finance'], resolvedBy: 'google.finance', reason: null, expected: false, count: 1, at: new Date().toISOString() },
        ],
        truncated: 0,
    },
};

describe('DataSourcesPanel — quem precisou de reserva', () => {
    it('resume a cadeia sem exigir clique, com o "sem preço" destacado', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        expect(screen.getByText(/precisaram de reserva/)).toBeInTheDocument();
        expect(screen.getByText('1 sem preço em nenhuma')).toBeInTheDocument();
    });

    // Zero é notícia boa e precisa de frase própria: significa que a principal
    // cobriu o universo inteiro.
    it('diz em voz alta quando ninguém precisou de reserva', () => {
        render(<DataSourcesPanel
            sources={cadeia}
            groups={groups}
            chains={{ quotes: { ...flow.quotes, total: 0, unresolved: 0, byResolver: [], items: [] } }}
        />);
        expect(screen.getByText(/Nenhum ativo precisou de reserva/)).toBeInTheDocument();
    });

    // Ausência de medição não pode virar "nada escalou": a cadeia sem ledger
    // simplesmente não fala.
    it('cala sobre a cadeia que o servidor não mede', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} />);
        expect(screen.queryByText(/precisaram de reserva/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Nenhum ativo precisou de reserva/)).not.toBeInTheDocument();
    });

    it('abre a lista com o ticker, o caminho e quem entregou', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        fireEvent.click(screen.getByText(/ver ativos/));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('PETR4')).toBeInTheDocument();
        // Sem preço primeiro: é a única categoria com consequência real.
        const tickers = screen.getAllByText(/^(EURP11|PETR4|NGRD3)$/).map((n) => n.textContent);
        expect(tickers[0]).toBe('EURP11');
        expect(screen.getByText('sem preço')).toBeInTheDocument();
        expect(screen.getByText('4×')).toBeInTheDocument();
    });

    it('o detalhe da fonte nomeia os ativos que ela salvou e os que perdeu', () => {
        render(<DataSourcesPanel sources={cadeia} groups={groups} chains={flow} />);
        fireEvent.click(screen.getByText('Brapi'));

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Ativos que passaram por aqui');
        expect(dialog).toHaveTextContent('Trouxe o preço');
        expect(dialog).toHaveTextContent('PETR4');
        expect(dialog).toHaveTextContent('Ficou sem preço em fonte nenhuma');
        expect(dialog).toHaveTextContent('EURP11');
        // NGRD3 nunca chegou na Brapi (o Google resolveu antes).
        expect(dialog).not.toHaveTextContent('NGRD3');
    });

    it('fonte sem medição não ganha a seção de ativos', () => {
        render(<DataSourcesPanel sources={[src({ id: 'coinbase', short: 'Coinbase', group: 'fx', escalated: null })]} groups={groups} />);
        fireEvent.click(screen.getByText('Coinbase'));
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Ativos que passaram por aqui');
    });
});
