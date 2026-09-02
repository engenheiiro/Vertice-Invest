import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startSession: vi.fn() }));
vi.mock('mongoose', () => ({ default: { startSession: mocks.startSession } }));

const { runTransaction, txError } = await import('../utils/dbTransaction.js');

const makeSession = () => ({
  startTransaction: vi.fn(),
  commitTransaction: vi.fn().mockResolvedValue(),
  abortTransaction: vi.fn().mockResolvedValue(),
  endSession: vi.fn().mockResolvedValue(),
});

describe('runTransaction — resiliência de commit, rollback e timeout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('commita sucesso e sempre encerra a sessão', async () => {
    const session = makeSession();
    mocks.startSession.mockResolvedValue(session);
    const callback = vi.fn().mockResolvedValue();

    await runTransaction(callback, 100);

    expect(session.startTransaction).toHaveBeenCalledWith({ maxCommitTimeMS: 100 });
    expect(callback).toHaveBeenCalledWith(session);
    expect(session.commitTransaction).toHaveBeenCalledOnce();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('aborta e preserva o erro original do callback', async () => {
    const session = makeSession();
    mocks.startSession.mockResolvedValue(session);
    const original = new Error('write failed');

    await expect(runTransaction(async () => { throw original; }, 100)).rejects.toBe(original);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledOnce();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('falha de rollback não mascara a causa original', async () => {
    const session = makeSession();
    const abortFailure = new Error('abort failed');
    session.abortTransaction.mockRejectedValue(abortFailure);
    mocks.startSession.mockResolvedValue(session);
    const original = new Error('primary failure');

    let captured;
    try {
      await runTransaction(async () => { throw original; }, 100);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBe(original);
    expect(captured.abortError).toBe(abortFailure);
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('timeout aborta, mas só encerra a sessão depois da operação pendente terminar', async () => {
    const session = makeSession();
    mocks.startSession.mockResolvedValue(session);
    let finishCallback;
    const callbackPending = new Promise((resolve) => { finishCallback = resolve; });

    const transactionPending = runTransaction(() => callbackPending, 5);

    await vi.waitFor(() => expect(session.abortTransaction).toHaveBeenCalledOnce());
    expect(session.endSession).not.toHaveBeenCalled();

    finishCallback();
    await expect(transactionPending).rejects.toMatchObject({
      code: 'TX_TIMEOUT',
      message: 'MongoDB transaction timed out after 5ms',
    });
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('preserva o timeout e anexa a falha tardia do callback para diagnóstico', async () => {
    const session = makeSession();
    mocks.startSession.mockResolvedValue(session);
    let failCallback;
    const callbackPending = new Promise((_, reject) => { failCallback = reject; });
    const lateFailure = new Error('operation interrupted by abort');

    const transactionPending = runTransaction(() => callbackPending, 5);
    await vi.waitFor(() => expect(session.abortTransaction).toHaveBeenCalledOnce());
    failCallback(lateFailure);

    await expect(transactionPending).rejects.toMatchObject({
      code: 'TX_TIMEOUT',
      callbackError: lateFailure,
    });
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('txError conserva status HTTP sem alterar a mensagem', () => {
    expect(txError(409, 'conflito')).toMatchObject({ httpStatus: 409, message: 'conflito' });
  });
});
