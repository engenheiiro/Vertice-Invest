import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataSourcesPanel } from './DataSourcesPanel';
import type { DataSource } from '../../services/health';

// A tela existe para responder, sem intermediário técnico: "de onde vem o dado e
// está chegando?". O que se cobra aqui é a hierarquia de leitura — problema
// visível de cara, saudável recolhido — e a linguagem.

const src = (over: Partial<DataSource>): DataSource => ({
    id: 'yahoo.quotes',
    label: 'Yahoo Finance — cotações',
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

describe('DataSourcesPanel', () => {
    it('fonte com problema aparece sem precisar expandir nada', () => {
        render(<DataSourcesPanel sources={[
            src({ id: 'a', status: 'OK' }),
            src({ id: 'b', label: 'AwesomeAPI', status: 'CRITICAL', detail: '100% das 8 chamadas falharam' }),
        ]}
        />);
        expect(screen.getByText('AwesomeAPI')).toBeInTheDocument();
        expect(screen.getByText('Sem receber')).toBeInTheDocument();
    });

    it('fontes saudáveis ficam recolhidas até o clique', () => {
        render(<DataSourcesPanel sources={[src({ id: 'a', label: 'Coinbase' })]} />);
        expect(screen.queryByText('Coinbase')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText(/Ver as outras 1 fontes/));
        expect(screen.getByText('Coinbase')).toBeInTheDocument();
    });

    it('o resumo NOMEIA quem está com problema, em vez de só contar', () => {
        render(<DataSourcesPanel sources={[
            src({ id: 'a', label: 'Yahoo Finance — câmbio', status: 'WARN' }),
        ]}
        />);
        // Aparece duas vezes de propósito: na frase do topo e na linha da fonte.
        expect(screen.getAllByText(/Yahoo Finance — câmbio/).length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Atenção')).toBeInTheDocument();
    });

    // Um deploy zera o contador do processo. Se "sem chamadas ainda" fosse pintado
    // de falha, o painel nasceria em pânico a cada publicação.
    it('fonte sem uso ainda não é tratada como falha', () => {
        render(<DataSourcesPanel sources={[
            src({ id: 'a', label: 'IBGE', status: 'UNKNOWN', attempts: 0, lastDeliveryHours: null }),
        ]}
        />);
        // Não entra no bloco de problemas — o resumo segue positivo.
        expect(screen.getByText('Tudo chegando')).toBeInTheDocument();
    });

    it('o erro da fonte fica atrás do clique, não poluindo a lista', () => {
        render(<DataSourcesPanel sources={[
            src({
                id: 'a', label: 'AwesomeAPI', status: 'CRITICAL',
                detail: '100% das 8 chamadas falharam', lastError: 'ETIMEDOUT',
            }),
        ]}
        />);
        expect(screen.queryByText(/ETIMEDOUT/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('AwesomeAPI'));
        expect(screen.getByText(/ETIMEDOUT/)).toBeInTheDocument();
    });

    it('sem fontes, não renderiza nada (servidor antigo, campo ausente)', () => {
        const { container } = render(<DataSourcesPanel sources={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
