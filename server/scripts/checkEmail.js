/**
 * DIAGNÓSTICO DO CANAL DE E-MAIL — não envia nada por padrão.
 *
 * Existe porque o e-mail é a única dependência do sistema que falha em silêncio
 * absoluto: quem não recebe o link de recuperação de senha não tem como avisar
 * que não recebeu — o e-mail ERA o canal de aviso. Sem um comando para perguntar
 * "o canal está de pé?", a resposta só chega pelo cliente que some.
 *
 * O primeiro defeito real encontrado por aqui não estava no servidor de e-mail:
 * estava no arquivo `.env`. A senha tinha um `#` no meio e não estava entre
 * aspas, e o dotenv trata `#` como início de comentário — o sistema autenticava
 * com um pedaço da senha e levava `535 Authentication failed` com a credencial
 * CERTA no arquivo. Por isso a primeira checagem abaixo é do arquivo, não da
 * rede: erro de leitura se disfarça de erro de servidor.
 *
 * Uso:
 *   npm run check:email                      → só o handshake (não envia nada)
 *   npm run check:email -- voce@exemplo.com  → envia UM e-mail de teste
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../.env');

dotenv.config({ path: ENV_PATH });

const VERDE = '\x1b[32m';
const VERMELHO = '\x1b[31m';
const AMARELO = '\x1b[33m';
const CINZA = '\x1b[90m';
const RESET = '\x1b[0m';

const ok = (msg) => console.log(`${VERDE}  OK${RESET}   ${msg}`);
const erro = (msg) => console.log(`${VERMELHO}  ERRO${RESET} ${msg}`);
const aviso = (msg) => console.log(`${AMARELO}  ATENÇÃO${RESET} ${msg}`);

/**
 * Compara o que o dotenv entregou com a linha crua do arquivo.
 *
 * Só isso separa "a senha está errada" de "a senha está certa e foi lida pela
 * metade" — dois problemas com a mesma mensagem de erro do servidor e conserto
 * completamente diferente.
 */
const conferirArquivo = () => {
    if (!fs.existsSync(ENV_PATH)) {
        aviso('Não achei o arquivo .env — em produção (Render) isso é o normal: as variáveis vêm do painel.');
        return;
    }

    const linhas = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);

    for (const chave of ['SMTP_PASS', 'SMTP_USER']) {
        const linha = linhas.find((l) => l.startsWith(`${chave}=`));
        if (!linha) continue;

        const bruto = linha.slice(chave.length + 1).trim();
        const semAspas = bruto.replace(/^["']|["']$/g, '');
        const lido = process.env[chave] ?? '';

        if (lido.length !== semAspas.length) {
            erro(`${chave}: o arquivo tem ${semAspas.length} caracteres, mas o sistema leu ${lido.length}.`);
            if (semAspas.includes('#') && bruto === semAspas) {
                console.log(`${CINZA}         O valor tem "#" e não está entre aspas — o leitor do .env corta ali,`);
                console.log(`         achando que é comentário. Conserto: ${chave}="valor completo"${RESET}`);
            }
        } else {
            ok(`${chave} foi lido inteiro (${lido.length} caracteres).`);
        }
    }
};

const conferirVariaveis = () => {
    const faltando = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']
        .filter((k) => !process.env[k]);

    if (faltando.length) {
        erro(`Faltam variáveis no ambiente: ${faltando.join(', ')}`);
        return false;
    }
    ok(`Servidor de e-mail configurado: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} como ${process.env.SMTP_USER}`);
    return true;
};

const criarTransporte = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const main = async () => {
    const destino = process.argv[2];

    console.log('\n── Diagnóstico do e-mail ──────────────────────────────────\n');

    conferirArquivo();
    if (!conferirVariaveis()) {
        console.log('\nSem as variáveis não dá para testar. Preencha o .env (ou o painel do Render) e rode de novo.\n');
        process.exit(1);
    }

    const transporte = criarTransporte();

    try {
        await transporte.verify();
        ok('O servidor de e-mail aceitou nossa senha. O canal está de pé.');
    } catch (e) {
        erro(`O servidor de e-mail recusou: ${e.message}`);
        console.log(`${CINZA}         "535" = usuário ou senha não conferem.`);
        console.log(`         "ENOTFOUND"/"ETIMEDOUT" = não chegamos no servidor (endereço, porta ou rede).${RESET}\n`);
        process.exit(1);
    }

    if (!destino) {
        console.log(`\n${CINZA}Nenhuma mensagem foi enviada. Para enviar um teste de verdade:`);
        console.log(`  npm run check:email -- seu@email.com${RESET}\n`);
        return;
    }

    // O envio é explícito, nunca automático: este comando roda com as credenciais
    // reais e um teste disparado sem querer sai do domínio da empresa.
    try {
        const info = await transporte.sendMail({
            from: `"Vértice Invest" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: destino,
            subject: 'Teste de envio — Vértice Invest',
            text: 'Se você está lendo isto, o envio de e-mails da Vértice está funcionando.',
        });
        ok(`Mensagem aceita para entrega em ${destino} (id ${info.messageId}).`);
        console.log(`${CINZA}         Aceita ≠ entregue: confira a caixa de entrada e o spam.${RESET}\n`);
    } catch (e) {
        erro(`O envio falhou: ${e.message}`);
        process.exit(1);
    }
};

main().catch((e) => {
    erro(e.message);
    process.exit(1);
});
