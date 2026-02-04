
import React from 'react';
import { Input } from './Input';

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  value: string | number;
  onChange: (value: string) => void; // Returns formatted string '1.000,00' or raw if preferred
  error?: string;
  containerClassName?: string;
  className?: string;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({ 
  value, 
  onChange, 
  ...props 
}) => {
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let inputValue = e.target.value;
    
    // Remove tudo que não é dígito
    const rawValue = inputValue.replace(/\D/g, '');
    
    if (!rawValue) {
      onChange('');
      return;
    }

    // Converte para float dividindo por 100 (centavos)
    const floatValue = parseFloat(rawValue) / 100;
    
    // Formata para BRL
    const formattedValue = floatValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    onChange(formattedValue);
  };

  return (
    <Input
      {...props}
      value={value}
      onChange={handleChange}
      placeholder="0,00"
    />
  );
};
