
import React, { useState, useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, id, onFocus, onBlur, type, containerClassName, className, ...props }) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isPasswordType = type === 'password';
  const inputType = isPasswordType && showPassword ? 'text' : type;

  const getLabelColor = () => {
    if (error) return 'text-red-500';
    if (isFocused) return 'text-blue-500';
    return 'text-slate-500';
  };

  return (
    <div className={`flex flex-col gap-1.5 relative ${containerClassName || 'mb-4'}`}>
      {label && (
        <label 
          id={labelId}
          htmlFor={inputId}
          className={`text-[10px] font-bold uppercase tracking-wider ml-1 transition-colors duration-200 ${getLabelColor()}`}
        >
          {label}
        </label>
      )}
      
      <div className="relative group">
        <input
          id={inputId}
          type={inputType}
          aria-labelledby={label ? labelId : undefined}
          aria-invalid={!!error}
          aria-errormessage={error ? errorId : undefined}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          className={`
            w-full rounded-xl border-0 ring-1 ring-inset transition-all duration-300 outline-none font-medium text-sm
            bg-[#0B101A] text-slate-200 placeholder:text-slate-600
            ${isPasswordType ? 'pr-12' : ''} 
            ${isFocused 
                ? 'ring-2 ring-blue-600 bg-[#0F1729] shadow-lg shadow-blue-900/10' 
                : 'ring-slate-800 hover:ring-slate-700 hover:bg-[#0F1729]'
            }
            ${error 
              ? 'ring-red-500/50 bg-red-900/10 focus:ring-red-500 placeholder:text-red-300/50' 
              : ''
            }
            ${props.disabled || props.readOnly ? 'opacity-60 cursor-not-allowed bg-slate-900/50' : ''}
            ${className || 'px-4 py-3'} 
          `}
          {...props}
        />

        {isPasswordType && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-blue-500 transition-colors p-1.5 rounded-full hover:bg-slate-800 focus:outline-none active:scale-95"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff size={18} strokeWidth={1.5} />
            ) : (
              <Eye size={18} strokeWidth={1.5} />
            )}
          </button>
        )}
      </div>
      
      {error && (
        <span 
          id={errorId}
          role="alert"
          className="text-[10px] text-red-500 font-bold ml-1 animate-fade-in"
        >
          {error}
        </span>
      )}
    </div>
  );
};
