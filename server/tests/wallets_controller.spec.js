/**
 * B3 (E3) — cobertura do walletsController: teto de carteiras, bloqueio de
 * apagar a última carteira, cascata de delete (ativos/transações/snapshots/
 * metas) + realocação da carteira ativa, e ownership 403 no setActiveWallet.
 * Sem rede/DB — mongoose, models e dbTransaction são mockados (mesmo padrão
 * de wallet_delete_transaction.spec.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeSession = { id: 'fake-session' };

vi.mock('../utils/dbTransaction.js', () => ({
  runTransaction: vi.fn((fn) => fn(fakeSession)),
  txError: (httpStatus, message) => Object.assign(new Error(message), { httpStatus }),
}));
vi.mock('../models/Wallet.js', () => ({
  default: {
    countDocuments: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
    deleteOne: vi.fn(),
    exists: vi.fn(),
  },
}));
vi.mock('../models/User.js', () => ({
  default: { findById: vi.fn(), updateOne: vi.fn() },
}));
vi.mock('../models/UserAsset.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../models/InvestmentGoal.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../models/GoalContribution.js', () => ({ default: { deleteMany: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { createWallet, deleteWallet, setActiveWallet } = await import('../controllers/walletsController.js');
const Wallet = (await import('../models/Wallet.js')).default;
const User = (await import('../models/User.js')).default;
const UserAsset = (await import('../models/UserAsset.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const WalletSnapshot = (await import('../models/WalletSnapshot.js')).default;
const InvestmentGoal = (await import('../models/InvestmentGoal.js')).default;
const GoalContribution = (await import('../models/GoalContribution.js')).default;

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

// Cadeias Mongoose usadas pelo controller real, mockadas por formato:
// findOne/deleteMany/deleteOne(...).session(session) → resolve direto (sem .lean()).
const chainable = (resolved) => ({ session: vi.fn(() => Promise.resolve(resolved)) });
// User.findById(...).select(...).session(session).lean() e
// Wallet.findOne(...).sort(...).session(session).lean() → .session() retorna
// objeto com .lean(), não resolve direto (um nível a mais que `chainable`).
const sessionThenLean = (resolved) => ({ session: vi.fn(() => ({ lean: vi.fn(() => Promise.resolve(resolved)) })) });
const userFindByIdChain = (resolved) => ({ select: vi.fn(() => sessionThenLean(resolved)) });
const findOneSortChain = (resolved) => ({ sort: vi.fn(() => sessionThenLean(resolved)) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('walletsController — createWallet (teto de carteiras)', () => {
  const create = async (plan, count, role = 'USER') => {
    Wallet.countDocuments.mockResolvedValue(count);
    Wallet.create.mockResolvedValue({ _id: 'w9', name: 'Carteira Extra', createdAt: new Date('2026-07-10') });
    const req = { user: { id: 'u1', plan, role }, body: { name: '  Carteira Extra  ' } };
    const res = mockRes();
    const next = vi.fn();
    await createWallet(req, res, next);
    return { res, next };
  };

  it('bloqueia a criação ao atingir o teto ABSOLUTO de 15 carteiras (400, sem upsell)', async () => {
    const { next } = await create('PRO', 15);

    expect(Wallet.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });

  // Onda 3 do plano comercial: 1 carteira no Free, 3 no Essential, ilimitadas
  // do Pro para cima. Bloqueio de PLANO responde 403 (é convite a assinar),
  // não 400 — o front distingue os dois casos pela mensagem.
  it.each([
    ['GUEST', 1],
    ['ESSENTIAL', 3],
  ])('bloqueia %s ao atingir o teto do plano (403 com upsell)', async (plan, limite) => {
    const { next } = await create(plan, limite);

    expect(Wallet.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it.each([
    ['GUEST', 0],
    ['ESSENTIAL', 2],
    ['PRO', 3],
  ])('cria normalmente para %s abaixo do teto do plano', async (plan, count) => {
    const { res, next } = await create(plan, count);

    expect(Wallet.create).toHaveBeenCalledWith({ user: 'u1', name: 'Carteira Extra' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('plano ausente ou desconhecido cai no degrau do Free (fail-closed)', async () => {
    const semPlano = await create(undefined, 1);
    expect(semPlano.next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));

    const desconhecido = await create('PLANO_QUE_NAO_EXISTE', 1);
    expect(desconhecido.next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('ADMIN vai até o teto absoluto, independente do plano', async () => {
    const { res, next } = await create('GUEST', 14, 'ADMIN');

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('walletsController — deleteWallet', () => {
  it('bloqueia apagar a última carteira do usuário', async () => {
    Wallet.countDocuments.mockResolvedValue(1);
    const req = { user: { id: 'u1' }, params: { walletId: 'w1' } };
    const res = mockRes();
    const next = vi.fn();

    await deleteWallet(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    expect(Wallet.deleteOne).not.toHaveBeenCalled();
  });

  it('cascata: apaga ativos/transações/snapshots/metas e realoca a carteira ativa quando a apagada era a corrente', async () => {
    Wallet.countDocuments.mockResolvedValue(2);
    Wallet.findOne
      // 1ª chamada: busca a própria carteira a apagar (dentro da transação)
      .mockReturnValueOnce(chainable({ _id: 'w1', user: 'u1' }))
      // 2ª chamada: fallback para a mais antiga restante
      .mockReturnValueOnce(findOneSortChain({ _id: 'w2' }));
    UserAsset.deleteMany.mockReturnValue(chainable({}));
    AssetTransaction.deleteMany.mockReturnValue(chainable({}));
    WalletSnapshot.deleteMany.mockReturnValue(chainable({}));
    GoalContribution.deleteMany.mockReturnValue(chainable({}));
    InvestmentGoal.deleteMany.mockReturnValue(chainable({}));
    Wallet.deleteOne.mockReturnValue(chainable({}));
    User.findById.mockReturnValue(userFindByIdChain({ activeWalletId: 'w1' }));
    User.updateOne.mockResolvedValue({});

    const req = { user: { id: 'u1' }, params: { walletId: 'w1' } };
    const res = mockRes();
    const next = vi.fn();

    await deleteWallet(req, res, next);

    expect(UserAsset.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(AssetTransaction.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(WalletSnapshot.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(GoalContribution.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(InvestmentGoal.deleteMany).toHaveBeenCalledWith({ user: 'u1', wallet: 'w1' });
    expect(Wallet.deleteOne).toHaveBeenCalledWith({ _id: 'w1' });
    // Era a ativa: realoca para a mais antiga restante (w2).
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: 'u1' },
      { $set: { activeWalletId: 'w2' } },
      { session: fakeSession },
    );
    expect(next).not.toHaveBeenCalled();
    // Devolve a nova ativa direto na resposta (evita 2º round-trip no front).
    expect(res.json).toHaveBeenCalledWith({ message: 'Carteira excluída.', activeWalletId: 'w2' });
  });

  it('não mexe em activeWalletId quando a carteira apagada não era a ativa', async () => {
    Wallet.countDocuments.mockResolvedValue(2);
    Wallet.findOne.mockReturnValueOnce(chainable({ _id: 'w1', user: 'u1' }));
    UserAsset.deleteMany.mockReturnValue(chainable({}));
    AssetTransaction.deleteMany.mockReturnValue(chainable({}));
    WalletSnapshot.deleteMany.mockReturnValue(chainable({}));
    GoalContribution.deleteMany.mockReturnValue(chainable({}));
    InvestmentGoal.deleteMany.mockReturnValue(chainable({}));
    Wallet.deleteOne.mockReturnValue(chainable({}));
    User.findById.mockReturnValue(userFindByIdChain({ activeWalletId: 'w2' })); // ativa é outra

    const req = { user: { id: 'u1' }, params: { walletId: 'w1' } };
    const res = mockRes();
    const next = vi.fn();

    await deleteWallet(req, res, next);

    expect(User.updateOne).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Carteira excluída.' });
  });

  it('404 quando a carteira não existe (ou não pertence ao usuário)', async () => {
    Wallet.countDocuments.mockResolvedValue(2);
    Wallet.findOne.mockReturnValueOnce(chainable(null));

    const req = { user: { id: 'u1' }, params: { walletId: 'nope' } };
    const res = mockRes();
    const next = vi.fn();

    await deleteWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(Wallet.deleteOne).not.toHaveBeenCalled();
  });
});

describe('walletsController — setActiveWallet (ownership)', () => {
  it('403 quando a carteira não pertence ao usuário', async () => {
    Wallet.exists.mockResolvedValue(false);
    const req = { user: { id: 'u1' }, body: { walletId: 'w-outro-user' } };
    const res = mockRes();
    const next = vi.fn();

    await setActiveWallet(req, res, next);

    expect(User.updateOne).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('troca normalmente quando a carteira pertence ao usuário', async () => {
    Wallet.exists.mockResolvedValue(true);
    User.updateOne.mockResolvedValue({});
    const req = { user: { id: 'u1' }, body: { walletId: 'w2' } };
    const res = mockRes();
    const next = vi.fn();

    await setActiveWallet(req, res, next);

    expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1' }, { $set: { activeWalletId: 'w2' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Carteira ativa atualizada.', activeWalletId: 'w2' });
  });
});
