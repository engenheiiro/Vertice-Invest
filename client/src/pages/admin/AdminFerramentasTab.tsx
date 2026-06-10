import React from 'react';
import { Settings, HardDrive, Scissors, ShieldAlert, ClipboardList, Search, RefreshCw, Zap, Trash2 } from 'lucide-react';
import { TunablesCard } from '../../components/admin/TunablesCard';

interface CacheData {
    ticker: string;
    status: 'CACHED' | 'LIVE_ONLY' | 'NOT_FOUND';
    currentPrice?: number;
    dataPoints?: number;
}

interface Props {
    backtestDays: number;
    isSavingConfig: boolean;
    isClearingRadar: boolean;
    cacheSearchTicker: string;
    setCacheSearchTicker: (v: string) => void;
    cacheData: CacheData | null;
    isSearchingCache: boolean;
    splitTicker: string;
    setSplitTicker: (v: string) => void;
    isFixingSplit: boolean;
    testPaymentLoading: string | null;
    discardLogs: any[];
    isLoadingLogs: boolean;
    onSaveBacktestConfig: (days: number) => void;
    onClearRadarHistory: () => void;
    onCacheSearch: (e: React.FormEvent) => void;
    onFixSplit: (e: React.FormEvent) => void;
    onTestPayment: (planKey: string) => void;
    onLoadDiscardLogs: () => void;
}

export const AdminFerramentasTab: React.FC<Props> = ({
    backtestDays, isSavingConfig, isClearingRadar,
    cacheSearchTicker, setCacheSearchTicker, cacheData, isSearchingCache,
    splitTicker, setSplitTicker, isFixingSplit,
    testPaymentLoading, discardLogs, isLoadingLogs,
    onSaveBacktestConfig, onClearRadarHistory, onCacheSearch, onFixSplit, onTestPayment, onLoadDiscardLogs,
}) => (
    <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Parâmetros operacionais editáveis */}
            <TunablesCard />

            {/* Configuração Radar */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <Settings size={18} className="text-blue-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Configuração Radar</h3>
                </div>
                <div className="mb-6">
                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Horizonte de Backtest (Dias)</p>
                    <div className="flex gap-2">
                        {[3, 7, 15, 30].map(d => (
                            <button key={d} onClick={() => onSaveBacktestConfig(d)} disabled={isSavingConfig} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${backtestDays === d ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}>{d}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Manutenção</p>
                    <button onClick={onClearRadarHistory} disabled={isClearingRadar} className="w-full py-2 bg-red-900/10 border border-red-900/30 text-red-500 hover:bg-red-900/20 hover:text-red-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all">
                        {isClearingRadar ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Limpar Histórico do Radar
                    </button>
                </div>
            </div>

            {/* Inspector de Cache */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <HardDrive size={18} className="text-emerald-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Inspector de Cache</h3>
                </div>
                <form onSubmit={onCacheSearch} className="flex gap-0 relative mb-4">
                    <input placeholder="Ticker..." value={cacheSearchTicker} onChange={(e) => setCacheSearchTicker(e.target.value.toUpperCase())} className="flex-1 bg-card border border-slate-700 border-r-0 rounded-l-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase" />
                    <button type="submit" disabled={isSearchingCache} className="px-3 bg-slate-800 border border-slate-700 border-l-0 rounded-r-xl text-slate-300 hover:text-white">
                        {isSearchingCache ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                    </button>
                </form>
                {cacheData && (
                    <div className="p-3 bg-panel rounded-xl border border-slate-800 space-y-1">
                        <div className="flex justify-between font-bold text-white">
                            <span>{cacheData.ticker}</span>
                            <span className={`text-[9px] px-1.5 rounded ${cacheData.status === 'CACHED' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>{cacheData.status}</span>
                        </div>
                        <p className="text-xs text-slate-400">Price: {cacheData.currentPrice?.toFixed(2)}</p>
                        <p className="text-[10px] text-slate-600">Points: {cacheData.dataPoints}</p>
                    </div>
                )}
            </div>

            {/* Reparar Splits */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <Scissors size={18} className="text-yellow-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Reparar Splits</h3>
                </div>
                <p className="text-[10px] text-slate-400 mb-4">Corrige histórico de usuários pós-split.</p>
                <form onSubmit={onFixSplit} className="flex gap-2">
                    <input placeholder="Ticker" value={splitTicker} onChange={(e) => setSplitTicker(e.target.value.toUpperCase())} className="flex-1 bg-card border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase" />
                    <button type="submit" disabled={isFixingSplit || !splitTicker} className="px-3 py-2 bg-yellow-600/20 text-yellow-500 border border-yellow-600/30 rounded-xl hover:text-white hover:bg-yellow-600/40 transition-colors"><Zap size={16} /></button>
                </form>
            </div>
        </div>

        {/* Testar Pagamento */}
        <div className="bg-base border border-amber-900/30 rounded-2xl p-6 shadow-lg mb-6">
            <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Testar Pagamento (R$0,50)</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">Gera um checkout real no Mercado Pago com valor mínimo. O webhook ativa o plano correto ao aprovar.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { key: 'ESSENTIAL', label: 'Essential', color: 'blue' },
                    { key: 'PRO', label: 'Pro', color: 'emerald' },
                    { key: 'ELITE', label: 'Elite', color: 'purple' },
                    { key: 'BLACK', label: 'Black', color: 'gold' },
                ].map(({ key, label, color }) => (
                    <button key={key} onClick={() => onTestPayment(key)} disabled={testPaymentLoading !== null} className={`py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${color === 'blue' ? 'bg-blue-900/20 border-blue-700/40 text-blue-400 hover:bg-blue-900/40' : ''} ${color === 'emerald' ? 'bg-emerald-900/20 border-emerald-700/40 text-emerald-400 hover:bg-emerald-900/40' : ''} ${color === 'purple' ? 'bg-purple-900/20 border-purple-700/40 text-purple-400 hover:bg-purple-900/40' : ''} ${color === 'gold' ? 'bg-gold/10 border-gold/40 text-gold hover:bg-gold/20' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}>
                        {testPaymentLoading === key ? <RefreshCw size={13} className="animate-spin" /> : null}
                        {label}
                    </button>
                ))}
            </div>
        </div>

        {/* Log de Descartes */}
        <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={18} className="text-red-500" />Log de Descartes (Quality Gate)</h3>
                <button onClick={onLoadDiscardLogs} className="text-xs font-bold text-blue-500 hover:text-white flex items-center gap-1">
                    <RefreshCw size={12} className={isLoadingLogs ? 'animate-spin' : ''} /> Atualizar
                </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[300px] custom-scrollbar">
                <table className="w-full text-left text-xs">
                    <thead className="bg-card sticky top-0 z-10">
                        <tr>
                            <th className="p-3 font-bold text-slate-500 uppercase">Data</th>
                            <th className="p-3 font-bold text-slate-500 uppercase">Ativo</th>
                            <th className="p-3 font-bold text-slate-500 uppercase">Motivo</th>
                            <th className="p-3 font-bold text-slate-500 uppercase">Detalhe</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 bg-[#05070A]">
                        {discardLogs.length === 0 ? (
                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">Nenhum descarte recente.</td></tr>
                        ) : (
                            discardLogs.map((log: any) => (
                                <tr key={log._id} className="hover:bg-slate-900/30">
                                    <td className="p-3 text-slate-400 font-mono w-32">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="p-3 text-white font-bold w-24">{log.ticker}</td>
                                    <td className="p-3 text-red-400 font-bold">{log.reason}</td>
                                    <td className="p-3 text-slate-500">{log.details}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </>
);
