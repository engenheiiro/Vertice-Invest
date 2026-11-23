/**
 * Corpo do dossiê de ativo: boletim do score, detalhamento de pontos (auditoria
 * já recortada pelo perfil), quadro de indicadores, teses bull/bear,
 * demonstrativos e a tese algorítmica.
 */
import React from 'react';
import { Activity, AlertTriangle, AlertOctagon, ThumbsUp, ThumbsDown, BarChart2, Database } from 'lucide-react';
import type { AuditEntry, RankingItem } from '../../services/research';
import {
    buildFinancialSection, buildMetricRows, detailRowColor, filterAuditForProfile, scoreVerdict, splitAudit,
    structuralScores, type DetailRowData,
} from './assetDetailView';

const ROW_BOX = 'flex justify-between items-center text-xs border-b border-slate-800/50 pb-2 last:border-0 group hover:bg-slate-800/20 px-2 '
    + 'rounded transition-colors';
const AUDIT_ITEM = 'p-3 rounded-xl flex items-center justify-between';
const BONUS_NOTE = 'Pontuação abaixo de 100 indica critérios bônus não conquistados '
    + '(ex.: crescimento acelerado, liquidez excepcional), não penalidades aplicadas.';

const DetailRow = ({ label, value, status }: DetailRowData) => (
    <div className={ROW_BOX}>
        <span className="text-slate-400 font-medium group-hover:text-slate-200">{label}</span>
        <span className={`tabular-nums font-bold flex items-center gap-1 ${detailRowColor(value, status)}`}>
            {value !== '-' && status === 'bad' && <AlertTriangle size={10} />}
            {value !== '-' && status === 'warning' && <AlertOctagon size={10} />}
            {value}
        </span>
    </div>
);

const RowGrid = ({ rows }: { rows: DetailRowData[] }) => (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        {rows.map((r) => <DetailRow key={r.label} {...r} />)}
    </div>
);

