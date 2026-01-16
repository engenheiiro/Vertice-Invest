import nodemailer from 'nodemailer';

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
  const resetLink = `${origin}/#/reset-password?token=${token}`;

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
        <p style="font-size: 12px; color: #64748b;">Este link expira em 1 hora.</p>
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
    
    console.log("📨 Email enviado: %s", info.messageId);
    // Para Ethereal (teste), logamos a URL de preview
    if (process.env.SMTP_HOST?.includes('ethereal')) {
        console.log("🔗 Preview URL: %s", nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error("❌ Erro ao enviar email:", error);
    throw new Error("Falha no serviço de email.");
  }
};