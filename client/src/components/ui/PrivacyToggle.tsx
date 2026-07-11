import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PrivacyToggleProps {
  isPrivacyMode: boolean;
  onToggle: () => void;
  size?: number;
  className?: string;
  hideTitle?: boolean;
}

export const PrivacyToggle: React.FC<PrivacyToggleProps> = ({
  isPrivacyMode,
  onToggle,
  size = 16,
  className = 'p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors',
  hideTitle = false,
}) => {
  return (
    <button
      onClick={onToggle}
      className={className}
      title={hideTitle ? undefined : isPrivacyMode ? 'Mostrar Valores' : 'Ocultar Valores'}
      aria-label={isPrivacyMode ? 'Mostrar Valores' : 'Ocultar Valores'}
      aria-pressed={isPrivacyMode}
    >
      {isPrivacyMode ? <EyeOff size={size} /> : <Eye size={size} />}
    </button>
  );
};
