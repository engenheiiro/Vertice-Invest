import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, ...props }) => {
  return (
    <div className="group flex flex-col gap-1.5 mb-5 relative">
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 group-focus-within:text-blue-600 transition-colors">
        {label}
      </label>
      <div className="relative">
        <input
          className={`
            w-full px-4 py-3.5 rounded-xl border-0 ring-1 ring-inset transition-all duration-300 outline-none font-medium text-slate-900
            bg-slate-50 hover:bg-white focus:bg-white focus:ring-2 focus:shadow-lg
            ${error 
              ? 'ring-red-300 bg-red-50/50 focus:ring-red-400 placeholder:text-red-300' 
              : 'ring-slate-200 focus:ring-blue-600 placeholder:text-slate-400'}
          `}
          {...props}
        />
      </div>
      {error && (
        <span className="text-xs text-red-500 font-semibold ml-1 mt-1 animate-fade-in">
          {error}
        </span>
      )}
    </div>
  );
};