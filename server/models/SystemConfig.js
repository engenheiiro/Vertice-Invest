
import mongoose from 'mongoose';

const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'MACRO_INDICATORS' },
  selic: { type: Number, required: true, default: 11.25 },
  ipca: { type: Number, required: true, default: 4.50 },
  cdi: { type: Number, required: true, default: 11.15 }, // Taxa Meta Atual (para projeções)
  cdiReturn12m: { type: Number, default: 11.15 }, // Retorno Acumulado 12m (para gráficos históricos)
  riskFree: { type: Number, required: true, default: 11.25 },
  ntnbLong: { type: Number, required: true, default: 6.30 },
  
  dollar: { type: Number, default: 5.75 },
  dollarChange: { type: Number, default: 0 },
  
  // Cache de Índices (Para Performance)
  ibov: { type: Number, default: 128000 },
  ibovChange: { type: Number, default: 0 },
  ibovReturn12m: { type: Number, default: 15.50 }, 
  
  spx: { type: Number, default: 5800 },
  spxChange: { type: Number, default: 0 },
  spxReturn12m: { type: Number, default: 32.50 },
  
  btc: { type: Number, default: 90000 },
  btcChange: { type: Number, default: 0 },

  lastUpdated: { type: Date, default: Date.now }
});

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);
export default SystemConfig;
