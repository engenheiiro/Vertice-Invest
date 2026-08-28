/**
 * Repartição por setor de uma seção da lista âncora.
 *
 * O que estes testes seguram é a LEITURA: a fatia é contagem de nomes (o ranking
 * não tem dinheiro), o balde é o mesmo da Carteira, e o bloco some quando não há
 * distribuição a mostrar em vez de desenhar um donut de uma fatia só.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AnchorSectorMix } from './AnchorSectorMix';
import type { AnchorRankingItem } from '../../services/research';

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const item = (ticker: string, sector: string): AnchorRankingItem => ({
    position: 1,
    ticker,
    name: ticker,
    sector,
    action: 'BUY',
    score: 80,
    currentPrice: 10,
    targetPrice: 12,
    probability: 0,
    reason: 'motivo',
} as AnchorRankingItem);

describe('AnchorSectorMix', () => {
    it('reparte pelo setor do ATIVO e conta ativos, não dinheiro', () => {
        render(
            <AnchorSectorMix
                kind="STOCK_SUBSECTOR"
                section="Para comprar"
                items={[
                    item('ITUB4', 'Bancos'),
                    item('BBAS3', 'Bancos'),
                    item('CPFE3', 'Elétricas'),
                    item('SAPR11', 'Saneamento'),
                ]}
            />,
        );

        // CPFL é elétrica e a Sanepar é saneamento: no macro-setor as duas viravam
        // 'Utilidade Pública' e a fatia contradizia o selo do cartão.
        expect(screen.getByText('Bancos')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('Energia Elétrica')).toBeInTheDocument();
        expect(screen.getByText('Saneamento Básico')).toBeInTheDocument();
        expect(screen.queryByText('Utilidade Pública')).not.toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText(/4 ativos/)).toBeInTheDocument();
    });

    it('FII é repartido por segmento fino, não por "Imobiliário"', () => {
        render(
            <AnchorSectorMix
                kind="FII"
                section="Para comprar"
                items={[item('HGLG11', 'Logística'), item('XPML11', 'Shoppings')]}
            />,
        );

        expect(screen.getByText('Logística')).toBeInTheDocument();
        expect(screen.getByText('Shoppings')).toBeInTheDocument();
        expect(screen.queryByText('Imobiliário')).not.toBeInTheDocument();
    });

    it('com um ativo só, não desenha distribuição nenhuma', () => {
        const { container } = render(
            <AnchorSectorMix kind="STOCK_SUBSECTOR" section="Para comprar" items={[item('WEGE3', 'Bens Industriais')]} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('seção sem setor reconhecível não vira uma pizza de "Não classificado" falsa', () => {
        // O balde cinza existe, mas continua identificado — nunca disputa cor com setor real.
        render(
            <AnchorSectorMix
                kind="STOCK_SUBSECTOR"
                section="Em observação"
                items={[item('AAA3', ''), item('BBB3', '')]}
            />,
        );
        expect(screen.getByText('Não classificado')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});
