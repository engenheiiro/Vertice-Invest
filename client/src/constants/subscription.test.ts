import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ANNUAL_INSTALLMENTS,
    FEATURE_LIMITS,
    PLAN_DETAILS,
    PLAN_HIERARCHY,
    annualSavingsPercent,
    checkoutKeyFor,
} from './subscription';

// O preço mora em dois lugares por necessidade: o servidor manda o valor para o
// Mercado Pago, o cliente mostra o valor na vitrine. Eles precisam concordar — uma
// tabela que promete R$ 69,90 e cobra R$ 89,90 é problema comercial e jurídico.
// Ler o arquivo do backend como TEXTO (em vez de importar) evita acoplar o build do
// client ao do server: o teste falha na divergência, não na configuração.
// O cwd é client/ quando o vitest roda pelo pacote e a raiz quando roda pelo monorepo.
const serverConfigPath = ['../server/config/subscription.js', 'server/config/subscription.js']
    .map((caminho) => resolve(process.cwd(), caminho))
    .find(existsSync);
const serverConfig = readFileSync(String(serverConfigPath), 'utf8');

/** Formata como a vitrine escreve: milhar com ponto, centavos com vírgula. */
const comoNaVitrine = (valor: number) =>
    valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Lê PLAN_CATALOG do backend: preço mensal e total anual por plano. */
const parseServerPrices = () => {
    const bloco = serverConfig.slice(serverConfig.indexOf('export const PLAN_CATALOG'));
    const precos = new Map<string, { monthly: string; annual: string | null }>();
    const linha = /'([A-Z_]+)':\s*\{\s*title:\s*'[^']*',\s*monthly:\s*([\d.]+),\s*annual:\s*([\d.]+|null)\s*\}/g;
    for (const [, plano, mensal, anual] of bloco.matchAll(linha)) {
        precos.set(plano, {
            monthly: comoNaVitrine(Number(mensal)),
            annual: anual === 'null' ? null : comoNaVitrine(Number(anual)),
        });
    }
    return precos;
};

/** Lê um bloco numérico de LIMITS_CONFIG do backend (ex.: 'wallets'). */
const parseServerLimit = (feature: string) => {
    const inicio = serverConfig.indexOf(`'${feature}': {`);
    if (inicio < 0) return null;
    const bloco = serverConfig.slice(inicio, serverConfig.indexOf('}', inicio));
    const limites: Record<string, number> = {};
    for (const [, plano, valor] of bloco.matchAll(/'([A-Z_]+)':\s*(\d+)/g)) {
        limites[plano] = Number(valor);
    }
    return limites;
};

describe('PLAN_DETAILS — espelho do preço cobrado pelo servidor', () => {
    it('encontra a tabela de preços do backend', () => {
        expect([...parseServerPrices().keys()]).toEqual(['ESSENTIAL', 'PRO', 'ELITE', 'BLACK']);
    });

    it('mostra na vitrine exatamente o preço mensal que o servidor cobra', () => {
        for (const [plano, { monthly }] of parseServerPrices()) {
            expect(
                PLAN_DETAILS[plano as keyof typeof PLAN_DETAILS].price,
                `${plano}: a vitrine e o checkout precisam mostrar o mesmo valor`,
            ).toBe(monthly);
        }
    });

    // O anual anuncia dois números: o total cobrado e a parcela. Se a parcela não
    // for exatamente o total ÷ 12, o card promete um preço que a fatura desmente.
    it('mostra o total anual do servidor e uma parcela que fecha em 12×', () => {
        for (const [plano, { annual }] of parseServerPrices()) {
            const vitrine = PLAN_DETAILS[plano as keyof typeof PLAN_DETAILS];

            if (annual === null) {
                expect(vitrine.annualPrice, `${plano} não tem anual no servidor`).toBeUndefined();
                continue;
            }

            expect(vitrine.annualPrice, `${plano}: total anual divergente`).toBe(annual);
            const parcela = Number(String(vitrine.annualMonthly).replace(',', '.'));
            const total = Number(annual.replace(/\./g, '').replace(',', '.'));
            expect(parcela * ANNUAL_INSTALLMENTS, `${plano}: 12× da parcela não fecha o total`).toBeCloseTo(total, 2);
        }
    });

    it('anuncia economia real no anual — desconto, não a mesma conta reembalada', () => {
        for (const plano of ['ESSENTIAL', 'PRO', 'ELITE'] as const) {
            expect(annualSavingsPercent(plano)).toBeGreaterThan(0);
        }
        // Free e Black não são vendidos no anual, então não têm o que economizar.
        expect(annualSavingsPercent('GUEST')).toBeNull();
        expect(annualSavingsPercent('BLACK')).toBeNull();
    });

    it('monta a chave de checkout do ciclo escolhido', () => {
        expect(checkoutKeyFor('PRO', 'MONTHLY')).toBe('PRO');
        expect(checkoutKeyFor('PRO', 'ANNUAL')).toBe('PRO_ANNUAL');
    });

    it('mantém o Free fora da cobrança', () => {
        expect(PLAN_DETAILS.GUEST.price).toBe('0,00');
        expect(parseServerPrices().has('GUEST')).toBe(false);
    });
});

// Os tetos de carteira e de meta (Onda 3) também vivem em dois lugares: o
// servidor barra a criação, o cliente decide se ainda oferece o botão. Divergir
// dá o pior dos mundos — oferecer o que vai falhar, ou esconder o que passaria.
describe('FEATURE_LIMITS — espelho dos tetos aplicados pelo servidor', () => {
    it.each(['wallets', 'goals'])('%s tem os mesmos números nos dois lados', (feature) => {
        const servidor = parseServerLimit(feature);

        expect(servidor, `LIMITS_CONFIG.${feature} sumiu do backend`).not.toBeNull();
        expect(FEATURE_LIMITS[feature]).toEqual(servidor);
    });

    it('a hierarquia do cliente cobre todos os planos do servidor, na mesma ordem', () => {
        const planosDoServidor = Object.keys(parseServerLimit('wallets') ?? {});

        expect(Object.keys(PLAN_HIERARCHY)).toEqual(planosDoServidor);
        const niveis = planosDoServidor.map((plano) => PLAN_HIERARCHY[plano as keyof typeof PLAN_HIERARCHY]);
        expect(niveis).toEqual([...niveis].sort((a, b) => a - b));
    });
});
