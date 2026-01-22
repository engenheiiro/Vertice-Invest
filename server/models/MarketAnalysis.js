
import mongoose from 'mongoose';

const MarketAnalysisSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  
  assetClass: {
    type: String,
    enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED', 'RESERVE', 'BRASIL_10'],
    required: true
  },
  strategy: {
    type: String,
    enum: ['BUY_HOLD', 'SWING', 'DAY_TRADE'],
    required: true
  },
  
  content: {
    morningCall: { type: String, required: true },
    ranking: [{
      position: Number,
      ticker: String,
      name: String,
      action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
      targetPrice: Number,
      score: Number,
      reason: String
    }]
  },
  
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

MarketAnalysisSchema.index({ assetClass: 1, strategy: 1, createdAt: -1 });

const MarketAnalysis = mongoose.models.MarketAnalysis || mongoose.model('MarketAnalysis', MarketAnalysisSchema);

export default MarketAnalysis;
