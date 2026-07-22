import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/logoService.js', () => ({ logoService: { getOrFetch: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));

const { logoService } = await import('../services/logoService.js');
const { getAssetLogo } = await import('../controllers/marketController.js');

const response = () => {
  const res = { statusCode: 200, headers: {} };
  res.status = (status) => { res.statusCode = status; return res; };
  res.set = (key, value) => { res.headers[key] = value; return res; };
  res.end = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
};

describe('rota pública de logo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita ticker que poderia alterar o caminho da busca externa', async () => {
    const res = response();
    await getAssetLogo({ params: { ticker: '../metadata' }, query: {}, headers: {} }, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(logoService.getOrFetch).not.toHaveBeenCalled();
  });

  it('normaliza um símbolo válido e restringe o tipo ao allowlist', async () => {
    logoService.getOrFetch.mockResolvedValue({ data: Buffer.from('x'), contentType: 'image/svg+xml', bytes: 1 });
    const res = response();
    await getAssetLogo({ params: { ticker: ' petr4 ' }, query: { type: 'unknown' }, headers: {} }, res, vi.fn());

    expect(logoService.getOrFetch).toHaveBeenCalledWith('PETR4', 'STOCK');
    expect(res.send).toHaveBeenCalledOnce();
  });
});
