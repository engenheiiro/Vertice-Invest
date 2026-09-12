import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AdminSuporteTab } from './AdminSuporteTab';
import type { AdminTicketDetail, AdminTicketRow } from '../../services/support';

/**
 * Aba "Suporte" do Admin.
 *
 * O que estes testes protegem é a fronteira entre o que é interno e o que o
 * usuário lê. Uma nota interna renderizada como resposta comum, ou o botão de
 * enviar mandando a nota para o cliente, não quebra tipo nenhum — só vaza.
 */

const mocks = vi.hoisted(() => ({
    adminList: vi.fn(),
    adminGet: vi.fn(),
    adminReply: vi.fn(),
    adminUpdate: vi.fn(),
    adminDownloadCsv: vi.fn(),
    loadAttachment: vi.fn(),
    addToast: vi.fn(),
}));

vi.mock('../../services/support', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/support')>();
    return {
        ...actual,
        supportService: {
            adminList: mocks.adminList,
            adminGet: mocks.adminGet,
            adminReply: mocks.adminReply,
            adminUpdate: mocks.adminUpdate,
            adminDownloadCsv: mocks.adminDownloadCsv,
            loadAttachment: mocks.loadAttachment,
        },
    };
});
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const row = (override: Partial<AdminTicketRow> = {}): AdminTicketRow => ({
    _id: 'ticket-1',
    code: 'VT-0001',
    subject: 'Rentabilidade zerou hoje',
    category: 'BUG',
    status: 'ABERTO',
    priority: 'ALTA',
    userName: 'Maria Souza',
    userEmail: 'maria@exemplo.com',
    planAtOpen: 'ELITE',
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    lastUserMessageAt: '2026-09-12T10:00:00.000Z',
    lastAdminMessageAt: null,
    hasUnreadForUser: false,
    messageCount: 1,
    canReopen: false,
    ...override,
});

const detail = (override: Partial<AdminTicketDetail['ticket']> = {}): AdminTicketDetail => ({
    ticket: {
        ...row(),
        priority: 'ALTA',
        internalTags: [],
        context: {
            route: '/wallet',
            userAgent: 'Mozilla/5.0 Firefox/140',
            viewport: '1920x1080',
            recentErrors: [{ at: '2026-09-12T09:59:00.000Z', status: 500, path: '/api/wallet' }],
        },
        messages: [
            {
                authorRole: 'USER', authorName: 'Maria Souza', body: 'Minha rentabilidade sumiu.',
                attachments: [], createdAt: '2026-09-12T10:00:00.000Z',
            },
            {
                authorRole: 'ADMIN', authorName: 'Suporte', body: 'checar o candle de domingo',
                isInternal: true, attachments: [], createdAt: '2026-09-12T10:05:00.000Z',
            },
        ],
        ...override,
    },
    profile: {
        name: 'Maria Souza', email: 'maria@exemplo.com', plan: 'PRO', role: 'USER',
        subscriptionStatus: 'ACTIVE', createdAt: '2026-01-10T00:00:00.000Z', assetCount: 14,
    },
});

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AdminSuporteTab />
        </QueryClientProvider>,
    );
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminList.mockResolvedValue({ total: 1, tickets: [row()] });
    mocks.adminGet.mockResolvedValue(detail());
    mocks.adminReply.mockResolvedValue(detail());
    mocks.adminUpdate.mockResolvedValue(detail());
});

describe('fila', () => {
    it('abre filtrada pelos tickets em andamento — a fila é o que ainda não foi resolvido', async () => {
        renderTab();
        await waitFor(() => expect(mocks.adminList).toHaveBeenCalled());
        expect(mocks.adminList.mock.calls[0][0]).toMatchObject({ status: 'OPEN' });
    });

    it('mostra o plano da abertura junto do ticket', async () => {
        renderTab();
        expect(await screen.findByText('ELITE')).toBeInTheDocument();
        expect(screen.getByText('VT-0001')).toBeInTheDocument();
    });

    it('não carrega thread nenhuma antes de você escolher um ticket', async () => {
        renderTab();
        await screen.findByText('VT-0001');
        expect(mocks.adminGet).not.toHaveBeenCalled();
        expect(screen.getByText(/Selecione um ticket/i)).toBeInTheDocument();
    });
});

describe('thread', () => {
    it('separa a nota interna da resposta ao usuário', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));

        const nota = await screen.findByText('checar o candle de domingo');
        // O rótulo tem que estar NO BLOCO da nota — é ele que impede confundir
        // rascunho com resposta enviada. (A caixa de escrever também diz "nota
        // interna", então procurar o texto solto na tela não provaria nada.)
        expect(nota.closest('div')?.textContent).toMatch(/Nota interna/i);
    });

    it('avisa quando o plano de hoje não é o plano da abertura', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));
        // Abriu como ELITE, hoje é PRO — quem responde precisa ver a diferença.
        expect(await screen.findByText(/era ELITE na abertura/i)).toBeInTheDocument();
    });

    it('mantém o contexto técnico recolhido até ser pedido', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));
        await screen.findByText(/Contexto técnico/i);

        expect(screen.queryByText(/Firefox/)).not.toBeInTheDocument();
        await userEvent.click(screen.getByText(/Contexto técnico/i));
        expect(await screen.findByText(/Firefox/)).toBeInTheDocument();
        expect(screen.getByText(/500 · \/api\/wallet/)).toBeInTheDocument();
    });
});

describe('resposta', () => {
    it('envia como nota interna quando a caixa está marcada', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));

        await userEvent.click(await screen.findByLabelText(/Nota interna/i));
        await userEvent.type(screen.getByPlaceholderText(/Nota visível só para você/i), 'é o bug do candle');
        await userEvent.click(screen.getByRole('button', { name: /Salvar nota/i }));

        await waitFor(() => expect(mocks.adminReply).toHaveBeenCalled());
        expect(mocks.adminReply.mock.calls[0][1]).toMatchObject({ isInternal: true });
    });

    it('resposta comum não vai marcada como interna', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));

        await userEvent.type(await screen.findByPlaceholderText(/Resposta para o usuário/i), 'Corrigido!');
        await userEvent.click(screen.getByRole('button', { name: /Responder/i }));

        await waitFor(() => expect(mocks.adminReply).toHaveBeenCalled());
        expect(mocks.adminReply.mock.calls[0][1]).toMatchObject({ isInternal: false });
    });

    it('resposta pronta preenche o campo sem enviar nada sozinha', async () => {
        renderTab();
        await userEvent.click(await screen.findByText('Rentabilidade zerou hoje'));

        await userEvent.click(await screen.findByRole('button', { name: 'Recebido' }));

        expect(await screen.findByDisplayValue(/Recebemos seu ticket/i)).toBeInTheDocument();
        expect(mocks.adminReply).not.toHaveBeenCalled();
    });
});
