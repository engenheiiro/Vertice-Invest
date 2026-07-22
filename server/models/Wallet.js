
import mongoose from 'mongoose';

/**
 * Uma carteira nomeada de um usuário (Fase 2 — múltiplas carteiras).
 *
 * Os campos `target*` eram, até a Fase 1, exclusivos de `User` (uma alocação-alvo
 * por conta). Como cada carteira agora tem sua própria alocação-alvo/metas de
 * renda (decisão de produto: Rebalanceamento/Aporte Inteligente operam por
 * carteira, não agregando a conta inteira), eles migraram para cá — mesmos
 * defaults de sempre, só que 1 conjunto por Wallet em vez de 1 por User.
 */
const WalletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },

  // Informativo — a carteira ATIVA de verdade é User.activeWalletId. isDefault só
  // marca a carteira criada pela migração (usada como fallback quando não há
  // activeWalletId setado, ex. logo após a migração).
  isDefault: { type: Boolean, default: false },

  // --- Carteira Ideal (alocação-alvo definida pelo usuário) — por carteira ---
  targetAllocation: {
    type: new mongoose.Schema({
      STOCK: { type: Number, default: 0 },
      FII: { type: Number, default: 0 },
      STOCK_US: { type: Number, default: 0 },
      ETF: { type: Number, default: 0 },
      CRYPTO: { type: Number, default: 0 },
      FIXED_INCOME: { type: Number, default: 0 },
      // OURO mantido por compatibilidade com carteiras antigas; não é mais oferecido
      // na UI (ouro entra como ETF lastreado, ex. GLD/GOLD11).
      OURO: { type: Number, default: 0 },
    }, { _id: false }),
    default: () => ({ STOCK: 40, FII: 30, STOCK_US: 20, ETF: 0, CRYPTO: 10, FIXED_INCOME: 0, OURO: 0 }),
  },
  targetReserve: { type: Number, default: 10000 },
  // Meta de renda passiva mensal em proventos (R$) DESTA carteira. default 0 =
  // "sem meta definida" (distinto de "meta zerada").
  targetMonthlyDividendIncome: { type: Number, default: 0 },

  // --- Sub-metas de alocação (ramificação dentro de uma classe), por carteira ---
  targetSubAllocation: {
    type: new mongoose.Schema({
      // Ações BR ramifica em ações individuais / ETFs nacionais (BRL). O ETF nacional
      // deixou de ser classe de topo (targetAllocation.ETF, legado) e conta aqui.
      STOCK: {
        type: new mongoose.Schema({
          STOCK: { type: Number, default: 0 },
          ETF: { type: Number, default: 0 },
        }, { _id: false }),
        default: () => ({ STOCK: 0, ETF: 0 }),
      },
      FIXED_INCOME: {
        type: new mongoose.Schema({
          IPCA: { type: Number, default: 0 },
          POS: { type: Number, default: 0 },
          PRE: { type: Number, default: 0 },
        }, { _id: false }),
        default: () => ({ IPCA: 0, POS: 0, PRE: 0 }),
      },
      STOCK_US: {
        type: new mongoose.Schema({
          STOCK: { type: Number, default: 0 },
          REIT: { type: Number, default: 0 },
          ETF: { type: Number, default: 0 },
          DOLLAR: { type: Number, default: 0 },
        }, { _id: false }),
        default: () => ({ STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 }),
      },
    }, { _id: false }),
    default: () => ({
      STOCK: { STOCK: 0, ETF: 0 },
      FIXED_INCOME: { IPCA: 0, POS: 0, PRE: 0 },
      STOCK_US: { STOCK: 0, REIT: 0, ETF: 0, DOLLAR: 0 },
    }),
  },

  // --- Compartilhamento público (C4) — carteira somente-leitura por link ---
  // Off por padrão (opt-in). Ao ligar, gera um publicToken aleatório; ao revogar,
  // token volta a null e a rota pública deixa de resolver. `sparse` no índice
  // único garante que múltiplas carteiras com token=null não colidam.
  publicToken: { type: String, default: null },
  isPublic: { type: Boolean, default: false },
  // Por padrão a página pública mascara valores em R$ (mostra só % e composição).
  // O dono pode optar por expor os valores absolutos ao compartilhar.
  publicShowValues: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

WalletSchema.index({ user: 1, createdAt: 1 });
// Resolução O(1) da rota pública por token; sparse+unique evita colisão de nulls.
WalletSchema.index({ publicToken: 1 }, { unique: true, sparse: true });

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);
export default Wallet;
