/**
 * Testes do ShareWalletModal (link público de carteira).
 *
 * Cobre: ligar/desligar o link (opt-in, revogável), copiar a URL, gerar novo
 * token, a preferência "Exibir valores em R$" (só persiste com o link ligado
 * e reverte se o servidor recusar) e a invalidação de ['wallets'] após cada
 * mutação.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareWalletModal } from './ShareWalletModal';
import { walletsService } from '../../services/wallets';

const addToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../services/wallets', () => ({ walletsService: { share: vi.fn(), unshare: vi.fn() } }));

const share = vi.mocked(walletsService.share);
const unshare = vi.mocked(walletsService.unshare);
type ShareRes = Awaited<ReturnType<typeof walletsService.share>>;

let client: QueryClient;

function renderModal(props: Partial<React.ComponentProps<typeof ShareWalletModal>> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <ShareWalletModal isOpen walletId="w1" walletName="Aposentadoria" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

const toggleLink = () => screen.getByRole('button', { name: 'Link público' });
const toggleValues = () => screen.getByRole('button', { name: 'Exibir valores em R$' });

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  vi.spyOn(client, 'invalidateQueries');
});

describe('ShareWalletModal', () => {
  it('fechado não renderiza', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ativa o link com a preferência atual e mostra a URL pública', async () => {
    share.mockResolvedValue({ publicToken: 'tok123' } as ShareRes);
    renderModal();
    expect(screen.getByText('Aposentadoria')).toBeInTheDocument();
    expect(toggleLink()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggleLink());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Link público ativado.', 'success'));
    expect(share).toHaveBeenCalledWith('w1', { showValues: false });
    expect(toggleLink()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Link')).toHaveValue(`${window.location.origin}/p/tok123`);
    expect(screen.getByRole('link', { name: /Abrir link/ })).toHaveAttribute('href', `${window.location.origin}/p/tok123`);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['wallets'] });
  });

  it('erro ao ativar mantém desligado e avisa', async () => {
    share.mockRejectedValue(new Error('Plano não permite.'));
    renderModal();
    fireEvent.click(toggleLink());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Plano não permite.', 'error'));
    expect(toggleLink()).toHaveAttribute('aria-pressed', 'false');
  });

  it('revoga o link já público', async () => {
    unshare.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof walletsService.unshare>>);
    renderModal({ initialIsPublic: true, initialToken: 'abc' });
    fireEvent.click(toggleLink());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Link público revogado.', 'success'));
    expect(unshare).toHaveBeenCalledWith('w1');
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('erro ao revogar usa a mensagem padrão', async () => {
    unshare.mockRejectedValue({});
    renderModal({ initialIsPublic: true, initialToken: 'abc' });
    fireEvent.click(toggleLink());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível revogar o link.', 'error'));
  });

  it('copia a URL e informa falha de cópia', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('negado'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderModal({ initialIsPublic: true, initialToken: 'abc' });

    fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/abc`);

    fireEvent.click(screen.getByRole('button', { name: /Copiado/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível copiar. Copie manualmente.', 'error'));
  });

  it('gera novo link com regenerate e troca a URL', async () => {
    share.mockResolvedValueOnce({ publicToken: 'novo' } as ShareRes).mockRejectedValueOnce({});
    renderModal({ initialIsPublic: true, initialToken: 'velho', initialShowValues: true });
    fireEvent.click(screen.getByRole('button', { name: /Gerar novo link/ }));
    await waitFor(() => expect(screen.getByLabelText('Link')).toHaveValue(`${window.location.origin}/p/novo`));
    expect(share).toHaveBeenCalledWith('w1', { showValues: true, regenerate: true });
    expect(addToast).toHaveBeenCalledWith('Novo link gerado. O anterior foi desativado.', 'success');

    fireEvent.click(screen.getByRole('button', { name: /Gerar novo link/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível gerar um novo link.', 'error'));
  });

  it('"Exibir valores" persiste com o link ligado e reverte se o servidor recusar', async () => {
    share.mockResolvedValueOnce({ publicToken: 'abc' } as ShareRes).mockRejectedValueOnce(new Error('Falhou.'));
    renderModal({ initialIsPublic: true, initialToken: 'abc' });

    fireEvent.click(toggleValues());
    await waitFor(() => expect(share).toHaveBeenCalledWith('w1', { showValues: true }));
    await waitFor(() => expect(toggleValues()).toBeEnabled());
    expect(toggleValues()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggleValues());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Falhou.', 'error'));
    expect(toggleValues()).toHaveAttribute('aria-pressed', 'true');
  });

  it('fundo e botões de fechar chamam onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    screen.getAllByRole('button', { name: 'Fechar' }).forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
