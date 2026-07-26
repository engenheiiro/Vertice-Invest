import nodemailer from 'nodemailer';
import logger from '../config/logger.js'; // (M10) logger estruturado

const CLIENT_URL = process.env.CLIENT_URL || 'https://verticeinvest.com.br';

// Criação do transportador SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true para 465, false para outras portas
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendResetPasswordEmail = async (to, token, origin) => {
  const resetLink = `${origin}/reset-password?token=${token}`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
      <div style="background-color: #2563EB; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Vértice Invest</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #1e293b;">Recuperação de Senha</h2>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
        <p>Se você não solicitou isso, pode ignorar este email com segurança.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir Minha Senha</a>
        </div>
        <p style="font-size: 12px; color: #64748b;">Ou copie e cole este link no seu navegador:<br>${resetLink}</p>
        <p style="font-size: 12px; color: #64748b;">Este link expira em 30 minutos.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
        © ${new Date().getFullYear()} Vértice Invest. Todos os direitos reservados.
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Segurança Vértice" <${process.env.SMTP_FROM || 'security@verticeinvest.com'}>`,
      to,
      subject: "Redefinição de Senha - Vértice Invest",
      html: htmlContent,
    });
    
    logger.info('📨 E-mail de redefinição de senha enviado', { messageId: info.messageId });
    // Para Ethereal (teste), logamos a URL de preview
    if (process.env.SMTP_HOST?.includes('ethereal')) {
        logger.info('🔗 Preview do e-mail', { url: nodemailer.getTestMessageUrl(info) });
    }
  } catch (error) {
    logger.error('❌ Erro ao enviar e-mail de redefinição', { erro: error.message });
    throw new Error("Falha no serviço de email.");
  }
};

const PLAN_LABELS = {
  ESSENTIAL: 'Essential — R$ 39,90/mês',
  PRO: 'Pro — R$ 89,90/mês',
  ELITE: 'Elite — R$ 120,00/mês',
  BLACK: 'Black — R$ 299,00/mês',
};

const PLAN_FEATURES = {
  ESSENTIAL: ['Carteira & Brasil 10', 'Sinais Radar Alpha', 'Histórico de dividendos'],
  PRO: ['Tudo do Essential', 'Research STOCK/FII/Cripto', 'Radar Alpha & Aporte Inteligente'],
  ELITE: ['Tudo do Pro', 'Ativos Globais', 'Rebalanceamento com IA', 'Masterclass completa'],
  BLACK: ['Tudo do Elite', 'Concierge WhatsApp 24h', 'Carteira Private', 'Gestão Tributária (IR)'],
};

export const sendCheckoutConfirmationEmail = async (to, plan, validUntil) => {
  const planLabel = PLAN_LABELS[plan] || plan;
  const features = PLAN_FEATURES[plan] || [];
  const expiryDate = validUntil
    ? new Date(validUntil).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  const featureItems = features
    .map(f => `<li style="margin: 6px 0; color: #334155;">✅ ${f}</li>`)
    .join('');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); padding: 28px; text-align: center;">
        <h1 style="color: #60a5fa; margin: 0; font-size: 26px; letter-spacing: 1px;">Vértice Invest</h1>
        <p style="color: #94a3b8; margin: 6px 0 0; font-size: 14px;">Análise Quantitativa Institucional</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin-top: 0;">🎉 Plano ativado com sucesso!</h2>
        <p style="color: #475569;">Seu pagamento foi confirmado e o acesso ao plano <strong>${planLabel}</strong> está liberado.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px; font-weight: bold; color: #0f172a;">O que você tem acesso agora:</p>
          <ul style="margin: 0; padding-left: 0; list-style: none;">${featureItems}</ul>
          ${expiryDate ? `<p style="margin: 16px 0 0; font-size: 13px; color: #64748b;">Válido até: <strong>${expiryDate}</strong></p>` : ''}
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${CLIENT_URL}/dashboard" style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">Acessar o Dashboard →</a>
        </div>
        <p style="font-size: 13px; color: #94a3b8;">Dúvidas? Responda este email ou acesse seu <a href="${CLIENT_URL}/profile" style="color: #2563eb;">perfil</a> para gerenciar sua assinatura.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 18px; text-align: center; font-size: 12px; color: #94a3b8;">
        © ${new Date().getFullYear()} Vértice Invest. Todos os direitos reservados.
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Vértice Invest" <${process.env.SMTP_FROM || 'noreply@verticeinvest.com.br'}>`,
      to,
      subject: `✅ Seu plano ${plan} está ativo — Vértice Invest`,
      html: htmlContent,
    });

    // O logger do projeto não interpola %s (convenção: msg + {meta}), e o
    // destinatário fica de fora porque e-mail é PII.
    logger.info('📨 E-mail de ativação enviado', { plano: plan, messageId: info.messageId });
    if (process.env.SMTP_HOST?.includes('ethereal')) {
      logger.info('🔗 Preview do e-mail', { url: nodemailer.getTestMessageUrl(info) });
    }
  } catch (error) {
    logger.error('❌ Erro ao enviar e-mail de ativação', { plano: plan, erro: error.message });
    // Não propaga: falha de email não deve quebrar o fluxo de pagamento
  }
};

