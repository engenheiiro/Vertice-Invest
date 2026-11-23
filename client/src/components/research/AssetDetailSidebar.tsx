/**
 * Coluna de identidade do dossiê de ativo: classe/setor, ticker com perfil e
 * nota, sinal quantitativo, alerta qualitativo, radar dos eixos estruturais e
 * o resumo de valuation (preço → teto → upside → yield).
 */
import React from 'react';
import { X, Shield, Target, Zap, AlertOctagon, DollarSign } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import type { RankingItem } from '../../services/research';
import AssetLogo from '../common/AssetLogo';
import type { AssetType } from '../../contexts/WalletContext';
import {
    actionView, computeUpside, formatCurrency, priceCurrency, profileSignalLabel, scoreGrade, scoreGradeClass,
    structuralScores, upsideLabel, yieldColor, yieldLabel,
} from './assetDetailView';

type Structural = ReturnType<typeof structuralScores>;

// Rótulo do sub-tipo de Exterior (STOCK_US) exibido como badge no cabeçalho.
const US_SUB_BADGE: Record<string, string> = { STOCK: 'Stock', ETF: 'ETF', REIT: 'REIT', DOLLAR: 'Dólar', GOLD: 'Ouro' };

const GRADE_BOX = 'w-12 h-12 rounded-xl border-2 flex items-center justify-center font-black text-xl shadow-lg shadow-black/20';
const MOBILE_CLOSE = 'md:hidden absolute top-2 right-2 z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full '
    + 'bg-base/80 text-slate-400 hover:text-white transition-colors';
const BADGE = 'text-[10px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase';
const PROFILE_BADGES: Record<string, { Icon: typeof Shield; label: string; tone: string }> = {
    DEFENSIVE: { Icon: Shield, label: 'Defensivo', tone: 'bg-emerald-900/30 border border-emerald-900/50 text-emerald-400' },
    MODERATE: { Icon: Target, label: 'Moderado', tone: 'bg-blue-900/30 border border-blue-900/50 text-blue-400' },
    BOLD: { Icon: Zap, label: 'Arrojado', tone: 'bg-purple-900/30 border border-purple-900/50 text-purple-400' },
};

const ProfileBadge = ({ riskProfile }: { riskProfile: RankingItem['riskProfile'] }) => {
    const badge = riskProfile ? PROFILE_BADGES[riskProfile] : undefined;
    if (!badge) return null;
    const { Icon } = badge;
    return (
        <span className={`px-2 py-0.5 rounded ${badge.tone} text-[8px] font-black uppercase tracking-widest flex items-center gap-1`}>
            <Icon size={8} /> {badge.label}
        </span>
    );
};

const ClassBadges = ({ asset }: { asset: RankingItem }) => (
    <div className="flex items-center gap-2 mb-2">
        <span className={BADGE}>{asset.type}</span>
        <span className={BADGE}>{asset.sector || 'Geral'}</span>
        {asset.type === 'STOCK_US' && asset.usSubType && (
            <span className="text-[10px] font-bold bg-indigo-900/30 text-indigo-300 px-2 py-0.5 rounded uppercase border border-indigo-900/50">
                {US_SUB_BADGE[asset.usSubType] || asset.usSubType}
            </span>
        )}
    </div>
);

const TickerHeader = ({ asset }: { asset: RankingItem }) => (
    <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3 min-w-0">
            <AssetLogo ticker={asset.ticker} type={(asset.type || 'STOCK') as AssetType} name={asset.name} sector={asset.sector} size={48} />
            <div className="flex flex-col min-w-0">
            <h2 id="asset-detail-title" className="text-4xl font-black text-white tracking-tighter">{asset.ticker}</h2>
            <div className="flex gap-2 mt-1">
                <ProfileBadge riskProfile={asset.riskProfile} />
            </div>
            </div>
        </div>
        <div className={`${GRADE_BOX} ${scoreGradeClass(asset.score)}`}>
            {scoreGrade(asset.score)}
        </div>
    </div>
);

const SignalCard = ({ asset }: { asset: RankingItem }) => {
    const view = actionView(asset.action);
    return (
        <div className="mt-6 p-4 bg-slate-900/50 rounded-xl border border-slate-800 text-center">
            <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Sinal quantitativo</p>
            <div className={`text-xl font-black uppercase ${view.textClass}`}>
                {view.label}
            </div>
            <p className="mt-1 text-[9px] leading-tight text-slate-500">
                Para o perfil {profileSignalLabel(asset.riskProfile)}
            </p>
            <div className="h-1 w-20 mx-auto bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div className={`h-full ${view.barClass} w-full`}></div>
            </div>
        </div>
    );
};

