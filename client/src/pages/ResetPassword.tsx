import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth';
import { useFormValidation, validators } from '../hooks/useFormValidation';

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [apiError, setApiError] = useState('');

  const { errors, validate, clearError } = useFormValidation(
    { password, confirmPassword },
    {
      password: validators.password(),
      confirmPassword: validators.match('password', 'As senhas'),
    }
  );

  if (!token) {
      return (
          <div className="text-center">
              <h2 className="text-red-600 font-bold mb-2">Link Inválido</h2>
              <p className="text-slate-500 text-sm">Token não encontrado na URL.</p>
          </div>
      );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;

    setStatus('loading');

    try {
      await authService.resetPassword(token, password);
      setStatus('success');
      setTimeout(() => {
          navigate('/login');
      }, 2000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Erro ao redefinir senha. O link pode ter expirado.');
      setStatus('error');
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Criar Nova Senha</h2>
        <p className="text-slate-500 mt-1 text-xs font-medium">Defina uma nova senha forte para sua conta.</p>
      </div>

      {apiError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100 text-center animate-fade-in">
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Input
          label="Nova Senha"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError('password');
          }}
          error={errors.password}
          disabled={status === 'loading' || status === 'success'}
        />

        <Input
          label="Confirmar Nova Senha"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearError('confirmPassword');
          }}
          error={errors.confirmPassword}
          disabled={status === 'loading' || status === 'success'}
        />

        <div className="pt-4">
            <Button type="submit" status={status}>Alterar Senha</Button>
        </div>
      </form>
    </div>
  );
};