const AxisBar = ({ label, value, textClass, barClass, extra = '' }: {
    label: string; value: number; textClass: string; barClass: string; extra?: string;
}) => (
    <>
        <div className={`flex justify-between items-center text-[10px] font-bold${extra}`}>
            <span className="text-slate-500 uppercase">{label}</span>
            <span className={textClass}>{value}%</span>
        </div>
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${barClass}`} style={{ width: `${value}%` }}></div>
        </div>
    </>
);

const ScoreBulletin = ({ asset }: { asset: RankingItem }) => {
    const s = structuralScores(asset.metrics);
    return (
        <div className="bg-card rounded-2xl p-6 border border-slate-700/50 relative overflow-hidden group">
            <div className="flex items-center justify-between relative z-10">
                <div>
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Resultado da Avaliação IA</h4>
                    <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-black text-white">{asset.score}</span>
                        <span className="text-slate-500 font-bold">/ 100</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 font-medium max-w-sm">
                        {scoreVerdict(asset.score)}
                    </p>
                </div>

                <div className="hidden lg:grid grid-cols-1 gap-2 min-w-[140px]">
                    <AxisBar label="Qualidade" value={s.quality} textClass="text-emerald-400" barClass="bg-emerald-500" />
                    <AxisBar label="Valuation" value={s.valuation} textClass="text-blue-400" barClass="bg-blue-500" extra=" mt-2" />
                </div>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 blur-[80px] rounded-full pointer-events-none"></div>
        </div>
    );
};

const EMPTY_BOX = 'text-[10px] text-slate-600 italic p-4 text-center border border-dashed border-slate-800 rounded-xl';

const AuditGains = ({ gains }: { gains: AuditEntry[] }) => (
    <div className="space-y-2">
        <p className="text-[9px] font-black text-emerald-500 uppercase ml-1 opacity-70 flex items-center gap-1">
            <ThumbsUp size={10} /> Onde Ganhou Pontos
        </p>
        <div className="space-y-2">
            {gains.map((log, i) => (
                <div key={`p-${i}`} className={`bg-emerald-500/5 border border-emerald-500/10 ${AUDIT_ITEM} group-hover:bg-emerald-500/10 transition-all`}>
                    <div className="flex flex-col">
                        <span className="text-[7px] font-black text-emerald-600 uppercase tracking-tight">{log.category}</span>
                        <span className="text-[11px] text-slate-200 font-medium">✓ {log.factor}</span>
                    </div>
                    <span className="text-[10px] font-black text-emerald-400 ml-2">+{log.points}</span>
                </div>
            ))}
            {gains.length === 0 && (
                <div className={EMPTY_BOX}>Sem bônus significativos.</div>
            )}
        </div>
    </div>
);

const AuditLosses = ({ losses, score }: { losses: AuditEntry[]; score: number }) => (
    <div className="space-y-2">
        <p className="text-[9px] font-black text-red-500 uppercase ml-1 opacity-70 flex items-center gap-1">
            <ThumbsDown size={10} /> Onde Perdeu Pontos
        </p>
        <div className="space-y-2">
            {losses.map((log, i) => (
                <div key={`m-${i}`} className={`bg-red-500/5 border border-red-500/10 ${AUDIT_ITEM} group-hover:bg-red-500/10 transition-all`}>
                    <div className="flex flex-col">
                        <span className="text-[7px] font-black text-red-600 uppercase tracking-tight">{log.category}</span>
                        <span className="text-[11px] text-slate-300 font-medium">⚠️ {log.factor}</span>
                    </div>
                    <span className="text-[10px] font-black text-red-400 ml-2">{log.points}</span>
                </div>
            ))}
            {losses.length === 0 && (
                <div className={EMPTY_BOX}>
                    Sem penalidades registradas.
                    {score < 100 && (
                        <p className="mt-1 text-slate-700 not-italic">
                            {BONUS_NOTE}
                        </p>
                    )}
                </div>
            )}
        </div>
    </div>
);

const AuditBreakdown = ({ asset }: { asset: RankingItem }) => {
    // Regra #3: só categorias universais + a do perfil do ativo.
    const { gains, losses } = React.useMemo(
        () => splitAudit(filterAuditForProfile(asset.auditLog, asset.riskProfile)),
        [asset.auditLog, asset.riskProfile],
    );
    if (!asset.auditLog || asset.auditLog.length === 0) return null;
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h4 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <Database size={16} className="text-blue-500" /> Detalhamento de Pontos
                </h4>
                <span className="text-[10px] font-bold text-slate-500 uppercase bg-slate-900 px-2 py-0.5 rounded">Transparência Algorítmica</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AuditGains gains={gains} />
                <AuditLosses losses={losses} score={asset.score} />
            </div>
        </div>
    );
};

const THESIS_TONES = {
    emerald: { box: 'bg-emerald-900/10 border border-emerald-900/30', icon: 'text-emerald-500', title: 'text-emerald-400', dot: 'bg-emerald-500' },
    red: { box: 'bg-red-900/10 border border-red-900/30', icon: 'text-red-500', title: 'text-red-400', dot: 'bg-red-500' },
};

const ThesisCard = ({ points, tone, Icon, title, emptyText }: {
    points: string[] | undefined; tone: 'emerald' | 'red'; Icon: typeof ThumbsUp; title: string; emptyText: string;
}) => {
    const t = THESIS_TONES[tone];
    return (
        <div className={`${t.box} rounded-2xl p-5 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <Icon size={60} className={t.icon} />
            </div>
            <div className={`flex items-center gap-2 mb-4 ${t.title} relative z-10`}>
                <Icon size={18} />
                <h4 className="text-sm font-black uppercase tracking-wide">{title}</h4>
            </div>
            {points && points.length > 0 ? (
                <ul className="space-y-2.5 relative z-10">
                    {points.map((point, i) => (
                        <li key={i} className="text-xs text-slate-300 leading-relaxed flex items-start gap-2">
                            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${t.dot} shrink-0`}></span>
                            {point}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-slate-500 italic relative z-10">{emptyText}</p>
            )}
        </div>
    );
};

const FinancialBlock = ({ asset }: { asset: RankingItem }) => {
    const section = buildFinancialSection(asset);
    if (!section) return null;
    return (
        <div className="mb-8 bg-card p-4 rounded-xl border border-slate-800/50">
            <div className="flex items-center gap-2 mb-5 pb-2 border-b border-slate-800">
                <Database size={16} className="text-blue-500" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wide">{section.title}</h4>
            </div>
            <RowGrid rows={section.rows} />
        </div>
    );
};

const DEFAULT_REASON = 'Análise baseada em fluxo de caixa descontado, múltiplos históricos e eficiência operacional comparativa.';

export const AssetDetailDossier = ({ asset }: { asset: RankingItem }) => (
    <div className="flex-1 md:overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar space-y-6 md:space-y-8">
        <ScoreBulletin asset={asset} />
        <AuditBreakdown asset={asset} />

        {/* FUNDAMENTOS & DATA */}
        <div className="space-y-5">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                <BarChart2 size={18} className="text-blue-500" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wide">Quadro de Indicadores</h4>
            </div>
            <RowGrid rows={buildMetricRows(asset)} />
        </div>

        {/* TESE DE INVESTIMENTO (BULL/BEAR) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ThesisCard points={asset.bullThesis} tone="emerald" Icon={ThumbsUp} title="Por que Investir?"
                emptyText="Aguardando geração de tese positiva pelo algoritmo." />
            <ThesisCard points={asset.bearThesis} tone="red" Icon={AlertTriangle} title="Riscos & Atenção"
                emptyText="Nenhum risco crítico detectado automaticamente." />
        </div>

        <FinancialBlock asset={asset} />

        <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-800/50 flex items-start gap-3">
            <div className="p-2 bg-slate-800 rounded-lg text-blue-400">
                <Activity size={16} />
            </div>
            <div>
                <h5 className="text-xs font-bold text-white mb-1">Tese Algorítmica Vértice</h5>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    {asset.reason || DEFAULT_REASON}
                </p>
            </div>
        </div>
    </div>
);
