/**
 * B3 (E3) — cobertura do resolveWallet: único ponto de autorização de toda a
 * feature de múltiplas carteiras. Ordem de resolução documentada no próprio
 * middleware: (1) walletId explícito (valida posse, 403 se não for do usuário),
 * (2) User.activeWalletId (se ainda existir), (3) primeira carteira do usuário,
 * (4) 400 se o usuário não tiver nenhuma carteira. Sem rede/DB — models mockados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/Wallet.js', () => ({
  default: { exists: vi.fn(), findOne: vi.fn() },
}));
vi.mock('../models/User.js', () => ({
  default: { findById: vi.fn() },
}));

const { resolveWallet } = await import('../middleware/resolveWallet.js');
const Wallet = (await import('../models/Wallet.js')).default;
const User = (await import('../models/User.js')).default;

const chainable = (resolved) => ({ select: vi.fn(() => ({ lean: vi.fn(() => Promise.resolve(resolved)) })) });
const chainableSort = (resolved) => ({
  sort: vi.fn(() => ({ select: vi.fn(() => ({ lean: vi.fn(() => Promise.resolve(resolved)) })) })),
});

beforeEach(() => vi.clearAllMocks());

describe('resolveWallet — walletId explícito', () => {
  it('aceita e anexa req.walletId quando a carteira pertence ao usuário (query)', async () => {
    Wallet.exists.mockResolvedValue(true);
    const req = { user: { id: 'u1' }, query: { walletId: 'w1' }, body: {} };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(Wallet.exists).toHaveBeenCalledWith({ _id: 'w1', user: 'u1' });
    expect(req.walletId).toBe('w1');
    expect(next).toHaveBeenCalledWith(); // sem erro
  });

  it('403 quando o walletId explícito (body) não pertence ao usuário', async () => {
    Wallet.exists.mockResolvedValue(false);
    const req = { user: { id: 'u1' }, query: {}, body: { walletId: 'w-outro-user' } };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(req.walletId).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});

describe('resolveWallet — fallback sem walletId explícito', () => {
  it('usa User.activeWalletId quando a carteira ainda existe', async () => {
    User.findById.mockReturnValue(chainable({ activeWalletId: 'w1' }));
    Wallet.exists.mockResolvedValue(true); // ainda existe
    const req = { user: { id: 'u1' }, query: {}, body: {} };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(Wallet.exists).toHaveBeenCalledWith({ _id: 'w1', user: 'u1' });
    expect(req.walletId).toBe('w1');
    expect(next).toHaveBeenCalledWith();
  });

  it('cai para a primeira carteira quando o activeWalletId aponta pra carteira apagada', async () => {
    User.findById.mockReturnValue(chainable({ activeWalletId: 'w-apagada' }));
    Wallet.exists.mockResolvedValue(false); // órfã — foi apagada
    Wallet.findOne.mockReturnValue(chainableSort({ _id: 'w-mais-antiga' }));
    const req = { user: { id: 'u1' }, query: {}, body: {} };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(Wallet.findOne).toHaveBeenCalledWith({ user: 'u1' });
    expect(req.walletId).toBe('w-mais-antiga');
    expect(next).toHaveBeenCalledWith();
  });

  it('cai para a primeira carteira quando o usuário não tem activeWalletId', async () => {
    User.findById.mockReturnValue(chainable({ activeWalletId: null }));
    Wallet.findOne.mockReturnValue(chainableSort({ _id: 'w-mais-antiga' }));
    const req = { user: { id: 'u1' }, query: {}, body: {} };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(Wallet.exists).not.toHaveBeenCalled(); // não valida posse de null
    expect(req.walletId).toBe('w-mais-antiga');
    expect(next).toHaveBeenCalledWith();
  });

  it('400 quando o usuário não tem nenhuma carteira', async () => {
    User.findById.mockReturnValue(chainable({ activeWalletId: null }));
    Wallet.findOne.mockReturnValue(chainableSort(null));
    const req = { user: { id: 'u1' }, query: {}, body: {} };
    const next = vi.fn();

    await resolveWallet(req, {}, next);

    expect(req.walletId).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });
});
