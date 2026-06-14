
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Mail } from 'lucide-react';
import { PageMeta } from '../components/seo/PageMeta';

export const Privacy = () => {
  return (
    <>
    <PageMeta
      title="Política de Privacidade"
      description="Política de Privacidade da Vértice Invest — saiba como tratamos seus dados pessoais conforme a LGPD (Lei nº 13.709/2018)."
      canonical="/privacy"
    />
    <div className="w-full max-h-[500px] overflow-y-auto pr-3 custom-scrollbar">
      <div className="mb-6 flex items-center gap-2 sticky top-0 bg-white/95 backdrop-blur-sm z-20 pb-2 pt-1 border-b border-slate-100">
        <Link to="/register" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
            <ArrowLeft size={20} />
        </Link>
        <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Política de Privacidade</h2>
            <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Versão 1.0 — Junho de 2025 • Lei nº 13.709/2018 (LGPD)</p>
        </div>
      </div>

      <div className="prose prose-sm prose-slate text-slate-600 pb-4">
        <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100 mb-6 flex gap-3">
            <ShieldCheck className="text-emerald-600 shrink-0 mt-0.5" size={22} />
            <p className="text-xs text-emerald-800 font-medium m-0">
                A Vértice Invest respeita sua privacidade e trata seus dados pessoais em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
            </p>
        </div>

        <h3 className="text-slate-900 font-bold text-base mb-2">1. Controlador dos Dados</h3>
        <p className="mb-4">
          Os dados pessoais coletados na plataforma Vértice Invest são tratados por:<br />
          <strong>Controlador:</strong> Matheus Ambrózio (pessoa física)<br />
          <strong>Contato:</strong>{' '}
          <a href="mailto:contato.verticeinvest@gmail.com" className="text-blue-600 hover:underline font-medium">
            contato.verticeinvest@gmail.com
          </a><br />
          <span className="text-xs text-slate-500">
            Dados completos de identificação (CPF e endereço) constam do registro interno
            de tratamento e são fornecidos à ANPD ou ao titular mediante requisição.
          </span>
        </p>

        <h3 className="text-slate-900 font-bold text-base mb-2">2. Dados Pessoais Coletados</h3>
        <p className="mb-2">Coletamos apenas os dados necessários para a prestação dos nossos serviços (princípio da minimização — Art. 6º, III):</p>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li><strong>Cadastro:</strong> nome completo, e-mail, senha (armazenada com hash bcrypt).</li>
          <li><strong>Perfil opcional:</strong> CPF (armazenado sem exposição em logs), telefone, ocupação.</li>
          <li><strong>Carteira e operações:</strong> ativos, lotes fiscais, transações e metas de investimento.</li>
          <li><strong>Logs de acesso e auditoria:</strong> IP, user-agent, data/hora e ação realizada (segurança e prevenção a fraudes).</li>
          <li><strong>Tokens de sessão:</strong> refresh tokens armazenados com hash SHA-256, expirando em 7 dias.</li>
        </ul>

        <h3 className="text-slate-900 font-bold text-base mb-2">3. Bases Legais (Art. 7º)</h3>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li><strong>Execução de contrato (inciso V):</strong> dados de cadastro e carteira, necessários para a prestação do serviço contratado.</li>
          <li><strong>Legítimo interesse (inciso IX):</strong> logs de segurança, prevenção a fraudes e melhoria da plataforma.</li>
          <li><strong>Consentimento (inciso I):</strong> comunicações de marketing opcionais (opt-in explícito).</li>
          <li><strong>Cumprimento de obrigação legal (inciso II):</strong> guarda de dados financeiros conforme legislação aplicável.</li>
        </ul>

        <h3 className="text-slate-900 font-bold text-base mb-2">4. Finalidades do Tratamento</h3>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li>Criação e gestão de conta de usuário.</li>
          <li>Fornecimento de análises quantitativas, rankings e sinais financeiros.</li>
          <li>Gestão de carteira, cálculo de performance e geração de snapshots.</li>
          <li>Processamento de assinaturas e pagamentos.</li>
          <li>Segurança da conta: autenticação, MFA e detecção de acessos suspeitos.</li>
          <li>Comunicações transacionais (redefinição de senha, recibos).</li>
          <li>Comunicações de marketing (apenas com consentimento explícito).</li>
        </ul>

        <h3 className="text-slate-900 font-bold text-base mb-2">5. Compartilhamento com Terceiros</h3>
        <p className="mb-2">Seus dados <strong>nunca são vendidos</strong>. Compartilhamos apenas com operadores que nos auxiliam na prestação do serviço, sob contrato e com finalidade específica:</p>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li><strong>Mercado Pago:</strong> processamento de pagamentos (identificador de usuário e valor da transação).</li>
          <li><strong>Google (Gemini AI):</strong> geração de narrativas de mercado — apenas tickers e setores públicos; nenhum dado pessoal é enviado.</li>
          <li><strong>Sentry:</strong> monitoramento de erros e performance — configurado com masking de texto e sem captura de PII.</li>
          <li><strong>Provedor SMTP:</strong> envio de e-mails transacionais (redefinição de senha, recibos de assinatura).</li>
        </ul>

        <h3 className="text-slate-900 font-bold text-base mb-2">6. Cookies e Armazenamento Local</h3>
        <p className="mb-4">
          Utilizamos exclusivamente <strong>cookies próprios e essenciais</strong> para o funcionamento da plataforma: token de sessão (<code>jwt</code>) e proteção contra CSRF (<code>csrfToken</code>). Não utilizamos cookies de rastreamento ou analytics de terceiros. Por serem estritamente necessários, não requerem consentimento, mas informamos sua existência por transparência (Art. 6º, VI).
        </p>

        <h3 className="text-slate-900 font-bold text-base mb-2">7. Prazo de Retenção</h3>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li><strong>Dados de conta:</strong> enquanto a conta estiver ativa e pelo prazo legal mínimo após o encerramento.</li>
          <li><strong>Logs de auditoria:</strong> 2 anos (segurança e prevenção a fraudes).</li>
          <li><strong>Tokens de sessão:</strong> 7 dias ou até revogação manual.</li>
          <li><strong>Dados financeiros (carteira, transações):</strong> conforme exigência legal fiscal e contábil vigente.</li>
          <li><strong>Sinais e análises de mercado:</strong> prazo técnico definido internamente, excluídos após expiração.</li>
        </ul>

        <h3 className="text-slate-900 font-bold text-base mb-2">8. Seus Direitos como Titular (Art. 18)</h3>
        <p className="mb-2">Você tem os seguintes direitos em relação aos seus dados pessoais:</p>
        <ul className="mb-4 text-sm list-disc pl-5 space-y-1">
          <li><strong>Acesso (inciso I):</strong> confirmar a existência e acessar seus dados.</li>
          <li><strong>Correção (inciso III):</strong> corrigir dados incompletos, inexatos ou desatualizados — disponível em "Meu Perfil".</li>
          <li><strong>Portabilidade (inciso V):</strong> receber seus dados em formato estruturado.</li>
          <li><strong>Eliminação (inciso VI):</strong> solicitar a exclusão dos dados tratados com consentimento.</li>
          <li><strong>Revogação do consentimento (inciso IX):</strong> retirar o consentimento a qualquer momento.</li>
          <li><strong>Informação sobre compartilhamento (inciso VII):</strong> saber com quem seus dados são compartilhados.</li>
        </ul>
        <p className="mb-4">Para exercer seus direitos, entre em contato com nosso Encarregado de Dados (seção abaixo).</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">9. Segurança dos Dados (Art. 46-49)</h3>
        <p className="mb-4">
          Adotamos medidas técnicas e organizacionais apropriadas: senhas com bcrypt (salt 10), MFA/2FA (TOTP), tokens JWT de curta duração, segredos MFA cifrados em repouso (AES-256-GCM), proteção CSRF, headers de segurança (Helmet/CSP/HSTS), CORS restrito, rate limiting por usuário e sanitização de entradas contra injeção.
        </p>

        <h3 className="text-slate-900 font-bold text-base mb-2">10. Alterações nesta Política</h3>
        <p className="mb-6">
          Podemos atualizar esta Política periodicamente. Em caso de alterações relevantes, notificaremos os usuários por e-mail ou aviso na plataforma. A versão vigente estará sempre disponível nesta página, com a data de atualização indicada no cabeçalho.
        </p>

        {/* Seção DPO — [02] Canal do Encarregado */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="text-blue-600 shrink-0" size={18} />
            <h3 className="text-slate-900 font-bold text-base m-0">Encarregado de Dados (DPO)</h3>
          </div>
          <p className="text-xs text-slate-700 mb-3">
            O Encarregado de Dados é responsável por receber e responder às requisições dos titulares relacionadas ao tratamento de dados pessoais, nos termos do Art. 41 da LGPD.
          </p>
          <p className="text-xs text-slate-700 mb-1"><strong>Encarregado:</strong> Matheus Ambrózio</p>
          <p className="text-xs text-slate-700 mb-3">
            <strong>E-mail:</strong>{' '}
            <a href="mailto:contato.verticeinvest@gmail.com" className="text-blue-600 hover:underline font-medium">
              contato.verticeinvest@gmail.com
            </a>
          </p>
          <p className="text-xs text-slate-500">
            Para exercer seus direitos ou esclarecer dúvidas sobre o tratamento de dados, envie um e-mail descrevendo sua solicitação. O prazo de resposta é de até 15 dias úteis.
          </p>
        </div>
      </div>

      <div className="mt-4 pt-6 border-t border-slate-100 text-center sticky bottom-0 bg-white/95 backdrop-blur-sm pb-2">
        <Link to="/register" className="inline-block px-6 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20">
            Voltar ao Cadastro
        </Link>
      </div>
    </div>
    </>
  );
};
