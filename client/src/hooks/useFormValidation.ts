import { useState } from 'react';

type RuleFn = (value: string, allValues: Record<string, string>) => string | undefined;

export function useFormValidation<T extends Record<string, string>>(
  values: T,
  rules: Partial<Record<keyof T, RuleFn>>
) {
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const validate = (): boolean => {
    const next: Partial<Record<keyof T, string>> = {};
    for (const field of Object.keys(rules) as Array<keyof T>) {
      const msg = rules[field]?.(values[field] ?? '', values as Record<string, string>);
      if (msg) next[field] = msg;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const clearError = (field: keyof T) =>
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });

  return { errors, validate, clearError, setErrors };
}

export const validators = {
  required:
    (label: string): RuleFn =>
    (v) =>
      !v.trim() ? `${label} é obrigatório` : undefined,

  email: (): RuleFn => (v) =>
    !v.trim()
      ? 'Email é obrigatório'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
      ? 'Formato de email inválido'
      : undefined,

  password: (): RuleFn => (v) => {
    if (!v) return 'Senha é obrigatória';
    if (v.length < 8) return 'A senha deve ter no mínimo 8 caracteres';
    if (!/[A-Z]/.test(v)) return 'A senha deve conter ao menos uma letra maiúscula';
    if (!/[0-9]/.test(v)) return 'A senha deve conter ao menos um número';
    return undefined;
  },

  name: (): RuleFn => (v) => {
    if (!v.trim()) return 'Nome é obrigatório';
    if (v.trim().length < 3) return 'Nome muito curto';
    if (!/^[a-zA-ZÀ-ÿ\s]+$/.test(v)) return 'Nome contém caracteres inválidos';
    return undefined;
  },

  match:
    (otherField: string, label = 'As senhas'): RuleFn =>
    (v, all) =>
      v !== (all[otherField] ?? '') ? `${label} não coincidem` : undefined,
};
