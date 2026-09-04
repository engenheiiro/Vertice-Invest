import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MarketStatusBar } from './MarketStatusBar';
import { MarketIndex } from '../../hooks/useDashboardData';

// A barra é a primeira coisa que o usuário lê no painel, e em 04/09/2026 ela
// exibiu o dólar e o BTC da véspera com a mesma cara de cotação ao vivo — sem
// nada na tela que distinguisse um do outro. O que se cobra aqui é honestidade
// de exibição: valor ausente não vira zero, valor preservado se declara.

const idx = (over: Partial<MarketIndex>): MarketIndex => ({
    ticker: 'USD', value: 5.12, changePercent: 0.5, type: 'CURRENCY', ...over,
});

describe('MarketStatusBar', () => {
    afterEach(() => vi.useRealTimers());

    it('valor ausente vira travessão, nunca 0,00', () => {
        render(<MarketStatusBar indices={[idx({ value: null })]} />);
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    });

    it('cotação defasada é rotulada e perde o chip de variação', () => {
        render(<MarketStatusBar indices={[idx({ stale: true })]} />);
        expect(screen.getByText('defasado')).toBeInTheDocument();
        // A variação é de outro dia; exibi-la em verde/vermelho seria mentir duas vezes.
        expect(screen.queryByText('+0.50%')).not.toBeInTheDocument();
    });

    it('cotação fresca mostra a variação normalmente', () => {
        render(<MarketStatusBar indices={[idx({})]} />);
        expect(screen.getByText('+0.50%')).toBeInTheDocument();
        expect(screen.queryByText('defasado')).not.toBeInTheDocument();
    });

    // Sem o "$", o número em formato pt-BR passa por reais — e BTC em real seria
    // umas seis vezes esse valor.
    it('cripto carrega o símbolo da moeda em que é cotada', () => {
        render(<MarketStatusBar indices={[idx({ ticker: 'BTC', value: 79533.56, prefix: '$' })]} />);
        expect(screen.getByText('$79.533,56')).toBeInTheDocument();
    });

    it('o status do pregão reavalia com o tempo, em vez de congelar na montagem', () => {
        vi.useFakeTimers();
        // Quinta-feira, 14h em São Paulo (17h UTC) → pregão aberto.
        vi.setSystemTime(new Date('2026-09-03T17:00:00Z'));
        render(<MarketStatusBar indices={[]} />);
        expect(screen.getByText('Mercado Aberto')).toBeInTheDocument();

        // Mesma aba, mesma montagem, três horas depois: 19h em São Paulo.
        vi.setSystemTime(new Date('2026-09-03T22:00:00Z'));
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(screen.getByText('Mercado Fechado')).toBeInTheDocument();
    });

    it('o pregão é o de São Paulo, não o relógio de quem abre a página', () => {
        vi.useFakeTimers();
        // 23h UTC de quinta = 20h em São Paulo: fechado, ainda que em Tóquio já
        // seja a manhã de sexta.
        vi.setSystemTime(new Date('2026-09-03T23:00:00Z'));
        render(<MarketStatusBar indices={[]} />);
        expect(screen.getByText('Mercado Fechado')).toBeInTheDocument();
    });
});
