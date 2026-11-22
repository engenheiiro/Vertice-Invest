import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { RefreshCw, ShieldCheck, ShieldAlert, Activity, Clock, Target, Globe, Database, Zap, Play, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import {
    snapshotSummary, timeSeriesSummary, visibleBenchmarks, formatReturnTooltip, formatPointLabel, buildMacroCards,
    type QualityStats, type AccuracyPoint, type MacroData, type MacroCardView,
} from './adminPainelView';

export type { MacroData } from './adminPainelView';

interface Props {
    qualityStats: QualityStats | null;
    accuracyData: AccuracyPoint[];
    accuracyWindow: number;
    setAccuracyWindow: (v: number) => void;
    accuracyAsset: string;
    setAccuracyAsset: (v: string) => void;
    accuracyProfile: string;
    setAccuracyProfile: (v: string) => void;
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

const trendIcon = (change: number) =>
    change > 0 ? <TrendingUp size={8} className="mr-0.5" /> : change < 0 ? <TrendingDown size={8} className="mr-0.5" /> : <Minus size={8} className="mr-0.5" />;

const MacroCard = ({ label, value, change, sub, color }: MacroCardView) => (
    <div className="bg-panel border border-slate-800 p-3 rounded-xl flex flex-col justify-between h-full">
        <div>
            <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">{label}</p>
            <p className={`text-sm font-mono font-bold ${color || 'text-white'}`}>{value}</p>
        </div>
        <div className="flex justify-between items-end mt-2">
            <span className="text-[9px] text-slate-600">{sub}</span>
            {change !== undefined && (
                <span className={`text-[9px] font-bold flex items-center ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {trendIcon(change)}
                    {Math.abs(change).toFixed(2)}%
                </span>
            )}
        </div>
    </div>
);

// Classes Tailwind completas (JIT não resolve interpolação de cor).
const ACTION_TONE = {
    red: 'bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/40',
    indigo: 'bg-indigo-900/20 border border-indigo-900/50 text-indigo-400 hover:bg-indigo-900/40',
    blue: 'bg-blue-900/20 border border-blue-900/50 text-blue-400 hover:bg-blue-900/40',
};

/** Botão de ação pequeno dos cards: ícone de execução enquanto roda. */
const CardAction = ({ onClick, running, tone, title, idle, label }: {
    onClick: () => void; running: boolean; tone: keyof typeof ACTION_TONE; title: string; idle: React.ReactNode; label: string;
}) => (
    <button onClick={onClick} disabled={running} className={`px-2 py-1.5 ${ACTION_TONE[tone]} text-[10px] font-bold rounded-lg transition-all flex items-center gap-1`} title={title}>
        {running ? <RefreshCw size={12} className="animate-spin" /> : idle}
        {label}
    </button>
);

const StaticKpi = ({ icon, iconCls, label, value, sub }: { icon: React.ReactNode; iconCls: string; label: string; value: React.ReactNode; sub: string }) => (
    <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
        <div className={iconCls}>{icon}</div>
        <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase">{label}</p>
            <h3 className="text-2xl font-black text-white">{value}</h3>
            <p className="text-[9px] text-slate-500 mt-0.5">{sub}</p>
        </div>
    </div>
);

const BlacklistCard = ({ stats, isResetting, onReset }: { stats: QualityStats | null; isResetting: boolean; onReset: () => void }) => {
    const blocked = (stats?.blacklistedAssets ?? 0) > 0;
    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${blocked ? 'bg-red-900/20 text-red-500 border-red-900/50' : 'bg-green-900/20 text-green-500 border-green-900/50'}`}><ShieldAlert size={24} /></div>
                <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Blacklist</p>
                    <h3 className={`text-2xl font-black ${blocked ? 'text-red-500' : 'text-green-500'}`}>{stats ? stats.blacklistedAssets : <Skel />}</h3>
                    <p className="text-[9px] text-slate-500 mt-0.5">Ativos bloqueados</p>
                </div>
            </div>
            {blocked && (
                <CardAction onClick={onReset} running={isResetting} tone="red" title="Reativa ativos bloqueados por falhas consecutivas" idle={<Zap size={12} fill="currentColor" />} label="Reativar" />
            )}
        </div>
    );
};

const SnapshotCard = ({ stats, isRunning, onForce }: { stats: QualityStats | null; isRunning: boolean; onForce: () => void }) => {
    const { alert, note, created } = snapshotSummary(stats);
    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${alert ? 'bg-orange-900/20 text-orange-500 border-orange-900/50' : 'bg-indigo-900/20 text-indigo-500 border-indigo-900/50'}`}><Activity size={24} /></div>
                <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Snapshots Noturnos</p>
                    <div className="flex items-baseline gap-1">
                        <h3 className="text-2xl font-black text-white">{stats ? created : <Skel />}</h3>
                        <span className="text-[10px] text-slate-500 font-bold">criados</span>
                    </div>
                    <p className={`text-[9px] mt-0.5 font-bold ${alert ? 'text-orange-500' : 'text-emerald-500'}`}>
                        {note}
                    </p>
                </div>
            </div>
            <CardAction onClick={onForce} running={isRunning} tone="indigo" title="Recalcular rentabilidade de todos os usuários agora" idle={<Play size={12} fill="currentColor" />} label="Forçar" />
        </div>
    );
};

const TimeSeriesCard = ({ stats, isSyncing, onSync }: { stats: QualityStats | null; isSyncing: boolean; onSync: () => void }) => {
    const ts = timeSeriesSummary(stats);
    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${ts.stale ? 'bg-red-900/20 text-red-500 border-red-900/50 animate-pulse' : 'bg-blue-900/20 text-blue-500 border-blue-900/50'}`}><Clock size={24} /></div>
                <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Séries Temporais</p>
                    <div className="flex items-baseline gap-1">
                        <h3 className={`text-2xl font-black ${ts.stale ? 'text-red-500' : 'text-white'}`}>
                            {stats ? ts.age : <Skel />}
                        </h3>
                        <span className="text-[10px] text-slate-500 font-bold">h</span>
                    </div>
                    <p className={`text-[9px] mt-0.5 font-bold ${ts.stale ? 'text-red-500' : 'text-emerald-500'}`}>
                        {ts.status}
                        {ts.cohort ? (
                            <span className="text-slate-500 font-medium">
                                {' '}· {ts.cohort.tracked} séries
                                {ts.cohort.orphans}
                            </span>
                        ) : null}
                    </p>
                </div>
            </div>
            <CardAction onClick={onSync} running={isSyncing} tone="blue" title="Atualiza o histórico de preços de todos os ativos" idle={<Play size={12} fill="currentColor" />} label="Sync" />
        </div>
    );
};

const ASSET_OPTIONS: [string, string][] = [
    ['BRASIL_10', 'Brasil 10'], ['STOCK', 'Ações BR'], ['FII', 'FIIs'], ['CRYPTO', 'Cripto'],
    ['STOCK_US', 'Global (S&P 500)'], ['REIT', 'REITs'], ['ETF_BR', 'ETF Nacional'], ['ETF_US', 'ETF Internacional'],
];
// Classes Tailwind completas (JIT não resolve interpolação de cor).
const PROFILE_OPTIONS = [
    ['DEFENSIVE', 'Defensivo', 'bg-emerald-900/40 text-emerald-400 shadow'],
    ['MODERATE', 'Moderado', 'bg-blue-900/40 text-blue-400 shadow'],
    ['BOLD', 'Arrojado', 'bg-purple-900/40 text-purple-400 shadow'],
] as const;
const WINDOWS = [7, 30, 60, 90];

const TOOLTIP_STYLE = {
    light: { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#0f172a' },
    dark: { backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' },
};

const AccuracyChart = ({ data }: { data: AccuracyPoint[] }) => {
    const { theme } = useTheme();
    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="formattedDate" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                    contentStyle={theme === 'light' ? TOOLTIP_STYLE.light : TOOLTIP_STYLE.dark}
                    itemStyle={{ fontWeight: 'bold' }}
                    formatter={formatReturnTooltip}
                    labelFormatter={(label, payload) => formatPointLabel(label, payload?.[0]?.payload)}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                <Area type="monotone" dataKey="equityReturn" name="Carteira Recomendada" stroke="#3B82F6" fillOpacity={1} fill="url(#colorAvg)" strokeWidth={2.5} dot={false} />
                {visibleBenchmarks(data).map((b) => (
                    <Area key={b.key} type="monotone" dataKey={b.key} name={b.name} stroke={b.stroke} fill="transparent" strokeDasharray={b.dash} strokeWidth={1.5} dot={false} />
                ))}
            </AreaChart>
        </ResponsiveContainer>
    );
};

type AccuracyProps = Pick<Props, 'accuracyData' | 'accuracyWindow' | 'setAccuracyWindow' | 'accuracyAsset' | 'setAccuracyAsset' | 'accuracyProfile' | 'setAccuracyProfile'>;

const AccuracyPanel = ({ accuracyData, accuracyWindow, setAccuracyWindow, accuracyAsset, setAccuracyAsset, accuracyProfile, setAccuracyProfile }: AccuracyProps) => (
    <div className="bg-base border border-slate-800 rounded-2xl p-6 mb-6 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Target size={18} className="text-purple-500" />Carteira Recomendada (Backtest Contínuo)</h3>
                <p className="text-xs text-slate-500">Valorização de uma carteira que segue a Research (só COMPRAR, entradas/saídas a cada publicação) vs benchmark da classe (IBOV · CDI · IFIX · S&P · BTC)</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <select value={accuracyAsset} onChange={(e) => setAccuracyAsset(e.target.value)} className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 outline-none">
                    {ASSET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {/* Perfil de risco — BRASIL_10 é curva única (carteira curada), sem seletor. */}
                {accuracyAsset !== 'BRASIL_10' && (
                    <div className="flex bg-slate-900 p-0.5 rounded border border-slate-700">
                        {PROFILE_OPTIONS.map(([key, label, activeCls]) => (
                            <button key={key} onClick={() => setAccuracyProfile(key)} className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${accuracyProfile === key ? activeCls : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
                        ))}
                    </div>
                )}
                <div className="flex bg-slate-900 p-0.5 rounded border border-slate-700">
                    {WINDOWS.map(days => (
                        <button key={days} onClick={() => setAccuracyWindow(days)} className={`px-3 py-1 text-[10px] font-bold rounded ${accuracyWindow === days ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>{days}D</button>
                    ))}
                </div>
            </div>
        </div>
        <div className="h-[280px] w-full">
            {accuracyData.length > 0 ? <AccuracyChart data={accuracyData} /> : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                    <Target size={24} className="opacity-30" />
                    <p className="text-xs">Sem curva para esta classe. É preciso ≥1 publicação da Research; a curva é gerada nas rotinas diárias (09:00/18:30).</p>
                </div>
            )}
        </div>
    </div>
);

type MacroProps = Pick<Props, 'macroData' | 'isLoadingMacro' | 'isMacroSyncing' | 'isSyncing' | 'isGlobalRunning' | 'onMacroSync' | 'onSyncData' | 'onRetryMacro'>;

const MacroPanel = ({ macroData, isLoadingMacro, isMacroSyncing, isSyncing, isGlobalRunning, onMacroSync, onSyncData, onRetryMacro }: MacroProps) => {
    const cards = buildMacroCards(macroData);
    return (
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
            {cards ? (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                    {cards.map((c) => <MacroCard key={c.label} {...c} />)}
                </div>
            ) : (
                <div className="text-center text-xs text-slate-500 py-4 flex flex-col items-center">
                    <p>Carregando dados globais ou serviço indisponível...</p>
                    {!isLoadingMacro && <button onClick={onRetryMacro} className="mt-2 text-blue-500 hover:underline">Tentar Novamente</button>}
                </div>
            )}
        </div>
    );
};

export const AdminPainelTab: React.FC<Props> = (props) => {
    const { qualityStats } = props;
    return (
        <>
            {/* Stats KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                <StaticKpi icon={<RefreshCw size={24} />} iconCls="w-12 h-12 bg-blue-900/20 rounded-xl flex items-center justify-center text-blue-500 border border-blue-900/50 shrink-0" label="Ativos Processados" value={qualityStats ? qualityStats.assetsProcessed : <Skel />} sub="Na última sincronização" />
                <StaticKpi icon={<ShieldCheck size={24} />} iconCls="w-12 h-12 bg-yellow-900/20 rounded-xl flex items-center justify-center text-yellow-500 border border-yellow-900/50 shrink-0" label="Typos Corrigidos" value={qualityStats ? qualityStats.typosFixed : <Skel />} sub="Sanitização ativa" />
                <BlacklistCard stats={qualityStats} isResetting={props.isResettingHealth} onReset={props.onResetHealth} />
                <SnapshotCard stats={qualityStats} isRunning={props.isSnapshotRunning} onForce={props.onForceSnapshot} />
                <TimeSeriesCard stats={qualityStats} isSyncing={props.isSyncingTimeSeries} onSync={props.onSyncTimeSeries} />
            </div>

            {/* Precisão do Algoritmo */}
            <AccuracyPanel {...props} />

            {/* Ambiente Macro */}
            <MacroPanel {...props} />
        </>
    );
};
