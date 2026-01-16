import React from 'react';
import { Loader2, Check, XCircle } from 'lucide-react';

export type ButtonStatus = 'idle' | 'loading' | 'success' | 'error';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  status?: ButtonStatus;
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  className = '', 
  status = 'idle',
  isLoading = false,
  children,
  ...props 
}) => {
  const currentStatus = isLoading && status === 'idle' ? 'loading' : status;

  const baseStyle = "w-full py-3.5 rounded-xl font-bold transition-all duration-300 text-sm tracking-wide flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98] relative overflow-hidden";
  
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-600/30 border border-transparent",
    outline: "border border-slate-200 text-slate-600 hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 bg-white",
    ghost: "text-slate-500 hover:bg-blue-50 hover:text-blue-600"
  };

  const feedbackStyles = {
    success: "bg-emerald-500 hover:bg-emerald-600 text-white border-transparent shadow-emerald-500/30 ring-2 ring-emerald-500/20",
    error: "bg-rose-500 hover:bg-rose-600 text-white border-transparent shadow-rose-500/30 ring-2 ring-rose-500/20 animate-shake"
  };

  let activeClass = variants[variant];
  
  if (currentStatus === 'success') activeClass = feedbackStyles.success;
  if (currentStatus === 'error') activeClass = feedbackStyles.error;

  const renderContent = () => {
    switch (currentStatus) {
      case 'loading':
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="animate-spin" size={18} />
            <span className="opacity-90">Processando...</span>
          </span>
        );
      case 'success':
        return (
          <span className="flex items-center gap-2 animate-fade-in">
            <Check size={18} strokeWidth={3} />
            <span>Concluído!</span>
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-2 animate-fade-in">
            <XCircle size={18} strokeWidth={2.5} />
            <span>Erro</span>
          </span>
        );
      default:
        return children;
    }
  };

  return (
    <button 
      className={`${baseStyle} ${activeClass} ${className}`} 
      disabled={currentStatus === 'loading' || currentStatus === 'success' || props.disabled}
      {...props} 
    >
      {renderContent()}
    </button>
  );
};