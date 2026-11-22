/**
 * E-mails transacionais: o que vai no corpo e o que acontece quando o SMTP cai.
 *
 * O transporte é SEMPRE falso (nodemailer mockado): nenhum e-mail sai daqui.
 * Contratos travados: reset de senha propaga a falha (a tela precisa saber),
 * os e-mails de assinatura e suporte nunca propagam (webhook não pode cair por
 * SMTP), o corpo do suporte é escapado e cortado, e o log não carrega o
 * destinatário (PII).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const t = vi.hoisted(() => ({
    sendMail: vi.fn(),
    verify: vi.fn(),
    previewUrl: vi.fn(() => 'https://ethereal.example/preview'),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('nodemailer', () => ({
    default: {
        createTransport: () => ({ sendMail: t.sendMail, verify: t.verify }),
        getTestMessageUrl: t.previewUrl,
    },
}));
vi.mock('../config/logger.js', () => ({ default: t.log }));

const email = await import('../services/emailService.js');

const DEST = 'cliente@example.test';
const ultimoEnvio = () => t.sendMail.mock.calls.at(-1)[0];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    t.sendMail.mockReset().mockResolvedValue({ messageId: 'msg-1' });
    t.verify.mockReset();
    t.previewUrl.mockClear();
    Object.values(t.log).forEach((f) => f.mockClear());
    vi.stubEnv('SMTP_HOST', 'smtp.fake.test');
    vi.stubEnv('SMTP_USER', 'usuario-falso');
    vi.stubEnv('SMTP_PASS', 'senha-falsa');
    vi.stubEnv('SMTP_FROM', '');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('verifyEmailTransport', () => {
    it('sem credencial no ambiente não tenta conectar', async () => {
        vi.stubEnv('SMTP_PASS', '');
        const r = await email.verifyEmailTransport();
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/ausente/);
        expect(t.verify).not.toHaveBeenCalled();
    });

    it('handshake aceito é ok, recusado devolve a mensagem sem lançar', async () => {
        t.verify.mockResolvedValueOnce(true);
        expect(await email.verifyEmailTransport()).toEqual({ ok: true, error: null, host: 'smtp.fake.test' });

        t.verify.mockRejectedValueOnce(new Error('535 auth failed'));
        expect(await email.verifyEmailTransport()).toEqual({ ok: false, error: '535 auth failed', host: 'smtp.fake.test' });

        t.verify.mockRejectedValueOnce(new Error(''));
        expect((await email.verifyEmailTransport()).error).toBe('falha desconhecida');
    });

    it('SMTP que nunca responde estoura o teto e vira falha', async () => {
        t.verify.mockReturnValue(new Promise(() => {}));
        const r = await email.verifyEmailTransport({ timeoutMs: 5 });
        expect(r).toMatchObject({ ok: false, error: 'tempo esgotado no handshake' });
    });
});

describe('sendResetPasswordEmail', () => {
    it('manda o link com o token para a origem pedida', async () => {
        await email.sendResetPasswordEmail(DEST, 'tok123', 'https://app.example.test');
        const msg = ultimoEnvio();
        expect(msg.to).toBe(DEST);
        expect(msg.subject).toContain('Redefinição de Senha');
        expect(msg.html).toContain('https://app.example.test/reset-password?token=tok123');
        expect(msg.html).toContain('© 2026 Vértice Invest');
        expect(msg.from).toContain('security@verticeinvest.com');
    });

    it('falha do SMTP propaga como erro genérico (sem detalhe do servidor)', async () => {
        t.sendMail.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1'));
        await expect(email.sendResetPasswordEmail(DEST, 't', 'https://x.test')).rejects.toThrow('Falha no serviço de email.');
        expect(t.log.error).toHaveBeenCalled();
    });

    it('no Ethereal registra a URL de preview', async () => {
        vi.stubEnv('SMTP_HOST', 'smtp.ethereal.email');
        await email.sendResetPasswordEmail(DEST, 't', 'https://x.test');
        expect(t.previewUrl).toHaveBeenCalledWith({ messageId: 'msg-1' });
    });
});

describe('sendCheckoutConfirmationEmail', () => {
    it('recibo usa o rótulo do catálogo, lista os benefícios e a validade', async () => {
        await email.sendCheckoutConfirmationEmail(DEST, 'PRO', '2026-12-22T12:00:00Z');
        const msg = ultimoEnvio();
        expect(msg.subject).toBe('✅ Seu plano PRO está ativo — Vértice Invest');
        expect(msg.html).toContain(email.planLabelFor('PRO'));
        for (const f of email.featuresFor('PRO')) expect(msg.html).toContain(f);
        expect(msg.html).toContain('Válido até:');
        expect(msg.html).toContain('dezembro de 2026');
    });

    it('anual sai como cobrança de 12 meses; sem validade não imprime a linha', async () => {
        await email.sendCheckoutConfirmationEmail(DEST, 'PRO', null, { cycle: 'ANNUAL' });
        const msg = ultimoEnvio();
        expect(msg.html).toContain(email.planLabelFor('PRO', 'ANNUAL'));
        expect(msg.html).not.toContain('Válido até:');
    });

    it('falha de SMTP não quebra o fluxo de pagamento e o log não leva o e-mail', async () => {
        t.sendMail.mockRejectedValue(new Error('down'));
        await expect(email.sendCheckoutConfirmationEmail(DEST, 'ELITE', null)).resolves.toBeUndefined();
        expect(JSON.stringify(t.log.error.mock.calls)).not.toContain(DEST);
    });
});

describe('ciclo de vida da assinatura recorrente', () => {
    it('assinatura criada: próxima cobrança e link para o dashboard', async () => {
        await email.sendSubscriptionCreatedEmail(DEST, 'ELITE', '2026-12-22T12:00:00Z');
        const { subject, html } = ultimoEnvio();
        expect(subject).toBe('🔁 Assinatura ELITE ativada — Vértice Invest');
        expect(html).toContain('Próxima cobrança automática');
        expect(html).toMatch(/href="[^"]+\/dashboard"/);
        expect(t.log.info).toHaveBeenCalledWith(expect.any(String), { tipo: 'assinatura criada', messageId: 'msg-1' });
    });

    it('recibo de renovação mostra valor em reais só quando é número', async () => {
        await email.sendRenewalReceiptEmail(DEST, 'PRO', '2026-12-22T12:00:00Z', 69.9);
        expect(ultimoEnvio().html).toMatch(/Valor cobrado: <strong>R\$\s69,90<\/strong>/);

        await email.sendRenewalReceiptEmail(DEST, 'PRO', null, '69.90');
        const html = ultimoEnvio().html;
        expect(html).not.toContain('Valor cobrado');
        expect(html).not.toContain('Próxima cobrança');
    });

    it('falha de cobrança: cabeçalho vermelho, link para /pricing e até quando o acesso vale', async () => {
        await email.sendPaymentFailedEmail(DEST, 'PRO', '2026-11-30T12:00:00Z');
        const { subject, html } = ultimoEnvio();
        expect(subject).toContain('Não conseguimos renovar');
        expect(html).toContain('background: #dc2626');
        expect(html).toMatch(/href="[^"]+\/pricing"/);
        expect(html).toContain('Seu acesso segue ativo até');
    });

    it('cancelamento: com e sem data de acesso restante', async () => {
        await email.sendSubscriptionCanceledEmail(DEST, 'PRO', '2026-12-01T12:00:00Z');
        expect(ultimoEnvio().html).toContain('Você continua com acesso completo até');
        await email.sendSubscriptionCanceledEmail(DEST, 'PRO', null);
        expect(ultimoEnvio().html).not.toContain('Você continua com acesso completo até');
    });

    it('SMTP fora do ar nunca propaga e registra o tipo do e-mail', async () => {
        t.sendMail.mockRejectedValue(new Error('down'));
        await expect(email.sendPaymentFailedEmail(DEST, 'PRO', null)).resolves.toBeUndefined();
        expect(t.log.error).toHaveBeenCalledWith(expect.any(String), { tipo: 'falha de cobrança', erro: 'down' });
    });

    it('no Ethereal registra a URL de preview também aqui', async () => {
        vi.stubEnv('SMTP_HOST', 'smtp.ethereal.email');
        await email.sendSubscriptionCanceledEmail(DEST, 'PRO', null);
        expect(t.previewUrl).toHaveBeenCalled();
    });
});

describe('sendSupportReplyEmail', () => {
    it('escapa HTML do texto, troca quebra de linha por <br> e linka o ticket', async () => {
        await email.sendSupportReplyEmail({
            to: DEST, name: 'Ana <b>', code: 'VT-0042', subject: 'P/L "errado"', body: 'Se o P/L for < 10 & ROE > 5\nok',
        });
        const { subject, html } = ultimoEnvio();
        expect(subject).toBe('Resposta do suporte · VT-0042 — Vértice Invest');
        expect(html).toContain('Ana &lt;b&gt;');
        expect(html).toContain('P/L &quot;errado&quot;');
        expect(html).toContain('Se o P/L for &lt; 10 &amp; ROE &gt; 5<br>ok');
        expect(html).toContain('/suporte?ticket=VT-0042');
        expect(html).not.toContain('[...]');
    });

    it('corpo longo vai só em trecho de 400 caracteres, marcado como cortado; sem nome não saúda', async () => {
        await email.sendSupportReplyEmail({ to: DEST, code: 'VT-1', subject: 's', body: 'a'.repeat(450) + 'FIM' });
        const { html } = ultimoEnvio();
        expect(html).toContain('a'.repeat(400));
        expect(html).not.toContain('a'.repeat(401));
        expect(html).not.toContain('FIM');
        expect(html).toContain('[...]');
        expect(html).toContain('Olá — o suporte respondeu');
    });
});
