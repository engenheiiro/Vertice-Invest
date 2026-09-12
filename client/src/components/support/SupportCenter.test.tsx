import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SupportCenter } from './SupportCenter';

/**
 * Entrada de anexo do ticket.
 *
 * O VT-0001 chegou ao servidor sem a imagem e sem erro nenhum: o print tinha
 * sido recortado com Win+Shift+S, que não gera arquivo — vai para a área de
 * transferência. O formulário só escutava "escolher arquivo", então a colagem
 * não fazia nada e o ticket saía mudo, com a pessoa certa de que anexou.
 *
 * Estes testes cobrem os três caminhos por onde uma imagem entra. Nenhum deles
 * quebra tipo ou teste ao ser removido — some em silêncio, que é exatamente
 * como o defeito apareceu.
 */

const mocks = vi.hoisted(() => ({
    listMyTickets: vi.fn(),
    createTicket: vi.fn(),
    compressImage: vi.fn(),
    addToast: vi.fn(),
}));

vi.mock('../../services/support', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/support')>();
    return {
        ...actual,
        supportService: {
            listMyTickets: mocks.listMyTickets,
            createTicket: mocks.createTicket,
        },
    };
});
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../../utils/imageCompress', () => ({ compressImage: mocks.compressImage }));

const DATA_URL = 'data:image/jpeg;base64,AAAA';

const renderCenter = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <SupportCenter />
        </QueryClientProvider>,
    );
};

/** Abre o formulário de novo ticket — o anexo só existe lá dentro. */
const abrirFormulario = async () => {
    renderCenter();
    const botao = await screen.findByRole('button', { name: /relatar um problema/i });
    await userEvent.click(botao);
    return await screen.findByText(/print da tela/i);
};

const arquivoDeImagem = () => new File(['bytes'], 'print.png', { type: 'image/png' });

const formulario = () => document.querySelector('form') as HTMLFormElement;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMyTickets.mockResolvedValue([]);
    mocks.compressImage.mockResolvedValue(DATA_URL);
    mocks.createTicket.mockResolvedValue({
        _id: 't1', code: 'VT-0001', subject: 'x', category: 'BUG', status: 'ABERTO',
        priority: 'NORMAL', messages: [], createdAt: '', updatedAt: '', canReopen: false,
        hasUnreadForUser: false,
    });
});

describe('por onde a imagem entra', () => {
    it('colar com Ctrl+V anexa o print', async () => {
        await abrirFormulario();

        fireEvent.paste(formulario(), { clipboardData: { files: [arquivoDeImagem()] } });

        await waitFor(() => expect(screen.getByAltText('Anexo 1')).toBeInTheDocument());
        expect(mocks.compressImage).toHaveBeenCalledTimes(1);
    });

    it('arrastar e soltar anexa o print', async () => {
        await abrirFormulario();

        fireEvent.drop(formulario(), { dataTransfer: { files: [arquivoDeImagem()] } });

        await waitFor(() => expect(screen.getByAltText('Anexo 1')).toBeInTheDocument());
    });

    it('escolher pelo seletor continua funcionando', async () => {
        await abrirFormulario();

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, arquivoDeImagem());

        await waitFor(() => expect(screen.getByAltText('Anexo 1')).toBeInTheDocument());
    });
});

describe('o que NÃO deve virar anexo', () => {
    it('colar texto não mexe no anexo nem chama a compressão', async () => {
        await abrirFormulario();

        fireEvent.paste(formulario(), { clipboardData: { files: [] } });

        await waitFor(() => expect(mocks.compressImage).not.toHaveBeenCalled());
        expect(screen.queryByAltText('Anexo 1')).not.toBeInTheDocument();
    });

    it('arquivo que não é imagem é ignorado', async () => {
        await abrirFormulario();

        const pdf = new File(['%PDF'], 'extrato.pdf', { type: 'application/pdf' });
        fireEvent.drop(formulario(), { dataTransfer: { files: [pdf] } });

        await waitFor(() => expect(mocks.compressImage).not.toHaveBeenCalled());
    });
});

describe('o anexo chega no envio', () => {
    it('a imagem colada vai junto com o ticket', async () => {
        await abrirFormulario();

        fireEvent.paste(formulario(), { clipboardData: { files: [arquivoDeImagem()] } });
        await waitFor(() => expect(screen.getByAltText('Anexo 1')).toBeInTheDocument());

        await userEvent.type(screen.getByPlaceholderText(/rentabilidade da carteira zerou/i), 'Tela travada');
        await userEvent.type(screen.getByPlaceholderText(/conte o que você estava fazendo/i), 'A tela ficou travada depois do login.');
        await userEvent.click(screen.getByRole('button', { name: /enviar ticket/i }));

        await waitFor(() => expect(mocks.createTicket).toHaveBeenCalled());
        expect(mocks.createTicket.mock.calls[0][0].attachments).toEqual([DATA_URL]);
    });
});
