
import mongoose from 'mongoose';

/**
 * Curva contínua da "Carteira Recomendada" — backtest event-driven de UMA carteira
 * que segue as recomendações da Research ao longo do tempo, rebalanceando a cada
 * publicação (entradas e saídas). 1 documento por assetClass + profile.
 *
 * Os retornos são CUMULATIVOS a partir de `base` (value/base - 1). O recorte por
 * janela (7/30/60/90D) e o rebase para o início da janela são feitos no controller.
 */

const CurvePointSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  equityReturn: { type: Number, default: 0 }, // retorno cumulativo da carteira (fração: 0.05 = +5%)
  ibovReturn: { type: Number, default: 0 },
  spxReturn: { type: Number, default: 0 },
  cdiReturn: { type: Number, default: 0 },
  ifixReturn: { type: Number, default: 0 },
  btcReturn: { type: Number, default: 0 }, // benchmark de cripto (buy & hold BTC)
  holdingsCount: { type: Number, default: 0 },
  lastRebalanceDate: { type: String, default: null }, // YYYY-MM-DD da última troca de cesta vigente
}, { _id: false });

const RebalanceSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  holdings: [String],
  added: [String],
  removed: [String],
}, { _id: false });

const RecommendedPortfolioCurveSchema = new mongoose.Schema({
  assetClass: { type: String, required: true }, // BRASIL_10 | STOCK | FII | STOCK_US | REIT | CRYPTO | ETF_BR | ETF_US
  profile: { type: String, default: 'MODERATE' }, // DEFENSIVE | MODERATE | BOLD
  base: { type: Date, required: true }, // data-base (1ª publicação considerada)
  lastRebuild: { type: Date, default: Date.now },
  points: [CurvePointSchema],
  rebalances: [RebalanceSchema],
});

RecommendedPortfolioCurveSchema.index({ assetClass: 1, profile: 1 }, { unique: true });

const RecommendedPortfolioCurve =
  mongoose.models.RecommendedPortfolioCurve ||
  mongoose.model('RecommendedPortfolioCurve', RecommendedPortfolioCurveSchema);

export default RecommendedPortfolioCurve;
