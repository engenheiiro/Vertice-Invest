/**
 * Testes do WalletSwitcher (seletor de carteira ativa do Header).
 *
 * Cobre: oculto em modo demo, versão compacta com rótulo, troca de carteira
 * (clique e teclado; mesma carteira não troca; troca em andamento bloqueia),
 * exclusão com confirmação (e só com 2+ carteiras), abertura dos modais de
 * renomear/criar/compartilhar, limite de carteiras do plano e clique fora.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { WalletSwitcher } from './WalletSwitcher';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

const addToast = vi.fn();
const confirm = vi.fn();
const navigate = vi.fn();
const setActiveWallet = vi.fn();
const deleteWallet = vi.fn();
let walletLimit = 5;

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirm }));
vi.mock('../../hooks/useFeatureAccess', () => ({ useFeatureAccess: () => ({ limitFor: () => walletLimit }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('./RenameWalletModal', () => ({
  RenameWalletModal: ({ isOpen, mode, currentName }: { isOpen: boolean; mode: string; currentName: string }) =>
    (isOpen ? <div>{`modal-${mode}:${currentName}`}</div> : null),
}));
vi.mock('./ShareWalletModal', () => ({
  ShareWalletModal: (p: { isOpen: boolean; walletName?: string; initialIsPublic: boolean; initialToken: string | null }) =>
    (p.isOpen ? <div>{`share:${p.walletName}:${p.initialIsPublic}:${p.initialToken}`}</div> : null),
}));

const WALLETS = [
  { id: 'w1', name: 'Principal', isPublic: false },
  { id: 'w2', name: 'Aposentadoria', isPublic: true, publicToken: 'tok' },
];

function setup(over: Record<string, unknown> = {}, demo = false) {
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: demo } as unknown as ReturnType<typeof useDemo>);
  vi.mocked(useWallet).mockReturnValue({
    wallets: WALLETS, activeWalletId: 'w1', activeWalletName: 'Principal', isWalletsLoading: false,
    isSwitchingWallet: false, setActiveWallet, deleteWallet, ...over,
  } as unknown as ReturnType<typeof useWallet>);
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Principal', expanded: false }));
const trigger = () => screen.getByRole('button', { name: 'Principal', expanded: true });
const items = () => screen.queryAllByRole('listitem');
/** Botão de trocar de carteira: o primeiro da linha; compartilhar/renomear/excluir são irmãos dele. */
const selectButton = (i: number) => within(items()[i]).getAllByRole('button')[0];

beforeEach(() => {
  vi.clearAllMocks();
  walletLimit = 5;
  setup();
});

describe('WalletSwitcher', () => {
  it('não aparece em modo demo', () => {
    setup({}, true);
    const { container } = render(<WalletSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('compacto tem rótulo acessível com a carteira ativa', () => {
    render(<WalletSwitcher compact />);
    expect(screen.getByRole('button', { name: 'Trocar carteira. Carteira ativa: Principal' })).toBeInTheDocument();
  });

  it('abre a lista, marca a pública e troca de carteira', async () => {
    const { container } = render(<WalletSwitcher />);
    open();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('list', { name: 'Minhas Carteiras' })).getAllByRole('listitem')).toHaveLength(2);
    expect(selectButton(0)).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Carteira pública')).toBeInTheDocument();
    // Lista simples com o botão de trocar e as ações como irmãos (antes: menuitem fora de menu, aninhado).
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByText('Aposentadoria'));
    await waitFor(() => expect(setActiveWallet).toHaveBeenCalledWith('w2'));
    expect(items()).toHaveLength(0);
  });

  it('teclado troca (botão nativo: Enter/Espaço); a carteira já ativa só fecha a lista', async () => {
    render(<WalletSwitcher />);
    open();
    // <button type="button"> nativo: Enter e Espaço disparam o clique no navegador.
    expect(selectButton(0).tagName).toBe('BUTTON');
    expect(selectButton(0)).toHaveAttribute('type', 'button');
    fireEvent.click(selectButton(0));
    expect(setActiveWallet).not.toHaveBeenCalled();
    expect(items()).toHaveLength(0);

    open();
    fireEvent.click(selectButton(1));
    await waitFor(() => expect(setActiveWallet).toHaveBeenCalledWith('w2'));
  });

  it('carregando mostra o aviso; trocando desabilita o botão', () => {
    setup({ isWalletsLoading: true });
    const { rerender } = render(<WalletSwitcher />);
    open();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    setup({ isSwitchingWallet: true });
    rerender(<WalletSwitcher />);
    const busy = screen.getAllByRole('button', { name: 'Principal' })[0];
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });

  it('exclui depois de confirmar e avisa o resultado', async () => {
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    deleteWallet.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Carteira com metas.'));
    render(<WalletSwitcher />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Aposentadoria' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Carteira excluída.', 'success'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Excluir carteira?', isDestructive: true }));
    expect(setActiveWallet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Aposentadoria' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(deleteWallet).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Principal' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Carteira com metas.', 'error'));
  });

  it('com uma carteira só não há botão de excluir', () => {
    setup({ wallets: [WALLETS[0]] });
    render(<WalletSwitcher />);
    open();
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument();
  });

  it('abre renomear, compartilhar e nova carteira', () => {
    render(<WalletSwitcher />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Renomear Aposentadoria' }));
    expect(screen.getByText('modal-rename:Aposentadoria')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar Aposentadoria' }));
    expect(screen.getByText('share:Aposentadoria:true:tok')).toBeInTheDocument();

    open();
    fireEvent.click(screen.getByRole('button', { name: /Nova Carteira/ }));
    expect(screen.getByText('modal-create:')).toBeInTheDocument();
  });

  it('no limite do plano oferece upgrade', () => {
    walletLimit = 2;
    render(<WalletSwitcher />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /fazer upgrade/ }));
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });

  it('clique fora fecha a lista', () => {
    render(<WalletSwitcher />);
    open();
    fireEvent.mouseDown(screen.getByText('Minhas Carteiras'));
    expect(items()).toHaveLength(2);
    fireEvent.mouseDown(document.body);
    expect(items()).toHaveLength(0);
  });
});
