import React, { useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useTheme } from '../../contexts/ThemeContext';
import { formatCurrency, formatCompact } from '../../utils/format';
import type { TrajectoryPoint } from '../../services/goals';

interface GoalTrajectoryChartProps {
  points: TrajectoryPoint[];
  targetAmount: number;
  /** Cor da série Real (accent da meta). */
  stroke: string;
}

/**
 * Trajetória da meta: Real (passado) + Plano (início→alvo) + Projeção (hoje→alvo),
 * contra a linha da Meta.
 *
 * O eixo é TEMPORAL, não categórico. Os pontos da trajetória não são
 * equidistantes: o backend usa passo trimestral/semestral em horizontes longos e
 * insere um ponto extra na data de CHEGADA de cada curva, que cai no meio do mês.
 * Num eixo categórico todo ponto ocupa a mesma largura, então um salto de 4 dias
 * era desenhado tão largo quanto um de 3 meses — e o Plano parecia estagnar
 * (subia "só R$ 200 num mês") logo antes da chegada. Com `type="number"` +
 * `scale="time"` cada ponto cai na posição real da linha do tempo e a inclinação
 * volta a ser legível.
 */
export const GoalTrajectoryChart: React.FC<GoalTrajectoryChartProps> = ({ points, targetAmount, stroke }) => {
  const { theme: uiTheme } = useTheme();
  const tooltipStyle = uiTheme === 'light'
    ? { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#0f172a' }
    : { background: '#0B101A', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 };

  const { rows, ticks } = useMemo(() => {
    const data = points.map((p) => ({ ...p, ts: new Date(p.t).getTime() }));
    // Rótulos só nos inícios de mês (a chegada é dia quebrado), afinados p/ ~6.
    const monthly = data.filter((r) => new Date(r.ts).getUTCDate() === 1).map((r) => r.ts);
    const stride = Math.max(1, Math.ceil(monthly.length / 6));
    const picked = monthly.filter((_, i) => i % stride === 0);
    const last = monthly[monthly.length - 1];
    if (last !== undefined && !picked.includes(last)) picked.push(last);
    return { rows: data, ticks: picked };
  }, [points]);

  if (rows.length < 2) return null;

  const fmtAxis = (t: number) => new Date(t).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

  return (
    <div className="bg-base border border-slate-800 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Trajetória da meta</p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="goalReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={ticks}
            tickFormatter={fmtAxis}
            tick={{ fontSize: 9, fill: '#64748b' }}
          />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={48} tickFormatter={(v) => formatCompact(v, null)} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            formatter={(value: number, key: string) => [formatCurrency(value), key === 'real' ? 'Real' : key === 'planned' ? 'Plano' : 'Projeção']}
          />
          <ReferenceLine y={targetAmount} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
          <Area type="monotone" dataKey="real" stroke={stroke} strokeWidth={2} fill="url(#goalReal)" connectNulls={false} dot={false} />
          <Line type="monotone" dataKey="planned" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
          <Line type="monotone" dataKey="projected" stroke="#60a5fa" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ background: stroke }} /> Real</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-slate-400" /> Plano</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-blue-400" /> Projeção</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-amber-500" /> Meta</span>
      </div>
    </div>
  );
};
