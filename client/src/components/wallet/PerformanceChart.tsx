
import React, { useState, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { RefreshCw } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';
import {
    chartPalette, filterByRange, isWalletWinning, reconcileWithKpis, toDisplayData, type TimeRange, type ViewMode,
} from './performanceChartView';
import { usePerformanceHistory } from './usePerformanceHistory';
import { PerformanceAreaChart, PerformanceChartHeader, PerformanceLegend } from './PerformanceChartParts';

const PANEL = 'bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[400px] sm:h-[420px]';

export const PerformanceChart = React.memo(() => {
    const { data, isLoading, isDemoMode } = usePerformanceHistory();
    const [timeRange, setTimeRange] = useState<TimeRange>('ALL');
    const [viewMode, setViewMode] = useState<ViewMode>('pct');
    const [showIbov, setShowIbov] = useState(false);
    const { theme } = useTheme();
    const { kpis, isPrivacyMode } = useWallet();

    // --- RECONCILIAÇÃO COM OS KPIs → PERÍODO → SÉRIES EM R$ ---
    const reconciledData = useMemo(() => reconcileWithKpis(data, kpis, isDemoMode), [data, kpis, isDemoMode]);
    const filteredData = useMemo(() => filterByRange(reconciledData, timeRange), [reconciledData, timeRange]);
    const displayData = useMemo(() => toDisplayData(filteredData, viewMode), [filteredData, viewMode]);

    if (isLoading) {
        return (
            <div className={`${PANEL} flex items-center justify-center animate-pulse`}>
                <div className="text-center">
                    <RefreshCw className="animate-spin text-blue-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Calculando rentabilidade relativa...</p>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className={`${PANEL} flex items-center justify-center`}>
                <p className="text-slate-500 text-sm">Dados insuficientes para comparação histórica.</p>
            </div>
        );
    }

    return (
        <div className={`${PANEL} flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors`}>

            <PerformanceChartHeader
                timeRange={timeRange}
                onTimeRange={setTimeRange}
                viewMode={viewMode}
                onViewMode={setViewMode}
                walletWin={isWalletWinning(filteredData, displayData, viewMode, showIbov)}
            />

            <PerformanceLegend showIbov={showIbov} onToggleIbov={() => setShowIbov((visible) => !visible)} />

            <PerformanceAreaChart
                displayData={displayData}
                filteredData={filteredData}
                timeRange={timeRange}
                viewMode={viewMode}
                showIbov={showIbov}
                isPrivacyMode={isPrivacyMode}
                palette={chartPalette(theme)}
            />
        </div>
    );
});
