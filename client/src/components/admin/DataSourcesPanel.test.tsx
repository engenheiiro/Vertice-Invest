import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataSourcesPanel } from './DataSourcesPanel';
import type { DataSource, SourceGroup } from '../../services/health';

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
            sources={[src({ id: 'a', short: 'IBGE', status: 'UNKNOWN', attempts: 0, lastDeliveryHours: null })]}
            groups={groups}
        />);
        expect(screen.getByText('Tudo chegando')).toBeInTheDocument();
        expect(screen.getByText('Sem uso')).toBeInTheDocument();
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
