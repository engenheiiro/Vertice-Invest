import React, { useState, useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, id, onFocus, onBlur, type, ...props }) => {
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
    if (isFocused) return 'text-blue-600';
    return 'text-slate-500';
  };

  return (
    <div className="flex flex-col gap-1.5 mb-5 relative">
      <label 
        id={labelId}
        htmlFor={inputId}
        className={`text-xs font-bold uppercase tracking-wider ml-1 transition-colors duration-200 ${getLabelColor()}`}
      >
        {label}
      </label>
      
      <div className="relative group">
        <input
          id={inputId}
          type={inputType}
          aria-labelledby={labelId}
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
            w-full px-4 py-3.5 rounded-xl border-0 ring-1 ring-inset transition-all duration-300 outline-none font-medium text-slate-900
            bg-slate-50 hover:bg-white
            ${isPasswordType ? 'pr-12' : ''} 
            ${isFocused ? 'bg-white shadow-lg' : ''}
            ${error 
              ? 'ring-red-300 bg-red-50/50 focus:ring-red-400 placeholder:text-red-300' 
              : isFocused 
                ? 'ring-blue-600' 
                : 'ring-slate-200 placeholder:text-slate-400'
            }
          `}
          {...props}
        />

        {isPasswordType && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors p-1.5 rounded-full hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-100 active:scale-95"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff size={20} strokeWidth={1.5} />
            ) : (
              <Eye size={20} strokeWidth={1.5} />
            )}
          </button>
        )}
      </div>
      
      {error && (
        <span 
          id={errorId}
          role="alert"
          className="text-xs text-red-500 font-semibold ml-1 mt-1 animate-fade-in"
        >
          {error}
        </span>
      )}
    </div>
  );
};