import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regressão: GET /research/signals entregava o payload ÍNTEGRO (ticker, value,
// quality, urgency) a qualquer autenticado — inclusive GUEST. O "atraso" do
// ESSENTIAL era só a `message` reescrita no client, visível na aba Network.
// Agora o gate é autoritativo no backend: GUEST não recebe sinal, ESSENTIAL
// recebe os reais com 1h de defasagem (corte no filtro do banco), PRO+ em
// tempo real.

// aiEnhancementService instancia o cliente Gemini no load (exige API_KEY) — mocka p/ isolar.
vi.mock('../services/aiEnhancementService.js', () => ({ aiEnhancementService: {} }));
vi.mock('../models/QuantSignal.js', () => ({ default: { find: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const QuantSignal = (await import('../models/QuantSignal.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { getSignalAccess, SIGNAL_DELAY_MINUTES } = await import('../config/subscription.js');
const { getQuantSignals } = await import('../controllers/researchController.js');

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const SIGNAL = {
  _id: 's1', ticker: 'PETR4', status: 'ACTIVE', type: 'RSI_OVERSOLD',
  value: 22, quality: 'GOLD', urgencyLevel: 'CRITICAL', timestamp: new Date(),
};

// Captura o filtro que chegou ao banco — é ali que o atraso é aplicado.
let lastQuery = null;
const mockFind = (docs) => {
  QuantSignal.find.mockImplementation((query) => {
    lastQuery = query;
    return { sort: () => ({ limit: () => ({ lean: async () => docs }) }) };
  });
};

const callAs = async (user, docs = [SIGNAL]) => {
  mockFind(docs);
  const res = response();
  await getQuantSignals({ query: {}, user }, res, vi.fn());
  return res;
};

describe('Sinais quantitativos — gate de plano autoritativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQuery = null;
    SystemConfig.findOne.mockReturnValue({ lean: async () => null });
    MarketAsset.find.mockReturnValue({ select: async () => [] });
  });

  it('não entrega nenhum sinal a um GUEST', async () => {
    const res = await callAs({ plan: 'GUEST', role: 'USER' });

    expect(res.statusCode).toBe(200);
    expect(res.body.signals).toEqual([]);
    expect(res.body.access.tier).toBe('NONE');
    // Nem chega a consultar sinais — não há o que vazar.
    expect(QuantSignal.find).not.toHaveBeenCalled();
  });

  it('não vaza ticker nem valor no payload do GUEST', async () => {
    const res = await callAs({ plan: 'GUEST', role: 'USER' });
    const serialized = JSON.stringify(res.body);

    expect(serialized).not.toContain('PETR4');
    expect(serialized).not.toContain('RSI_OVERSOLD');
  });

  it('trata usuário sem plano/ausente como GUEST (fail-closed)', async () => {
    for (const user of [undefined, {}, { plan: 'PLANO_INEXISTENTE' }]) {
      const res = await callAs(user);
      expect(res.body.access.tier).toBe('NONE');
      expect(res.body.signals).toEqual([]);
    }
  });

  it('aplica 1h de atraso real no filtro do banco para ESSENTIAL', async () => {
    const before = Date.now();
    const res = await callAs({ plan: 'ESSENTIAL', role: 'USER' });

    expect(res.body.access).toEqual({ tier: 'DELAYED', delayMinutes: 60 });
    // O corte é por timestamp, na origem — não uma máscara pós-consulta.
    expect(lastQuery.timestamp.$lte).toBeInstanceOf(Date);
    const cutoffAgeMs = before - lastQuery.timestamp.$lte.getTime();
    expect(cutoffAgeMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(cutoffAgeMs).toBeLessThan(61 * 60 * 1000);
  });

  it('entrega o sinal ÍNTEGRO ao ESSENTIAL (defasado, nunca adulterado)', async () => {
    const res = await callAs({ plan: 'ESSENTIAL', role: 'USER' });

    expect(res.body.signals).toHaveLength(1);
    expect(res.body.signals[0]).toMatchObject({ ticker: 'PETR4', value: 22, quality: 'GOLD' });
  });

  it('entrega em tempo real para PRO, ELITE e BLACK', async () => {
    for (const plan of ['PRO', 'ELITE', 'BLACK']) {
      const res = await callAs({ plan, role: 'USER' });
      expect(res.body.access, plan).toEqual({ tier: 'REALTIME', delayMinutes: 0 });
      expect(lastQuery.timestamp, `${plan} não deve ter corte temporal`).toBeUndefined();
      expect(res.body.signals).toHaveLength(1);
    }
  });

  it('trata ADMIN como tempo real mesmo com plano baixo (QA/suporte)', async () => {
    const res = await callAs({ plan: 'GUEST', role: 'ADMIN' });

    expect(res.body.access.tier).toBe('REALTIME');
    expect(lastQuery.timestamp).toBeUndefined();
  });

  it('mantém o atraso no modo history=true (não é rota de escape)', async () => {
    mockFind([SIGNAL]);
    const res = response();
    await getQuantSignals({ query: { history: 'true' }, user: { plan: 'ESSENTIAL' } }, res, vi.fn());

    expect(lastQuery.timestamp.$lte).toBeInstanceOf(Date);
    expect(res.body.access.tier).toBe('DELAYED');
  });

  it('expõe a contagem agregada no meta como isca de upsell, sem identificar ativo', async () => {
    SystemConfig.findOne.mockReturnValue({
      lean: async () => ({ value: { lastScanAt: new Date().toISOString(), activeSignalsTotal: 12, assetsScanned: 300 } }),
    });
    const res = await callAs({ plan: 'GUEST', role: 'USER' });

    expect(res.body.meta.activeSignalsTotal).toBe(12);
    expect(res.body.signals).toEqual([]);
  });

  it('mantém a matriz de atraso coerente com a tabela de planos', () => {
    expect(SIGNAL_DELAY_MINUTES.GUEST).toBeNull();
    expect(SIGNAL_DELAY_MINUTES.ESSENTIAL).toBe(60);
    for (const plan of ['PRO', 'ELITE', 'BLACK']) {
      expect(getSignalAccess({ plan }).tier).toBe('REALTIME');
    }
  });
});