// --- E-MAILS DO CICLO DE VIDA DA ASSINATURA RECORRENTE ---

const formatDate = (date) => (date
  ? new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  : null);

const formatBRL = (value) => (typeof value === 'number'
  ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  : null);

/**
 * Envelope visual compartilhado por todos os e-mails transacionais de assinatura.
 * `accent` colore o cabeçalho conforme a natureza do aviso (positivo/alerta).
 */
const renderShell = ({ title, accent = '#2563eb', bodyHtml, ctaLabel, ctaPath = '/profile' }) => `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); padding: 28px; text-align: center;">
        <h1 style="color: #60a5fa; margin: 0; font-size: 26px; letter-spacing: 1px;">Vértice Invest</h1>
        <p style="color: #94a3b8; margin: 6px 0 0; font-size: 14px;">Análise Quantitativa Institucional</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="color: #1e293b; margin-top: 0;">${title}</h2>
        ${bodyHtml}
        ${ctaLabel ? `<div style="text-align: center; margin: 28px 0;">
          <a href="${CLIENT_URL}${ctaPath}" style="background: ${accent}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">${ctaLabel}</a>
        </div>` : ''}
        <p style="font-size: 13px; color: #94a3b8;">Gerencie sua assinatura a qualquer momento no seu <a href="${CLIENT_URL}/profile" style="color: #2563eb;">perfil</a>.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 18px; text-align: center; font-size: 12px; color: #94a3b8;">
        © ${new Date().getFullYear()} Vértice Invest. Todos os direitos reservados.
      </div>
    </div>
`;

// Nunca propaga: um SMTP fora do ar não pode derrubar o processamento de um webhook
// de pagamento nem impedir o usuário de ter o acesso liberado.
const sendSafely = async ({ to, subject, html, logLabel }) => {
  try {
    const info = await transporter.sendMail({
      from: `"Vértice Invest" <${process.env.SMTP_FROM || 'noreply@verticeinvest.com.br'}>`,
      to,
      subject,
      html,
    });
    // Convenção do projeto: logger.info(msg, {meta}) — o logger não interpola
    // %s. O destinatário fica de fora de propósito: e-mail é PII e não deve
    // aparecer em claro no log (mesmo critério do authMiddleware).
    logger.info('📨 E-mail de assinatura enviado', { tipo: logLabel, messageId: info.messageId });
    if (process.env.SMTP_HOST?.includes('ethereal')) {
      logger.info('🔗 Preview do e-mail', { url: nodemailer.getTestMessageUrl(info) });
    }
  } catch (error) {
    logger.error('❌ Falha ao enviar e-mail de assinatura', { tipo: logLabel, erro: error.message });
  }
};

