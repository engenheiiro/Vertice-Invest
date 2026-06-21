
import mongoose from 'mongoose';

const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'MACRO_INDICATORS' },
  
  // Indicadores Macro
  selic: { type: Number, required: true, default: 14.25 },
  ipca: { type: Number, required: true, default: 4.50 },
  cdi: { type: Number, required: true, default: 14.15 },
  cdiReturn12m: { type: Number, default: 14.15 },
  riskFree: { type: Number, required: true, default: 14.25 },
  ntnbLong: { type: Number, required: true, default: 6.30 },

  // Observabilidade das taxas oficiais: quando true, ao menos uma métrica
  // (SELIC/IPCA/CDI) veio do fallback hardcoded — BCB e fonte secundária falharam.
  ratesStale: { type: Boolean, default: false },
  // Fonte efetiva de cada taxa nesta sincronização: 'BCB' | 'BrasilAPI' | 'IBGE' | 'fallback'.
  ratesSources: {
    selic: { type: String, default: null },
    ipca: { type: String, default: null },
  },
  // Último instante em que TODAS as taxas vieram de fonte real (sem fallback).
  ratesUpdatedAt: { type: Date, default: null },
  
  dollar: { type: Number, default: 5.75 },
  dollarChange: { type: Number, default: 0 },
  
  // Cache de Índices
  ibov: { type: Number, default: 128000 },
  ibovChange: { type: Number, default: 0 },
  ibovReturn12m: { type: Number, default: 15.50 }, 
  
  spx: { type: Number, default: 5800 },
  spxChange: { type: Number, default: 0 },
  spxReturn12m: { type: Number, default: 32.50 },
  
  btc: { type: Number, default: 90000 },
  btcChange: { type: Number, default: 0 },

  // Campo genérico para metadados (ex: RADAR_SCAN_META)
  value: { type: mongoose.Schema.Types.Mixed, default: null },

  // Configurações do Sistema
  backtestHorizon: { type: Number, default: 7 }, // Dias para auditar o sinal (3, 7, 15, 30)

  // Métricas de Qualidade de Dados (Observabilidade)
  lastSyncStats: {
    typosFixed: { type: Number, default: 0 },
    assetsProcessed: { type: Number, default: 0 },
    timestamp: { type: Date }
  },

  // NOVO: Relatório de Saúde dos Snapshots
  lastSnapshotStats: {
    created: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 }, // Anomalias ou erros
    timestamp: { type: Date }
  },

  // NOVO: Relatório de Séries Temporais
  lastTimeSeriesStats: {
    assetsProcessed: { type: Number, default: 0 },
    timestamp: { type: Date }
  },

  lastUpdated: { type: Date, default: Date.now }
});

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);
export default SystemConfig;
