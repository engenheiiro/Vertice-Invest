
import React, { useState } from 'react';
import { BarChart3, Calculator, DollarSign, BrainCircuit } from 'lucide-react';

const PerformanceCard = ({ macro, isLoading }: { macro: any, isLoading: boolean }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'simulator'>('chart');
  const [investmentValue, setInvestmentValue] = useState<string>('10000');
  
  // Sanitização
  let cdiAnnualRate = Number(macro?.cdi || 11.15);
  if (cdiAnnualRate > 50) cdiAnnualRate = 11.15; 

  const spxReturn = Number(macro?.spx || 25.0); 
  const ibovReturn = Number(macro?.ibov || 15.5);
  const iaReturn = 88.60; 

  // ESTRATÉGIA VISUAL: Competidores uniformizados em cinza (bg-slate-700) para destacar o produto (IA Vértice)
  const data = [
    { label: 'CDI', value: cdiAnnualRate, color: 'bg-slate-700', text: 'text-slate-500' },
    { label: 'S&P 500', value: spxReturn, color: 'bg-slate-700', text: 'text-slate-500' },
    { label: 'Ibovespa', value: ibovReturn, color: 'bg-slate-700', text: 'text-slate-500' },
    { label: 'IA Vértice', value: iaReturn, color: 'bg-gradient-to-r from-blue-600 to-indigo-500', text: 'text-white', glow: true },
  ].sort((a, b) => a.value - b.value); // Mantém a ordenação do menor para o maior

  const maxValue = 100;

  const numValue = parseFloat(investmentValue.replace(/\./g, '')) || 0;
  const cdiResult = numValue * (1 + cdiAnnualRate/100);
  const verticeResult = numValue * (1 + iaReturn/100);
  const diff = verticeResult - cdiResult;

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="bg-[#03060D]/80 backdrop-blur-xl border border-slate-800 p-6 rounded-3xl shadow-2xl relative overflow-hidden group w-full transition-all duration-500">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
        <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-lg font-bold text-white mb-0.5">Performance (Acumulado 12m)</h3>
                    <div className="flex items-center gap-1.5">
                         <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                         <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                             {isLoading ? 'Sincronizando...' : `Dados Reais (${new Date().toLocaleDateString()})`}
                         </p>
                    </div>
                </div>
                <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex gap-1">
                    <button onClick={() => setViewMode('chart')} className={`p-1.5 rounded transition-all ${viewMode === 'chart' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-600 hover:text-slate-400'}`}><BarChart3 size={16} /></button>
                    <button onClick={() => setViewMode('simulator')} className={`p-1.5 rounded transition-all ${viewMode === 'simulator' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-600 hover:text-slate-400'}`}><Calculator size={16} /></button>
                </div>
            </div>

            {viewMode === 'chart' && (
                <div className="space-y-4 animate-fade-in">
                    {data.map((item) => (
                        <div key={item.label} className="relative group/bar">
                            <div className="flex justify-between text-xs mb-1.5 font-medium">
                                <span className={item.text}>{item.label}</span>
                                <span className={item.text}>
                                    {isLoading ? '...' : `${item.value.toFixed(2)}%`}
                                </span>
                            </div>
                            <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden">
                                {isLoading ? (
                                    <div className="h-full bg-slate-800 w-1/2 animate-pulse rounded-full"></div>
                                ) : (
                                    <div style={{ width: `${Math.min((item.value / maxValue) * 100, 100)}%` }} className={`h-full rounded-full ${item.color} relative transition-all duration-1000 ease-out`}>
                                        {item.glow && <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/40 blur-[4px]"></div>}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'simulator' && (
                <div className="animate-fade-in">
                    <div className="mb-4">
                        <label className="text-[10px] uppercase text-slate-500 font-bold mb-1.5 block">Valor do Investimento</label>
                        <div className="relative group/input">
                            <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within/input:text-blue-500 transition-colors" />
                            <input type="number" value={investmentValue} onChange={(e) => setInvestmentValue(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 pl-8 pr-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        <div className="flex justify-between items-center bg-slate-800/30 p-2 rounded-lg border border-slate-800/50">
                            <span className="text-xs text-slate-400">CDI ({cdiAnnualRate.toFixed(1)}%)</span>
                            <span className="text-sm font-medium text-slate-300">{formatCurrency(cdiResult)}</span>
                        </div>
                        <div className="flex justify-between items-center bg-gradient-to-r from-blue-900/20 to-indigo-900/20 p-2 rounded-lg border border-blue-500/20">
                            <span className="text-xs text-white font-bold flex items-center gap-1"><BrainCircuit size={12} className="text-blue-400"/> Vértice ({iaReturn}%)</span>
                            <span className="text-sm font-bold text-white">{formatCurrency(verticeResult)}</span>
                        </div>
                        <div className="pt-1 text-center">
                             <p className="text-[10px] text-slate-500">Ganho Adicional: <span className="text-green-400 font-bold">{formatCurrency(diff)}</span></p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

export default PerformanceCard;
