import { useEffect, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import type { AssetType } from '../../contexts/WalletContext';
import {
  getAssetLogoUrl,
  getAssetInitials,
  getFallbackTextColor,
  getFixedIncomeLabel,
} from '../../utils/assetLogo';

interface AssetLogoProps {
  ticker: string;
  type?: AssetType;
  /** Moeda do ativo — desambigua a fonte de logo de ETF (BRL=B3, USD=US). */
  currency?: 'BRL' | 'USD';
  /** Nome do ativo (usado no alt da imagem e p/ rotular renda fixa). */
  name?: string;
  /** Reserva separada: força o cofrinho (PiggyBank) mesmo em RF marcada como reserva. */
  isReserve?: boolean;
  /** URL explícita (gancho futuro: backend pode popular logoUrl). Tem prioridade. */
  logoUrl?: string;
  /** Tamanho do container em px (default 32). */
  size?: number;
  /** Formato do container. */
  rounded?: 'lg' | 'full';
  className?: string;
}

/**
 * Logo do ativo num "chip" arredondado. Resolve em ordem:
 *  - CASH          → cofrinho (PiggyBank)
 *  - FIXED_INCOME  → rótulo curto do título (R+, SELIC, IPCA+, CDB...)
 *  - logo (CDN)    → imagem em chip claro (garante contraste no tema escuro)
 *  - fallback      → iniciais coloridas por tipo
 * Nenhum call site precisa lidar com <img>/onError — basta passar ticker + type.
 */
export default function AssetLogo({
  ticker,
  type,
  currency,
  name,
  isReserve,
  logoUrl,
  size = 32,
  rounded = 'lg',
  className = '',
}: AssetLogoProps) {
  const src = logoUrl || getAssetLogoUrl(ticker, type, currency);
  const [failed, setFailed] = useState(false);

  // Reseta o estado de erro quando a fonte muda (ex.: lista reciclando itens).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const radius = rounded === 'full' ? 'rounded-full' : 'rounded-lg';
  const dimension = { width: size, height: size };

  // Reserva / Caixa → cofrinho. `isReserve` cobre a Renda Fixa marcada como
  // reserva (type continua FIXED_INCOME, mas visualmente é um cofrinho).
  if (type === 'CASH' || isReserve) {
    return (
      <div
        style={dimension}
        className={`shrink-0 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 ${radius} ${className}`}
      >
        <PiggyBank size={Math.round(size * 0.55)} strokeWidth={2} />
      </div>
    );
  }

  // Renda Fixa / Tesouro → rótulo curto derivado do nome
  if (type === 'FIXED_INCOME') {
    const label = getFixedIncomeLabel(name, ticker);
    // Ajusta a fonte para o rótulo caber no chip (rótulos vão de "R+" a "IPCA+").
    const fontSize = Math.min(
      Math.round(size * 0.42),
      Math.floor((size - 4) / (label.length * 0.62))
    );
    return (
      <div
        style={dimension}
        className={`shrink-0 flex items-center justify-center bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black ${radius} ${className}`}
      >
        <span style={{ fontSize }} className="leading-none tracking-tight">
          {label}
        </span>
      </div>
    );
  }

  // Sem logo (ou imagem falhou) → iniciais coloridas por tipo
  if (!src || failed) {
    const fontSize = Math.max(9, Math.round(size * 0.36));
    return (
      <div
        style={dimension}
        className={`shrink-0 flex items-center justify-center bg-slate-800 border border-slate-700 font-bold ${radius} ${getFallbackTextColor(
          type
        )} ${className}`}
      >
        <span style={{ fontSize }} className="leading-none">
          {getAssetInitials(ticker)}
        </span>
      </div>
    );
  }

  // Logo via CDN → chip claro
  return (
    <div
      style={dimension}
      className={`shrink-0 flex items-center justify-center overflow-hidden bg-white/95 border border-slate-700/60 p-1 ${radius} ${className}`}
    >
      <img
        src={src}
        alt={name || ticker}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
}
