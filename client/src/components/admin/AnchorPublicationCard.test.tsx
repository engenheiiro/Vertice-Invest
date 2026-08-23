/**
 * Contrato de SEGURANÇA do card de publicação âncora.
 *
 * A invariante que estes testes travam é uma só, e é a mais cara de errar:
 * **"Ver rascunho" nunca pode publicar.** O botão de prévia e o de publicar
 * chamam o MESMO endpoint, e o que os separa é um booleano no corpo do POST.
 * Se `dryRun` se perder — numa refatoração, num merge, num copiar-e-colar entre
 * os dois handlers — a prévia passa a trocar a lista que o assinante vê, sem
 * confirmação e sem ninguém ter olhado o resultado.
 *
 * O segundo risco coberto: publicar sem confirmar, e publicar a classe errada.
 * O servidor roda AS DUAS classes quando `assetClass` não vai no corpo, então
 * "publicar FIIs" precisa mandar FII — nunca omitir o campo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnchorPublicationCard } from './AnchorPublicationCard';
import { researchService } from '../../services/research';

const addToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
    useToast: () => ({ addToast: (...args: unknown[]) => addToast(...args) }),
}));

// A confirmação é controlada por teste: `confirmAnswer` decide se o dono
// clicou em "Publicar" ou em "Cancelar".
let confirmAnswer = true;
const confirmSpy = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => (options: unknown) => {
        confirmSpy(options);
        return Promise.resolve(confirmAnswer);
    },
}));

const builtFixture = (assetClass: 'STOCK' | 'FII') => ({
    assetClass,
    label: assetClass === 'FII' ? 'FIIs' : 'Ações',
    strategy: 'BUY_AND_HOLD',
    version: 'v1',
    generatedAt: '2026-08-23T10:00:00.000Z',
    macro: { SELIC: 10 },
    config: { minMarketCap: 1e9, maxBeta: 1.2, weights: { durability: 1, resilience: 1, consistency: 1 } },
    thresholds: { entryScore: 70, holdScore: 62 },
    disclaimer: '',
    bootstrap: false,
    previousAnalysisId: null,
    ranking: [],
    exits: [],
    excludedByReason: [],
    counts: { analyzed: 40, eligible: 17, excluded: 23, buy: 6, wait: 11, held: 1, entered: 2, exits: 1 },
});

const dryRunResponse = (assetClass: 'STOCK' | 'FII' = 'STOCK') => ({
    strategy: 'BUY_AND_HOLD',
    dryRun: true,
    results: [{ assetClass, published: false, dryRun: true, built: builtFixture(assetClass) }],
});

describe('AnchorPublicationCard', () => {
    let publishSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        confirmAnswer = true;
        addToast.mockClear();
        confirmSpy.mockClear();
        publishSpy = vi.spyOn(researchService, 'publishAnchorRanking');
        publishSpy.mockResolvedValue(dryRunResponse() as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('"Ver rascunho" chama o serviço com dryRun: true e NÃO publica', async () => {
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /ver rascunho/i }));

        await waitFor(() => expect(publishSpy).toHaveBeenCalled());
        expect(publishSpy).toHaveBeenCalledWith({ assetClass: 'STOCK', dryRun: true });
        // A prévia não pode nem sequer perguntar se quer publicar.
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('"Publicar" pede confirmação ANTES de chamar o serviço', async () => {
        confirmAnswer = false;
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /^publicar$/i }));

        await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
        // Cancelou: nada foi ao ar.
        expect(publishSpy).not.toHaveBeenCalled();
    });

    it('confirmado, publica com dryRun: false na classe da aba', async () => {
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /^publicar$/i }));

        await waitFor(() => expect(publishSpy).toHaveBeenCalled());
        expect(publishSpy).toHaveBeenCalledWith({ assetClass: 'STOCK', dryRun: false });
    });

    it('na aba FIIs, o rascunho é de FII — o default silencioso para STOCK não volta', async () => {
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /fiis/i }));
        fireEvent.click(screen.getByRole('button', { name: /ver rascunho/i }));

        await waitFor(() => expect(publishSpy).toHaveBeenCalled());
        expect(publishSpy).toHaveBeenCalledWith({ assetClass: 'FII', dryRun: true });
    });

    it('publica UMA classe por vez — nunca omite assetClass', async () => {
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /fiis/i }));
        fireEvent.click(screen.getByRole('button', { name: /^publicar$/i }));

        await waitFor(() => expect(publishSpy).toHaveBeenCalled());
        const arg = publishSpy.mock.calls[0][0] as { assetClass?: string };
        expect(arg.assetClass).toBe('FII');
    });

    it('mostra o motivo quando o portão de qualidade bloqueia', async () => {
        publishSpy.mockResolvedValue({
            strategy: 'BUY_AND_HOLD',
            dryRun: false,
            results: [{
                assetClass: 'STOCK',
                published: false,
                blocked: true,
                reason: 'último sync de fundamentos BR não está saudável',
                built: builtFixture('STOCK'),
            }],
        } as never);

        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /ver rascunho/i }));

        expect(await screen.findByText(/portão de qualidade bloqueou/i)).toBeInTheDocument();
        expect(screen.getByText(/último sync de fundamentos BR não está saudável/i)).toBeInTheDocument();
    });

    it('o rascunho de uma classe não vaza para a outra aba', async () => {
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /ver rascunho/i }));
        await screen.findByText(/Analisados/i);

        fireEvent.click(screen.getByRole('button', { name: /fiis/i }));
        // FIIs ainda não foi calculado: volta ao estado vazio, não mostra os
        // números de Ações com o rótulo de FIIs.
        expect(screen.getByText(/para calcular o que iria ao ar/i)).toBeInTheDocument();
    });

    it('erro do serviço vira mensagem na tela, não publicação silenciosa', async () => {
        publishSpy.mockRejectedValue(new Error('Muitas operações de administração.'));
        render(<AnchorPublicationCard />);
        fireEvent.click(screen.getByRole('button', { name: /ver rascunho/i }));

        expect(await screen.findByText(/Muitas operações de administração\./i)).toBeInTheDocument();
    });
});
