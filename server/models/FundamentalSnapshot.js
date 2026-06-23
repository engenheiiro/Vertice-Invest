
import mongoose from 'mongoose';

// (Fase 3 / achado B-A2) Série temporal de fundamentos — o PRÉ-REQUISITO nomeado no
// roadmap (§2.10): "hoje só o preço tem histórico". Cada sync grava uma leitura mensal
// (deduplicada por período YYYY-MM) dos fundamentos correntes do ativo. Com o tempo isso
// acumula o "track record" que o scoringEngine usa para premiar consistência/durabilidade
// no Defensivo/Moderado (Buy & Hold de décadas). Mirror do padrão de AssetHistory.
//
// IMPORTANTE: não há histórico retroativo — a coleta começa a acumular a partir de agora.
// Por isso a dimensão de consistência nasce DORMENTE (summarizeTrackRecord devolve null
// até haver leituras suficientes) e ativa sozinha conforme a série cresce.
const FundamentalSnapshotSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, default: null }, // STOCK | FII (só BR tem fundamentos via Fundamentus)
  lastUpdated: { type: Date, default: Date.now },
  // Uma entrada por mês-calendário (period = 'YYYY-MM'). Cap de 60 entradas (~5 anos)
  // aplicado no append para manter o documento pequeno e fora dos scans quentes.
  history: [{
    period: { type: String, required: true }, // 'YYYY-MM'
    date: { type: Date, default: Date.now },
    roe: { type: Number, default: 0 },
    netMargin: { type: Number, default: 0 },
    payout: { type: Number, default: 0 },
    dy: { type: Number, default: 0 },
    revenueGrowth: { type: Number, default: 0 },
    pl: { type: Number, default: 0 },
  }]
});

// `unique: true` em `ticker` já cria o índice — não duplicar.

const FundamentalSnapshot = mongoose.models.FundamentalSnapshot
  || mongoose.model('FundamentalSnapshot', FundamentalSnapshotSchema);
export default FundamentalSnapshot;
