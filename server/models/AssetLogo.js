
import mongoose from 'mongoose';

/**
 * Cache global de logos de ativos.
 *
 * Deduplicado por ativo (`{ ticker, type }`), NÃO por usuário/holding: uma logo é
 * armazenada uma única vez e servida a todos. As fontes (brapi/jsDelivr = SVG texto)
 * são minúsculas, então o custo de espaço é desprezível.
 *
 * `status: 'MISSING'` é um cache negativo: evita rebater a CDN para tickers sem logo
 * (ex.: 404 no provedor) até o TTL de re-tentativa vencer.
 */
const AssetLogoSchema = new mongoose.Schema({
  ticker: { type: String, required: true, uppercase: true, trim: true },
  type: {
    type: String,
    enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH'],
    required: true,
  },
  status: { type: String, enum: ['OK', 'MISSING'], required: true },

  // Preenchidos somente quando status === 'OK'
  data: { type: Buffer, default: null },
  contentType: { type: String, default: null }, // ex.: image/svg+xml, image/png
  bytes: { type: Number, default: 0 },

  source: { type: String, default: null }, // URL da CDN usada na coleta
  fetchedAt: { type: Date, default: Date.now },
}, { timestamps: true });

AssetLogoSchema.index({ ticker: 1, type: 1 }, { unique: true });

const AssetLogo = mongoose.models.AssetLogo || mongoose.model('AssetLogo', AssetLogoSchema);
export default AssetLogo;
