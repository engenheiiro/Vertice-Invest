
import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useFormValidation, validators } from '../hooks/useFormValidation';

const getPasswordStrength = (pwd: string): 0 | 1 | 2 | 3 => {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  return score as 0 | 1 | 2 | 3;
};

const strengthLabel: Record<1 | 2 | 3, string> = { 1: 'Fraca', 2: 'Média', 3: 'Forte' };
const strengthColor: Record<1 | 2 | 3, string> = { 1: 'bg-red-500', 2: 'bg-yellow-500', 3: 'bg-emerald-500' };
const strengthText: Record<1 | 2 | 3, string> = { 1: 'text-red-500', 2: 'text-yellow-500', 3: 'text-emerald-500' };

export const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [serverError, setServerError] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');

  const passwordStrength = getPasswordStrength(formData.password);

  const { errors, validate, clearError } = useFormValidation(formData, {
    name: validators.name(),
    email: validators.email(),
    password: validators.password(),
    confirmPassword: validators.match('password', 'As senhas'),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const isValid = validate();
    const hasTermsError = !acceptedTerms;
    if (hasTermsError) setTermsError('Você deve aceitar os termos');
    else setTermsError('');
    if (!isValid || hasTermsError) return;

    setStatus('loading');

    try {
      await authService.register({
        name: formData.name,
        email: formData.email,
        password: formData.password
      });

      setStatus('success');
      setTimeout(() => {
          navigate('/login');
      }, 600);

    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Erro ao criar conta.');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    clearError(name as keyof typeof formData);
    setServerError('');
    if (status === 'error') setStatus('idle');
  };

  return (
    <div className="w-full">
      <div className="mb-3 text-center lg:text-left">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Nova Credencial</h2>
        <p className="text-slate-500 text-[11px] font-medium">Preencha os dados para acessar.</p>
      </div>

      {serverError && (
        <div className="mb-2 p-1.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div>
            <Input
              label="Nome Completo"
              name="name"
              autoComplete="name"
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-2"
              className="px-3 py-2.5 text-sm"
              placeholder="Ex: João Silva"
            />

            <Input
              label="Email Corporativo ou Pessoal"
              name="email"
              type="email"
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-2"
              className="px-3 py-2.5 text-sm"
              placeholder="Ex: joao@email.com"
            />

            <div className="grid grid-cols-2 gap-2 mt-1">
              <Input
                label="Senha"
                name="password"
                type="password"
                autoComplete="new-password"
                value={formData.password}
                onChange={handleChange}
                error={errors.password}
                disabled={status === 'loading' || status === 'success'}
                containerClassName="mb-1"
                className="px-3 py-2.5 text-sm"
              />
              <Input
                label="Confirmar"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={formData.confirmPassword}
                onChange={handleChange}
                error={errors.confirmPassword}
                disabled={status === 'loading' || status === 'success'}
                containerClassName="mb-1"
                className="px-3 py-2.5 text-sm"
              />
            </div>

            {formData.password && (
              <div className="mb-2 px-0.5">
                <div className="flex gap-1">
                  {([1, 2, 3] as const).map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                        passwordStrength >= level && passwordStrength > 0
                          ? strengthColor[passwordStrength]
                          : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                {passwordStrength > 0 && (
                  <p className={`text-[10px] font-bold mt-0.5 ${strengthText[passwordStrength]}`}>
                    Senha {strengthLabel[passwordStrength]}
                  </p>
                )}
              </div>
            )}

            <div className="mt-2 flex items-start gap-2">
                <div className="flex items-center h-5">
                    <input
                        id="terms"
                        name="terms"
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => {
                            setAcceptedTerms(e.target.checked);
                            if (e.target.checked) setTermsError('');
                        }}
                        disabled={status === 'loading' || status === 'success'}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600 transition-colors cursor-pointer"
                    />
                </div>
                <div className="text-[11px] leading-tight">
                    <div className="flex flex-wrap gap-1">
                        <label htmlFor="terms" className="font-medium text-slate-600 cursor-pointer select-none">
                            Li e concordo com os
                        </label>
                        <Link to="/terms" className="text-blue-600 hover:underline font-bold hover:text-blue-800 transition-colors">
                            Termos de Uso
                        </Link>
                    </div>
                    {termsError && (
                        <p className="text-red-500 font-bold mt-0.5 animate-fade-in">{termsError}</p>
                    )}
                </div>
            </div>
        </div>

        <div className="pt-3">
            <Button type="submit" status={status} className="py-2.5 text-sm">Criar Conta</Button>
        </div>
      </form>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        <span className="text-[11px] text-slate-500 font-medium">Já possui conta?</span>
        <Link to="/login" className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors">
            Fazer Login
        </Link>
      </div>
    </div>
  );
};