export const sendSubscriptionCreatedEmail = async (to, plan, nextBillingDate) => {
  const nextDate = formatDate(nextBillingDate);
  const features = (PLAN_FEATURES[plan] || [])
    .map(f => `<li style="margin: 6px 0; color: #334155;">✅ ${f}</li>`)
    .join('');

  await sendSafely({
    to,
    subject: `🔁 Assinatura ${plan} ativada — Vértice Invest`,
    logLabel: 'assinatura criada',
    html: renderShell({
      title: '🎉 Assinatura ativada!',
      ctaLabel: 'Acessar o Dashboard →',
      ctaPath: '/dashboard',
      bodyHtml: `
        <p style="color: #475569;">Seu cartão foi cadastrado e o plano <strong>${PLAN_LABELS[plan] || plan}</strong> está liberado.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px; font-weight: bold; color: #0f172a;">O que você tem acesso agora:</p>
          <ul style="margin: 0; padding-left: 0; list-style: none;">${features}</ul>
          ${nextDate ? `<p style="margin: 16px 0 0; font-size: 13px; color: #64748b;">Próxima cobrança automática: <strong>${nextDate}</strong></p>` : ''}
        </div>
        <p style="font-size: 13px; color: #64748b;">A renovação é automática. Você pode cancelar quando quiser pelo perfil — o acesso continua até o fim do período já pago.</p>
      `,
    }),
  });
};

export const sendRenewalReceiptEmail = async (to, plan, nextBillingDate, amount) => {
  const nextDate = formatDate(nextBillingDate);
  const value = formatBRL(amount);

  await sendSafely({
    to,
    subject: `Recibo da renovação — Vértice ${plan}`,
    logLabel: 'recibo de renovação',
    html: renderShell({
      title: '✅ Assinatura renovada',
      ctaLabel: 'Ver minha assinatura →',
      bodyHtml: `
        <p style="color: #475569;">Sua assinatura <strong>${PLAN_LABELS[plan] || plan}</strong> foi renovada automaticamente.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
          ${value ? `<p style="margin: 0 0 8px; color: #334155;">Valor cobrado: <strong>${value}</strong></p>` : ''}
          ${nextDate ? `<p style="margin: 0; color: #334155;">Próxima cobrança: <strong>${nextDate}</strong></p>` : ''}
        </div>
      `,
    }),
  });
};

export const sendPaymentFailedEmail = async (to, plan, accessUntil) => {
  const untilDate = formatDate(accessUntil);

  await sendSafely({
    to,
    subject: `⚠️ Não conseguimos renovar sua assinatura — Vértice Invest`,
    logLabel: 'falha de cobrança',
    html: renderShell({
      title: '⚠️ Cobrança não aprovada',
      accent: '#dc2626',
      ctaLabel: 'Atualizar forma de pagamento →',
      ctaPath: '/pricing',
      bodyHtml: `
        <p style="color: #475569;">A cobrança da sua assinatura <strong>${PLAN_LABELS[plan] || plan}</strong> não foi aprovada pelo seu banco.</p>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0; color: #991b1b;">O Mercado Pago vai tentar novamente nos próximos dias. Se preferir não esperar, atualize o cartão agora.</p>
          ${untilDate ? `<p style="margin: 12px 0 0; font-size: 13px; color: #7f1d1d;">Seu acesso segue ativo até <strong>${untilDate}</strong>.</p>` : ''}
        </div>
      `,
    }),
  });
};

export const sendSubscriptionCanceledEmail = async (to, plan, accessUntil) => {
  const untilDate = formatDate(accessUntil);

  await sendSafely({
    to,
    subject: `Assinatura cancelada — Vértice Invest`,
    logLabel: 'cancelamento',
    html: renderShell({
      title: 'Assinatura cancelada',
      ctaLabel: 'Reativar assinatura →',
      ctaPath: '/pricing',
      bodyHtml: `
        <p style="color: #475569;">Sua assinatura <strong>${PLAN_LABELS[plan] || plan}</strong> foi cancelada e não haverá novas cobranças.</p>
        ${untilDate ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0; color: #334155;">Você continua com acesso completo até <strong>${untilDate}</strong> — o período já pago é seu.</p>
        </div>` : ''}
        <p style="font-size: 13px; color: #64748b;">Se foi engano, é só reativar. Seus dados e sua carteira continuam intactos.</p>
      `,
    }),
  });
};
