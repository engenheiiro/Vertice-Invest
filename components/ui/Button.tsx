import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  className = '', 
  isLoading = false,
  children,
  ...props 
}) => {
  const baseStyle = "w-full py-3.5 rounded-xl font-bold transition-all duration-300 text-sm tracking-wide flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98] relative overflow-hidden";
  
  const styles = {
    // Primary: Agora usa o Vértice Blue (blue-600) como cor principal de ação
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-600/30 border border-transparent",
    outline: "border border-slate-200 text-slate-600 hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 bg-white",
    ghost: "text-slate-500 hover:bg-blue-50 hover:text-blue-600"
  };

  return (
    <button 
      className={`${baseStyle} ${styles[variant]} ${className}`} 
      disabled={isLoading || props.disabled}
      {...props} 
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="animate-spin" size={18} />
          <span className="opacity-90">Processando...</span>
        </span>
      ) : children}
    </button>
  );
};