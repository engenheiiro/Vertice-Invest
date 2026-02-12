
import mongoose from 'mongoose';

const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'MACRO_INDICATORS' },
  
  // Indicadores Macro
  selic: { type: Number, required: true, default: 11.25 },
  ipca: { type: Number, required: true, default: 4.50 },
  cdi: { type: Number, required: true, default: 11.15 }, 
  cdiReturn12m: { type: Number, default: 11.15 }, 
  riskFree: { type: Number, required: true, default: 11.25 },
  ntnbLong: { type: Number, required: true, default: 6.30 },
  
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

  // Configurações do Sistema
  backtestHorizon: { type: Number, default: 7 }, // Dias para auditar o sinal (3, 7, 15, 30)

  // Métricas de Qualidade de Dados (Observabilidade)
  lastSyncStats: {
    typosFixed: { type: Number, default: 0 },
    assetsProcessed: { type: Number, default: 0 },
    timestamp: { type: Date }
  },

  lastUpdated: { type: Date, default: Date.now }
});

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);
export default SystemConfig;
