/**
 * Aba "Saúde" do Admin.
 *
 * O que importa provar aqui não é layout, é a REGRA DE LEITURA da tela: um
 * problema tem que estar visível sem clique, e a explicação de onde olhar tem que
 * vir junto. Um painel que esconde a falha atrás de um accordion não avisa nada.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AdminSaudeTab } from './AdminSaudeTab';
import type { DataHealthResponse } from '../../services/health';

const getDataHealth = vi.fn();
const listErrors = vi.fn();
const runNow = vi.fn();
const resolveError = vi.fn();

vi.mock('../../services/health', () => ({
    healthService: {
        getDataHealth: (...a: unknown[]) => getDataHealth(...a),
        listErrors: (...a: unknown[]) => listErrors(...a),
        runNow: (...a: unknown[]) => runNow(...a),
        resolveError: (...a: unknown[]) => resolveError(...a),
    },
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../components/admin/PerformanceOverview', () => ({
    PerformanceOverview: () => <div data-testid="performance-overview" />,
}));

const mkResponse = (over: Partial<DataHealthResponse> = {}): DataHealthResponse => ({
    report: {
        runAt: new Date().toISOString(),
        status: 'OK',
        summary: { ok: 2, warn: 0, critical: 0 },
        trigger: 'CRON',
        checks: [
            {
                id: 'macro.value.selic', label: 'SELIC', category: 'MACRO',
                status: 'OK', value: 12.43, detail: '12.43 %', hint: 'dica macro',
            },
            {
                id: 'jobs.quotes-sync', label: 'Cotações', category: 'ROTINAS',
                status: 'OK', value: 0.3, detail: 'Última execução há 0.3h', hint: 'dica cron',
            },
        ],
    },
    history: [],
    jobs: [{
        jobId: 'quotes-sync', label: 'Cotações em tempo real', severity: 'CRITICAL',
        maxSilenceHours: 2, monitored: true, lastRunAt: new Date().toISOString(),
        lastStatus: 'SUCCESS', lastError: null, lastDurationMs: 900,
        runs24h: 96, failures24h: 0,
    }],
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listErrors.mockResolvedValue({ errors: [], unresolvedCount: 0 });
});

describe('veredito global', () => {
    it('mostra "Tudo certo" quando nada está quebrado', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        render(<AdminSaudeTab />);
        expect(await screen.findByText('Tudo certo')).toBeInTheDocument();
    });

    it('mostra estado crítico e o contador de falhas', async () => {
        getDataHealth.mockResolvedValue(mkResponse({
            report: {
                runAt: new Date().toISOString(),
                status: 'CRITICAL',
                summary: { ok: 0, warn: 1, critical: 2 },
                checks: [{
                    id: 'coverage.FII.dy', label: 'Dividend Yield ausente — FII', category: 'COBERTURA',
                    status: 'CRITICAL', value: 0.66, detail: '200/300 ativos sem Dividend Yield',
                    hint: 'Origem: scraping do Fundamentus',
                }],
            },
        }));
        render(<AdminSaudeTab />);
        // O veredito é o título; "Crítico" também rotula o contador do resumo.
        expect(await screen.findByRole('heading', { name: 'Crítico' })).toBeInTheDocument();
        expect(screen.getByText(/Precisa de atenção \(1\)/)).toBeInTheDocument();
    });
});

describe('regra de leitura', () => {
    it('check quebrado aparece sem precisar expandir nada', async () => {
        getDataHealth.mockResolvedValue(mkResponse({
            report: {
                runAt: new Date().toISOString(),
                status: 'CRITICAL',
                summary: { ok: 1, warn: 0, critical: 1 },
                checks: [
                    {
                        id: 'freshness.treasury', label: 'PU do Tesouro Direto', category: 'FRESCOR',
                        status: 'CRITICAL', value: null, detail: 'Nenhuma série de PU encontrada',
                        hint: 'treasuryPriceService. Sem PU recente a RF cai para accrual.',
                    },
                    {
                        id: 'macro.value.selic', label: 'SELIC', category: 'MACRO',
                        status: 'OK', value: 12.43, detail: '12.43 %', hint: 'dica',
                    },
                ],
            },
        }));
        render(<AdminSaudeTab />);
        expect(await screen.findByText('PU do Tesouro Direto')).toBeInTheDocument();
        expect(screen.getByText(/Precisa de atenção \(1\)/)).toBeInTheDocument();
        // A dica de onde consertar vem junto com a falha, não escondida.
        expect(screen.getByText(/treasuryPriceService/)).toBeInTheDocument();
    });

    // O catálogo do Tesouro publica CONTAGEM de defeitos, não fração do universo
    // como os outros checks de plausibilidade — 4 duplicatas não são "400,0%".
    it('defeito do catálogo do Tesouro aparece nomeado e sem virar porcentagem', async () => {
        getDataHealth.mockResolvedValue(mkResponse({
            report: {
                runAt: new Date().toISOString(),
                status: 'CRITICAL',
                summary: { ok: 0, warn: 0, critical: 1 },
                checks: [
                    {
                        id: 'plausibility.treasuryCatalog', label: 'Catálogo do Tesouro Direto',
                        category: 'PLAUSIBILIDADE', status: 'CRITICAL', value: 4,
                        detail: '4 duplicata(s): Tesouro IPCA+ 2037 Juros Semestrais',
                        hint: 'macroDataService.updateTreasuryRates. Duplicata = a fonte remarcou o nome.',
                    },
                ],
            },
        }));
        render(<AdminSaudeTab />);
        expect(await screen.findByText('Catálogo do Tesouro Direto')).toBeInTheDocument();
        expect(screen.getByText(/4 duplicata\(s\)/)).toBeInTheDocument();
        expect(screen.queryByText('400.0%')).not.toBeInTheDocument();
        expect(screen.getByText(/updateTreasuryRates/)).toBeInTheDocument();
    });

    it('carteira degradada aparece nomeada, com quais buscas caíram', async () => {
        // O formato é o que `dataHealthRules.walletPayloadCheck` emite no servidor.
        // O painel renderiza checks genericamente, então o valor deste teste é
        // garantir que o aviso CHEGA na tela — o dono não lê log, e foi por isso
        // que a carteira rodou degradada em 02/09/2026 sem ninguém notar.
        getDataHealth.mockResolvedValue(mkResponse({
            report: {
                runAt: new Date().toISOString(),
                status: 'CRITICAL',
                summary: { ok: 0, warn: 0, critical: 1 },
                checks: [
                    {
                        id: 'wallet.payloadDegraded24h', label: 'Carteiras com dados incompletos (24h)',
                        category: 'ERROS', status: 'CRITICAL', value: 42,
                        detail: '42 carteira(s) montada(s) sem dados completos: snapshots (30), treasuryPricing (12)',
                        hint: 'A busca nomeada falhou e o payload caiu no padrão — TWRR e marcação da RF ficam degradados.',
                    },
                ],
            },
        }));
        render(<AdminSaudeTab />);

        expect(await screen.findByText('Carteiras com dados incompletos (24h)')).toBeInTheDocument();
        // O endereço do conserto tem de estar visível sem expandir nada.
        expect(screen.getByText(/snapshots \(30\)/)).toBeInTheDocument();
        expect(screen.getByText(/treasuryPricing \(12\)/)).toBeInTheDocument();
        expect(screen.getByText(/TWRR e marcação da RF/)).toBeInTheDocument();
    });

    it('checks saudáveis ficam recolhidos até o clique', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        render(<AdminSaudeTab />);
        await screen.findByText('Tudo certo');
        expect(screen.queryByText('SELIC')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText(/Verificações saudáveis \(2\)/));
        expect(await screen.findByText('SELIC')).toBeInTheDocument();
    });
});

describe('rotinas', () => {
    it('lista cron com última execução e contagem de 24h', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        render(<AdminSaudeTab />);
        expect(await screen.findByText('Cotações em tempo real')).toBeInTheDocument();
        expect(screen.getByText(/96× \/ 24h/)).toBeInTheDocument();
    });

    it('cron que nunca rodou é marcado como problema, não como neutro', async () => {
        getDataHealth.mockResolvedValue(mkResponse({
            jobs: [{
                jobId: 'daily-snapshot', label: 'Snapshot patrimonial', severity: 'CRITICAL',
                maxSilenceHours: 30, monitored: true, lastRunAt: null, lastStatus: null,
                lastError: null, lastDurationMs: null, runs24h: 0, failures24h: 0,
            }],
        }));
        render(<AdminSaudeTab />);
        const row = (await screen.findByText('Snapshot patrimonial')).closest('tr')!;
        expect(within(row).getByText('nunca')).toBeInTheDocument();
        expect(within(row).getByText('CRITICAL')).toBeInTheDocument();
    });

    it('job sob demanda não é cobrado por silêncio', async () => {
        getDataHealth.mockResolvedValue(mkResponse({
            jobs: [{
                jobId: 'full-sync', label: 'Sync completo', severity: 'WARN',
                maxSilenceHours: null, monitored: false,
                lastRunAt: new Date(Date.now() - 10 * 86400000).toISOString(),
                lastStatus: 'SUCCESS', lastError: null, lastDurationMs: 5000,
                runs24h: 0, failures24h: 0,
            }],
        }));
        render(<AdminSaudeTab />);
        // Escopado na linha da rotina: "OK" também aparece no contador do resumo.
        const row = (await screen.findByText('Sync completo')).closest('tr')!;
        expect(within(row).getByText('sob demanda')).toBeInTheDocument();
        expect(within(row).getByText('OK')).toBeInTheDocument();
    });
});

describe('erros do backend', () => {
    it('agrupa ocorrências mostrando o contador', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        listErrors.mockResolvedValue({
            errors: [{
                _id: 'e1', origin: 'JOB', source: 'quotes-sync', code: 'ETIMEDOUT',
                message: 'Timeout no Yahoo Finance', stack: 'Error: timeout\n at x',
                statusCode: null, count: 42,
                firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
                resolvedAt: null,
            }],
            unresolvedCount: 1,
        });
        render(<AdminSaudeTab />);
        expect(await screen.findByText('Timeout no Yahoo Finance')).toBeInTheDocument();
        expect(screen.getByText('42×')).toBeInTheDocument();
    });

    it('marcar como tratado remove o erro da lista', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        listErrors.mockResolvedValue({
            errors: [{
                _id: 'e1', origin: 'HTTP', source: 'GET /api/wallet', code: 'INTERNAL_ERROR',
                message: 'boom', stack: null, statusCode: 500, count: 1,
                firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
                resolvedAt: null,
            }],
            unresolvedCount: 1,
        });
        resolveError.mockResolvedValue(undefined);
        render(<AdminSaudeTab />);

        fireEvent.click(await screen.findByText('boom'));
        fireEvent.click(await screen.findByText('Marcar como tratado'));

        await waitFor(() => expect(resolveError).toHaveBeenCalledWith('e1'));
        await waitFor(() => expect(screen.queryByText('boom')).not.toBeInTheDocument());
    });

    it('sem erros pendentes mostra estado limpo', async () => {
        getDataHealth.mockResolvedValue(mkResponse());
        render(<AdminSaudeTab />);
        expect(await screen.findByText(/Nenhum erro pendente/)).toBeInTheDocument();
    });
});

describe('primeira execução', () => {
    it('sem relatório, oferece avaliar agora em vez de tela vazia', async () => {
        getDataHealth.mockResolvedValue({ report: null, history: [], jobs: [] });
        render(<AdminSaudeTab />);
        expect(await screen.findByText(/Nenhuma avaliação registrada ainda/)).toBeInTheDocument();
        expect(screen.getByText('Avaliar agora')).toBeInTheDocument();
    });
});
