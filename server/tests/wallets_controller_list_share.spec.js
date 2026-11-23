/**
 * walletsController — listagem, renomear e compartilhamento público (C4).
 * Complementa wallets_controller.spec.js (teto, delete, carteira ativa). Sem
 * rede/DB: os models são mockados.
 *
 * O que trava aqui:
 * - a lista nunca expõe publicToken de carteira que não está pública;
 * - carteira ativa órfã (apagada) cai na mais antiga, como no resolveWallet;
 * - compartilhar gera token só na 1ª vez ou com `regenerate`; revogar zera o token;
 * - carteira de outro usuário dá 404 e nada é gravado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/Wallet.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), countDocuments: vi.fn(), create: vi.fn(), exists: vi.fn() },
}));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  listWallets, renameWallet, shareWallet, unshareWallet, createWallet, setActiveWallet,
} = await import('../controllers/walletsController.js');
const Wallet = (await import('../models/Wallet.js')).default;
const User = (await import('../models/User.js')).default;

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (over = {}) => ({ user: { id: 'u1', plan: 'PRO' }, params: { walletId: 'w1' }, body: {}, ...over });
const lean = (value) => ({ lean: vi.fn(() => Promise.resolve(value)) });

const D1 = new Date('2026-01-01T00:00:00Z');
const D2 = new Date('2026-02-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('walletsController — listWallets', () => {
  const wallets = [
    { _id: 'w1', name: 'Principal', isDefault: true, createdAt: D1, isPublic: true, publicToken: 'tok-1', publicShowValues: true },
    { _id: 'w2', name: 'Cripto', createdAt: D2, isPublic: false, publicToken: 'tok-antigo' },
  ];
  const mockList = (activeWalletId) => {
    Wallet.find.mockReturnValue({ sort: vi.fn(() => lean(wallets)) });
    User.findById.mockReturnValue({ select: vi.fn(() => lean({ activeWalletId })) });
  };

  it('lista as carteiras e não expõe o token de quem não está pública', async () => {
    mockList('w2');
    const res = mockRes();
    await listWallets(req(), res, vi.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.activeWalletId).toBe('w2');
    expect(body.wallets).toEqual([
      { id: 'w1', name: 'Principal', isDefault: true, createdAt: D1, isPublic: true, publicToken: 'tok-1', publicShowValues: true },
      { id: 'w2', name: 'Cripto', isDefault: false, createdAt: D2, isPublic: false, publicToken: null, publicShowValues: false },
    ]);
  });

  it('carteira ativa órfã (apagada) cai na mais antiga', async () => {
    mockList('w-apagada');
    const res = mockRes();
    await listWallets(req(), res, vi.fn());
    expect(res.json.mock.calls[0][0].activeWalletId).toBe('w1');
  });

  it('sem carteira nenhuma, a ativa é vazia', async () => {
    Wallet.find.mockReturnValue({ sort: vi.fn(() => lean([])) });
    User.findById.mockReturnValue({ select: vi.fn(() => lean(null)) });
    const res = mockRes();
    await listWallets(req(), res, vi.fn());
    expect(res.json.mock.calls[0][0]).toEqual({ wallets: [], activeWalletId: '' });
  });

  it('erro do banco vai para o next', async () => {
    const boom = new Error('mongo fora');
    Wallet.find.mockImplementation(() => { throw boom; });
    const next = vi.fn();
    await listWallets(req(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('walletsController — renameWallet', () => {
  it('renomeia só a carteira do próprio usuário, com o nome aparado', async () => {
    Wallet.findOneAndUpdate.mockResolvedValue({ _id: 'w1', name: 'Longo prazo', isDefault: false, createdAt: D1 });
    const res = mockRes();
    await renameWallet(req({ body: { name: '  Longo prazo  ' } }), res, vi.fn());

    expect(Wallet.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'w1', user: 'u1' }, { $set: { name: 'Longo prazo' } }, { new: true });
    expect(res.json).toHaveBeenCalledWith({
      message: 'Carteira renomeada.', wallet: { id: 'w1', name: 'Longo prazo', isDefault: false, createdAt: D1 },
    });
  });

  it('404 quando a carteira não é do usuário', async () => {
    Wallet.findOneAndUpdate.mockResolvedValue(null);
    const next = vi.fn();
    await renameWallet(req({ body: { name: 'X' } }), mockRes(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 404 });
  });

  it('erro do banco vai para o next', async () => {
    const boom = new Error('mongo fora');
    Wallet.findOneAndUpdate.mockRejectedValue(boom);
    const next = vi.fn();
    await renameWallet(req({ body: { name: 'X' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('walletsController — shareWallet / unshareWallet (C4)', () => {
  const walletDoc = (over = {}) => ({ _id: 'w1', publicToken: null, isPublic: false, publicShowValues: false, save: vi.fn(), ...over });

  it('primeira publicação gera token longo e só mostra valores se pedido', async () => {
    const doc = walletDoc();
    Wallet.findOne.mockResolvedValue(doc);
    const res = mockRes();
    await shareWallet(req({ body: { showValues: true } }), res, vi.fn());

    expect(Wallet.findOne).toHaveBeenCalledWith({ _id: 'w1', user: 'u1' });
    expect(doc.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Compartilhamento ativado.', isPublic: true, publicToken: doc.publicToken, publicShowValues: true,
    });
  });

  it('republicar mantém o link; `regenerate` troca o token', async () => {
    const mantido = walletDoc({ publicToken: 'tok-antigo' });
    Wallet.findOne.mockResolvedValue(mantido);
    await shareWallet(req({ body: undefined }), mockRes(), vi.fn());
    expect(mantido.publicToken).toBe('tok-antigo');
    expect(mantido.publicShowValues).toBe(false);

    const rotacionado = walletDoc({ publicToken: 'tok-antigo' });
    Wallet.findOne.mockResolvedValue(rotacionado);
    await shareWallet(req({ body: { regenerate: true } }), mockRes(), vi.fn());
    expect(rotacionado.publicToken).not.toBe('tok-antigo');
  });

  it('404 quando a carteira não é do usuário', async () => {
    Wallet.findOne.mockResolvedValue(null);
    const next = vi.fn();
    await shareWallet(req(), mockRes(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 404 });
  });

  it('erro ao gravar vai para o next', async () => {
    const boom = new Error('falha ao salvar');
    Wallet.findOne.mockResolvedValue(walletDoc({ save: vi.fn().mockRejectedValue(boom) }));
    const next = vi.fn();
    await shareWallet(req(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('revogar zera o token só na carteira do usuário', async () => {
    Wallet.findOneAndUpdate.mockResolvedValue({ _id: 'w1' });
    const res = mockRes();
    await unshareWallet(req(), res, vi.fn());
    expect(Wallet.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'w1', user: 'u1' }, { $set: { isPublic: false, publicToken: null } }, { new: true },
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Compartilhamento revogado.', isPublic: false });
  });

  it('revogar carteira alheia dá 404; erro do banco vai para o next', async () => {
    Wallet.findOneAndUpdate.mockResolvedValue(null);
    const next = vi.fn();
    await unshareWallet(req(), mockRes(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 404 });

    const boom = new Error('mongo fora');
    Wallet.findOneAndUpdate.mockRejectedValue(boom);
    const next2 = vi.fn();
    await unshareWallet(req(), mockRes(), next2);
    expect(next2).toHaveBeenCalledWith(boom);
  });
});

describe('walletsController — erros do banco em criar e trocar a ativa', () => {
  it('createWallet e setActiveWallet repassam o erro ao next', async () => {
    const boom = new Error('mongo fora');
    Wallet.countDocuments.mockRejectedValue(boom);
    const next = vi.fn();
    await createWallet(req({ body: { name: 'Nova' } }), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);

    Wallet.exists.mockRejectedValue(boom);
    const next2 = vi.fn();
    await setActiveWallet(req({ body: { walletId: 'w1' } }), mockRes(), next2);
    expect(next2).toHaveBeenCalledWith(boom);
  });
});
