import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { RefreshCw, ShieldCheck, ShieldAlert, Activity, Clock, Target, Globe, Database, Zap, Play, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface MacroIndicator { value: number; change?: number }
export interface MacroData {
    selic?: MacroIndicator; cdi?: MacroIndicator; ipca?: MacroIndicator;
    ibov?: MacroIndicator; usd?: MacroIndicator; spx?: MacroIndicator;
    btc?: MacroIndicator; lastUpdated?: string;
}

interface Props {
    qualityStats: any;
    accuracyData: any[];
    accuracyWindow: number;
    setAccuracyWindow: (v: number) => void;
    accuracyAsset: string;
    setAccuracyAsset: (v: string) => void;
    macroData: MacroData | null;
    isLoadingMacro: boolean;
    isMacroSyncing: boolean;
    isSyncing: boolean;
    isGlobalRunning: boolean;
    isResettingHealth: boolean;
    isSnapshotRunning: boolean;
    isSyncingTimeSeries: boolean;
    onResetHealth: () => void;
    onForceSnapshot: () => void;
    onSyncTimeSeries: () => void;
    onMacroSync: () => void;
    onSyncData: () => void;
    onRetryMacro: () => void;
}

const Skel = () => <span className="block h-7 w-12 bg-slate-800 rounded animate-pulse mt-1" />;

const MacroCard = ({ label, value, change, sub, color }: { label: string; value: string; change?: number; sub: string; color?: string }) => (
    <div className="bg-panel border border-slate-800 p-3 rounded-xl flex flex-col justify-between h-full">
        <div>
            <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">{label}</p>
            <p className={`text-sm font-mono font-bold ${color || 'text-white'}`}>{value}</p>
        </div>
        <div className="flex justify-between items-end mt-2">
            <span className="text-[9px] text-slate-600">{sub}</span>
            {change !== undefined && (
                <span className={`text-[9px] font-bold flex items-center ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {change > 0 ? <TrendingUp size={8} className="mr-0.5" /> : change < 0 ? <TrendingDown size={8} className="mr-0.5" /> : <Minus size={8} className="mr-0.5" />}
                    {Math.abs(change).toFixed(2)}%
                </span>
            )}
        </div>
    </div>
);

export const AdminPainelTab: React.FC<Props> = ({
    qualityStats, accuracyData, accuracyWindow, setAccuracyWindow, accuracyAsset, setAccuracyAsset,
    macroData, isLoadingMacro, isMacroSyncing, isSyncing, isGlobalRunning,
    isResettingHealth, isSnapshotRunning, isSyncingTimeSeries,
    onResetHealth, onForceSnapshot, onSyncTimeSeries, onMacroSync, onSyncData, onRetryMacro,
}) => {
    const isMacroDataValid = macroData && macroData.selic && macroData.ibov;
    const { theme } = useTheme();
    const chartTooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#0f172a' }
        : { backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' };

    return (
        <>
            {/* Stats KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                    <div className="w-12 h-12 bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-900/50 shrink-0"><RefreshCw size={24} /></div>
                    <div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Ativos Processados</p>
                        <h3 className="text-2xl font-black text-white">{qualityStats ? qualityStats.assetsProcessed : <Skel />}</h3>
                        <p className="text-[9px] text-slate-500 mt-0.5">Na última sincronização</p>
                    </div>
                </div>

                <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                    <div className="w-12 h-12 bg-yellow-900/20 rounded-xl flex items-center justify-center text-yellow-500 border border-yellow-900/50 shrink-0"><ShieldCheck size={24} /></div>
                    <div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Typos Corrigidos</p>
                        <h3 className="text-2xl font-black text-white">{qualityStats ? qualityStats.typosFixed : <Skel />}</h3>
                        <p className="text-[9px] text-slate-500 mt-0.5">Sanitização ativa</p>
                    </div>
                </div>

                <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.blacklistedAssets > 0 ? 'bg-red-900/20 text-red-500 border-red-900/50' : 'bg-green-900/20 text-green-500 border-green-900/50'}`}><ShieldAlert size={24} /></div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Blacklist</p>
                            <h3 className={`text-2xl font-black ${qualityStats?.blacklistedAssets > 0 ? 'text-red-500' : 'text-green-500'}`}>{qualityStats ? qualityStats.blacklistedAssets : <Skel />}</h3>
                            <p className="text-[9px] text-slate-500 mt-0.5">Ativos bloqueados</p>
                        </div>
                    </div>
                    {qualityStats?.blacklistedAssets > 0 && (
                        <button onClick={onResetHealth} disabled={isResettingHealth} className="px-2 py-1.5 bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1" title="Reativa ativos bloqueados por falhas consecutivas">
                            {isResettingHealth ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} fill="currentColor" />}
                            Reativar
                        </button>
                    )}
                </div>

                <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.snapshotStats?.skipped > 0 ? 'bg-orange-900/20 text-orange-500 border-orange-900/50' : 'bg-indigo-900/20 text-indigo-500 border-indigo-900/50'}`}><Activity size={24} /></div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Snapshots Noturnos</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className="text-2xl font-black text-white">{qualityStats ? (qualityStats.snapshotStats?.created || 0) : <Skel />}</h3>
                                <span className="text-[10px] text-slate-500 font-bold">criados</span>
                            </div>
                            <p className={`text-[9px] mt-0.5 font-bold ${qualityStats?.snapshotStats?.skipped > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>
                                {qualityStats ? `${qualityStats.snapshotStats?.skipped || 0} anomalias ignoradas` : '...'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onForceSnapshot} disabled={isSnapshotRunning} className="px-2 py-1.5 bg-indigo-900/20 border border-indigo-900/50 text-indigo-400 hover:bg-indigo-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1" title="Recalcular rentabilidade de todos os usuários agora">
                        {isSnapshotRunning ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                        Forçar
                    </button>
                </div>

                <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${qualityStats?.timeSeriesAgeHours > 48 ? 'bg-red-900/20 text-red-500 border-red-900/50 animate-pulse' : 'bg-blue-900/20 text-blue-500 border-blue-900/50'}`}><Clock size={24} /></div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">Séries Temporais</p>
                            <div className="flex items-baseline gap-1">
                                <h3 className={`text-2xl font-black ${qualityStats?.timeSeriesAgeHours > 48 ? 'text-red-500' : 'text-white'}`}>
                                    {qualityStats ? (qualityStats.timeSeriesAgeHours ? qualityStats.timeSeriesAgeHours.toFixed(1) : 0) : <Skel />}
                                </h3>
                                <span className="text-[10px] text-slate-500 font-bold">h</span>
                            </div>
                            <p className={`text-[9px] mt-0.5 font-bold ${qualityStats?.timeSeriesAgeHours > 48 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {qualityStats ? (qualityStats.timeSeriesAgeHours > 48 ? 'ALERTA: Defasado' : 'Saudável') : '...'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onSyncTimeSeries} disabled={isSyncingTimeSeries} className="px-2 py-1.5 bg-blue-900/20 border border-blue-900/50 text-blue-400 hover:bg-blue-900/40 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1" title="Atualiza o histórico de preços de todos os ativos">
                        {isSyncingTimeSeries ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                        Sync
                    </button>
                </div>
            </div>

            {/* Precisão do Algoritmo */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2"><Target size={18} className="text-purple-500" />Carteira Recomendada (Backtest Contínuo)</h3>
                        <p className="text-xs text-slate-500">Valorização de uma carteira que segue a Research (entradas/saídas a cada publicação) vs IBOV · CDI · IFIX</p>
                    </div>
                    <div className="flex gap-2">
                        <select value={accuracyAsset} onChange={(e) => setAccuracyAsset(e.target.value)} className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 outline-none">
                            <option value="BRASIL_10">Brasil 10</option>
                            <option value="STOCK">Ações BR</option>
                            <option value="FII">FIIs</option>
                            <option value="STOCK_US">Global (S&P 500)</option>
                        </select>
                        <div className="flex bg-slate-900 p-0.5 rounded border border-slate-700">
                            {[7, 30, 60, 90].map(days => (
                                <button key={days} onClick={() => setAccuracyWindow(days)} className={`px-3 py-1 text-[10px] font-bold rounded ${accuracyWindow === days ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>{days}D</button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="h-[280px] w-full">
                    {accuracyData.length > 0 ? (() => {
                        const hasIfixData = accuracyData.some(d => d.ifixReturn !== 0) && accuracyAsset !== 'STOCK_US';
                        const hasSpxData = accuracyAsset === 'STOCK_US' && accuracyData.some(d => d.spxReturn !== 0);
                        return (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={accuracyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis dataKey="formattedDate" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                                    <Tooltip contentStyle={chartTooltipStyle} itemStyle={{ fontWeight: 'bold' }} formatter={(value: number, name: string) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, name]} labelFormatter={(label, payload) => {
                                        const p: any = payload?.[0]?.payload;
                                        const reb = p?.lastRebalanceDate ? new Date(p.lastRebalanceDate).toLocaleDateString('pt-BR') : null;
                                        return `📅 ${label}${p?.holdingsCount ? ` · ${p.holdingsCount} ativos` : ''}${reb ? ` · rebal. ${reb}` : ''}`;
                                    }} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                                    <Area type="monotone" dataKey="equityReturn" name="Carteira Recomendada" stroke="#3B82F6" fillOpacity={1} fill="url(#colorAvg)" strokeWidth={2.5} dot={false} />
                                    <Area type="monotone" dataKey="ibovReturn" name="IBOV" stroke="#F97316" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />
                                    <Area type="monotone" dataKey="cdiReturn" name="CDI" stroke="#10B981" fill="transparent" strokeDasharray="3 3" strokeWidth={1.5} dot={false} />
                                    {hasIfixData && <Area type="monotone" dataKey="ifixReturn" name="IFIX" stroke="#A78BFA" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />}
                                    {hasSpxData && <Area type="monotone" dataKey="spxReturn" name="S&P 500" stroke="#06B6D4" fill="transparent" strokeDasharray="5 3" strokeWidth={1.5} dot={false} />}
                                </AreaChart>
                            </ResponsiveContainer>
                        );
                    })() : (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                            <Target size={24} className="opacity-30" />
                            <p className="text-xs">Sem curva para esta classe. É preciso ≥1 publicação da Research; a curva é gerada nas rotinas diárias (09:00/18:30).</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Ambiente Macro */}
            <div className="bg-card border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex flex-col">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Globe size={14} className="text-blue-500" />Ambiente Macroeconômico</h3>
                        {macroData?.lastUpdated && (
                            <span className="text-[10px] text-slate-500 font-mono mt-1 ml-6 flex items-center gap-1">
                                <Clock size={10} />
                                Última Sync: {new Date(macroData.lastUpdated).toLocaleString()}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onMacroSync} disabled={isMacroSyncing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-purple-500">
                            <Globe size={12} className={isMacroSyncing ? 'animate-pulse' : ''} />
                            {isMacroSyncing ? 'Atualizando...' : 'Sync Macro'}
                        </button>
                        <button onClick={onSyncData} disabled={isSyncing || isGlobalRunning} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-blue-500">
                            <Database size={12} className={isSyncing ? 'animate-pulse' : ''} />
                            {isSyncing ? 'Sincronizando...' : 'Sync Preços'}
                        </button>
                    </div>
                </div>
                {isMacroDataValid ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                        <MacroCard label="Selic" value={`${macroData?.selic?.value}%`} sub="BCB Meta" color="text-yellow-400" />
                        <MacroCard label="CDI" value={`${macroData?.cdi?.value?.toFixed(2)}%`} sub="Est. Cetip" color="text-yellow-400" />
                        <MacroCard label="IPCA" value={`${macroData?.ipca?.value}%`} sub="12 meses" color="text-red-400" />
                        <MacroCard label="Ibovespa" value={Math.round(macroData?.ibov?.value || 0).toLocaleString()} change={macroData?.ibov?.change} sub="Pts" />
                        <MacroCard label="Dólar" value={`R$ ${macroData?.usd?.value?.toFixed(3) || '0.000'}`} change={macroData?.usd?.change} sub="PTAX" />
                        <MacroCard label="S&P 500" value={Math.round(macroData?.spx?.value || 0).toLocaleString()} change={macroData?.spx?.change} sub="US Pts" />
                        <MacroCard label="Bitcoin" value={`$${Math.round(macroData?.btc?.value || 0).toLocaleString()}`} change={macroData?.btc?.change} sub="USD" color="text-purple-400" />
                    </div>
                ) : (
                    <div className="text-center text-xs text-slate-500 py-4 flex flex-col items-center">
                        <p>Carregando dados globais ou serviço indisponível...</p>
                        {!isLoadingMacro && <button onClick={onRetryMacro} className="mt-2 text-blue-500 hover:underline">Tentar Novamente</button>}
                    </div>
                )}
            </div>
        </>
    );
};
