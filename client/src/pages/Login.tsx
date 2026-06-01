import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { useFormValidation, validators } from '../hooks/useFormValidation';
import { PageMeta } from '../components/seo/PageMeta';

export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [serverError, setServerError] = useState('');
  // (I14) Segundo fator: quando o backend responde mfaRequired, mostramos o
  // campo de código e reenviamos o login com o mfaToken.
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');

  const { errors, validate, clearError } = useFormValidation(
    { email, password },
    {
      email: validators.email(),
      password: validators.required('Senha'),
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    // No passo de MFA não revalidamos email/senha (já validados); exige só o código.
    if (!mfaStep && !validate()) return;
    if (mfaStep && mfaToken.trim().length < 6) {
      setServerError('Informe o código de 6 dígitos.');
      return;
    }

    setStatus('loading');

    try {
      const response = await authService.login({
        email,
        password,
        ...(mfaStep ? { mfaToken: mfaToken.trim() } : {}),
      });

      if (response.mfaRequired) {
          // Senha OK — agora pede o segundo fator.
          setMfaStep(true);
          setStatus('idle');
          return;
      }

      if (response.user && response.accessToken) {
          login(response.user, response.accessToken);
          setStatus('success');
          setTimeout(() => {
              navigate('/dashboard');
          }, 600);
      } else {
          throw new Error("Resposta inválida do servidor");
      }

    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Servidor indisponível.');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  return (
    <>
    <PageMeta title="Entrar" noindex />
    <div className="w-full relative">
      {/* Botão de Voltar Profissional */}
      <div className="mb-8">
        <Link
            to="/"
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors group"
        >
            <ArrowLeft size={12} className="group-hover:-translate-x-1 transition-transform duration-300" />
            Voltar ao Início
        </Link>
      </div>

      <div className="mb-4 text-center lg:text-left">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Portal do Investidor</h2>
        <p className="text-slate-500 text-[11px] font-medium">Insira suas credenciais para continuar.</p>
      </div>

      {serverError && (
        <div className="mb-3 p-2 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {!mfaStep ? (
          <>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                 setEmail(e.target.value);
                 clearError('email');
                 setServerError('');
                 if (status === 'error') setStatus('idle');
              }}
              error={errors.email}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-3"
              className="px-4 py-2.5 text-sm"
            />

            <div className="relative">
              <Input
                label="Senha"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError('password');
                  setServerError('');
                  if (status === 'error') setStatus('idle');
                }}
                error={errors.password}
                disabled={status === 'loading' || status === 'success'}
                containerClassName="mb-1"
                className="px-4 py-2.5 text-sm"
              />
              <Link
                to="/forgot-password"
                className="absolute right-0 top-0 text-[9px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-wide cursor-pointer z-10"
              >
                Esqueceu a senha?
              </Link>
            </div>

            <div className="pt-3">
                <Button type="submit" status={status} className="py-2.5 text-sm">Entrar</Button>
            </div>
          </>
        ) : (
          <>
            <Input
              label="Código de verificação"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={11}
              placeholder="000000 ou código de backup"
              value={mfaToken}
              onChange={(e) => {
                setMfaToken(e.target.value);
                setServerError('');
                if (status === 'error') setStatus('idle');
              }}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-1"
              className="px-4 py-2.5 text-sm tracking-widest text-center"
            />
            <p className="text-[10px] text-slate-500 mb-2">
              Abra seu app autenticador e digite o código de 6 dígitos. Sem o app? Use um código de backup.
            </p>

            <div className="pt-2">
                <Button type="submit" status={status} className="py-2.5 text-sm">Verificar</Button>
            </div>
            <button
              type="button"
              onClick={() => { setMfaStep(false); setMfaToken(''); setServerError(''); setStatus('idle'); }}
              className="mt-3 w-full text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
            >
              Voltar ao login
            </button>
          </>
        )}
      </form>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        <span className="text-[11px] text-slate-500 font-medium">Ainda não é membro?</span>
        <Link
            to="/register"
            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
        >
            Cadastre-se
        </Link>
      </div>
    </div>
    </>
  );
};