const RiskVetoCard = ({ veto }: { veto: RankingItem['riskVeto'] }) => {
    if (!veto?.active) return null;
    return (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-left">
            <div className="flex items-center gap-2 text-red-400">
                <AlertOctagon size={15} />
                <p className="text-[10px] font-black uppercase tracking-wide">
                    Alerta qualitativo {veto.level}
                </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-red-200/90">{veto.rationale}</p>
            <p className="mt-2 text-[9px] leading-tight text-slate-500">
                Avaliação separada: este alerta não altera o score nem o sinal quantitativo.
            </p>
        </div>
    );
};

const StructuralRadar = ({ s }: { s: Structural }) => {
    const radarData = [
        { subject: 'Qualidade', A: s.quality, fullMark: 100 },
        { subject: 'Valuation', A: s.valuation, fullMark: 100 },
        { subject: 'Segurança', A: s.risk, fullMark: 100 },
    ];
    return (
        <div className="h-[200px] w-full -ml-4">
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                        name="Score"
                        dataKey="A"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="#3b82f6"
                        fillOpacity={0.3}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
};

const LEGEND: Array<{ label: string; key: keyof Structural; color: string }> = [
    { label: 'Qualidade', key: 'quality', color: 'text-blue-400' },
    { label: 'Valuation', key: 'valuation', color: 'text-emerald-400' },
    { label: 'Segurança', key: 'risk', color: 'text-purple-400' },
];

// Legenda simples dos valores para não perder a precisão.
const StructuralLegend = ({ s }: { s: Structural }) => (
    <div className="grid grid-cols-3 gap-2 text-center mb-4">
        {LEGEND.map(({ label, key, color }) => (
            <div key={key}>
                <p className="text-[10px] text-slate-500 uppercase">{label}</p>
                <p className={`text-sm font-bold ${color}`}>{s[key]}</p>
            </div>
        ))}
    </div>
);

const PriceLine = ({ label, value, valueClass }: { label: string; value: string; valueClass: string }) => (
    <div className="flex justify-between items-center">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={`text-sm tabular-nums ${valueClass} font-bold`}>{value}</span>
    </div>
);

// Valuation reorganizada: Preço → Teto → Upside → Yield.
const ValuationSummary = ({ asset }: { asset: RankingItem }) => {
    const currency = priceCurrency(asset.type || 'STOCK');
    const upside = computeUpside(asset.currentPrice, asset.targetPrice);
    const upsideTone = upside > 0 ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400';
    return (
        <div className="mt-6 pt-6 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-3 flex items-center gap-1"><Target size={12}/> Valuation (Estimado)</p>
            <div className="space-y-3">
                <PriceLine label="Preço Atual" value={formatCurrency(asset.currentPrice, currency)} valueClass="text-white" />
                <PriceLine label="Preço Teto" value={formatCurrency(asset.targetPrice, currency)} valueClass="text-blue-400" />
                <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Upside Potencial</span>
                    <span className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${upsideTone}`}>
                        {upsideLabel(upside)}
                    </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800/50">
                    <span className="text-xs text-slate-400 font-bold flex items-center gap-1"><DollarSign size={10}/> Yield (12m)</span>
                    <span className={`text-sm tabular-nums font-black ${yieldColor(asset.metrics.dy)}`}>
                        {yieldLabel(asset.metrics.dy)}
                    </span>
                </div>
            </div>
        </div>
    );
};

export const AssetDetailSidebar = ({ asset, onClose }: { asset: RankingItem; onClose: () => void }) => {
    const s = structuralScores(asset.metrics);
    return (
        <div className="relative w-full md:w-[320px] shrink-0 bg-card border-r border-slate-800 p-5 pt-14 md:p-6 flex flex-col md:overflow-y-auto">
            {/* Fechar acessível no topo do mobile — no desktop ele vive no header do dossiê. */}
            <button
                onClick={onClose}
                aria-label="Fechar"
                className={MOBILE_CLOSE}
            >
                <X size={20} />
            </button>
            <div className="mb-6">
                <ClassBadges asset={asset} />
                <TickerHeader asset={asset} />
                <p className="text-slate-500 text-sm font-medium leading-tight">{asset.name}</p>
                <SignalCard asset={asset} />
                <RiskVetoCard veto={asset.riskVeto} />
            </div>
            <StructuralRadar s={s} />
            <StructuralLegend s={s} />
            <ValuationSummary asset={asset} />
        </div>
    );
};
