import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link } from 'react-router-dom';
import { authService } from '../services/auth';
import { ArrowLeft, MailCheck } from 'lucide-react';

export const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setStatus('loading');

    try {
      await authService.forgotPassword(email);
      setStatus('success');
      setTimeout(() => setEmailSent(true), 1500);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  if (emailSent) {
      return (
          <div className="w-full text-center animate-fade-in">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <MailCheck size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Verifique seu email</h2>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                  Se um cadastro existir para <strong>{email}</strong>, enviamos um link para redefinição de senha. O link expira em 1 hora.
              </p>
              <Link to="/login">
                <Button variant="outline">Voltar para o Login</Button>
              </Link>
          </div>
      );
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <Link to="/login" className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-600 mb-4 transition-colors">
            <ArrowLeft size={14} /> Voltar
        </Link>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Recuperar Acesso</h2>
        <p className="text-slate-500 mt-1 text-xs font-medium">Informe seu email para receber o link de redefinição.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Input 
          label="Email Cadastrado" 
          type="email" 
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ex: voce@empresa.com"
          disabled={status === 'loading' || status === 'success'}
        />
        
        <div className="pt-4">
            <Button type="submit" status={status}>Enviar Link</Button>
        </div>
      </form>
    </div>
  );
};