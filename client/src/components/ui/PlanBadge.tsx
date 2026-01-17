import React from 'react';
import { UserPlan } from '../../contexts/AuthContext';
import { Crown, Zap, Shield } from 'lucide-react';

interface PlanBadgeProps {
  plan: UserPlan;
  className?: string;
  showIcon?: boolean;
}

export const PlanBadge: React.FC<PlanBadgeProps> = ({ plan, className = '', showIcon = true }) => {
  const styles = {
    GUEST: "bg-slate-800 text-slate-400 border-slate-700",
    ESSENTIAL: "bg-emerald-900/30 text-emerald-400 border-emerald-900/50 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    PRO: "bg-blue-900/30 text-blue-400 border-blue-900/50 shadow-[0_0_10px_rgba(59,130,246,0.2)]",
    BLACK: "bg-gradient-to-r from-slate-900 via-[#1a1a1a] to-slate-900 text-[#D4AF37] border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.15)]"
  };

  const labels = {
    GUEST: "Visitante",
    ESSENTIAL: "Essential",
    PRO: "Pro Member",
    BLACK: "Black Elite"
  };

  const icons = {
    GUEST: <Shield size={10} />,
    ESSENTIAL: <Shield size={10} />,
    PRO: <Zap size={10} fill="currentColor" />,
    BLACK: <Crown size={10} fill="currentColor" />
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles[plan]} ${className}`}>
      {showIcon && icons[plan]}
      <span>{labels[plan]}</span>
    </div>
  );
};