import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Terms } from './Terms';

/**
 * A cláusula de cobrança.
 *
 * Até 31/08/2026 os Termos tinham seis seções e nenhuma palavra sobre pagamento:
 * a plataforma vendia assinatura recorrente e um anual parcelado em 12× sem
 * documento que dissesse o que renova, o que não renova e o que acontece ao
 * cancelar — enquanto a Landing anunciava "Cancele quando quiser", que sozinho
 * sugere devolução do valor pago.
 *
 * O que se protege aqui são as quatro afirmações que sustentam a venda. Sumir
 * com qualquer uma volta a deixar o cliente sem contrato escrito.
 */

vi.mock('react-router-dom', () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../components/seo/PageMeta', () => ({ PageMeta: () => null }));

describe('Assinaturas, cobrança e cancelamento', () => {
    it('existe como seção própria', () => {
        render(<Terms />);

        expect(screen.getByText(/Assinaturas, Cobrança e Cancelamento/i)).toBeInTheDocument();
    });

    it('diz o que renova sozinho e o que não renova', () => {
        // A diferença entre mensal no cartão e anual é a fonte mais provável de
        // reclamação: um cobra de novo sem avisar, o outro simplesmente acaba.
        render(<Terms />);

        expect(screen.getByText(/renovada automaticamente/i)).toBeInTheDocument();
        expect(screen.getByText(/Não renova automaticamente/i)).toBeInTheDocument();
    });

    it('garante os 7 dias de arrependimento do CDC', () => {
        render(<Terms />);

        expect(screen.getByText(/7 dias corridos/i)).toBeInTheDocument();
        expect(screen.getByText(/art\. 49 do Código de Defesa do Consumidor/i)).toBeInTheDocument();
    });

    it('é explícito sobre não haver devolução proporcional depois disso', () => {
        // A decisão comercial é não reembolsar proporcionalmente. Ela só é
        // defensável se estiver escrita antes da compra, não descoberta depois.
        render(<Terms />);

        expect(screen.getByText(/não há devolução proporcional/i)).toBeInTheDocument();
    });

    it('manda o preço para a vitrine em vez de repeti-lo aqui', () => {
        // Preço escrito no contrato seria um quinto espelho, fora do teste que
        // compara vitrine e servidor.
        render(<Terms />);

        expect(screen.getByRole('link', { name: /página de planos/i })).toHaveAttribute('href', '/pricing');
        expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    });
});
