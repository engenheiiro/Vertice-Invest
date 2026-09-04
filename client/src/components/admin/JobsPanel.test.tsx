import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobsPanel, isJobLate, jobTier, splitJobLabel } from './JobsPanel';
import type { JobStatus } from '../../services/health';

// A seção tem 21 rotinas e o estado normal dela é o desinteressante. O que se
// cobra aqui é isso: ocupar espaço só quando tem o que contar, e dizer QUEM está
// atrasado antes de obrigar a abrir.

const job = (over: Partial<JobStatus>): JobStatus => ({
    jobId: 'macro-sync',
    label: 'Macroeconomia (15 min)',
    severity: 'CRITICAL',
    maxSilenceHours: 2,
    monitored: true,
    lastRunAt: new Date().toISOString(),
    lastStatus: 'SUCCESS',
    lastError: null,
    lastDurationMs: 900,
    runs24h: 96,
    failures24h: 0,
    ...over,
});

describe('JobsPanel', () => {
    it('nasce recolhido quando está tudo em dia', () => {
        render(<JobsPanel jobs={[job({})]} />);
        expect(screen.getByText('Todas em dia')).toBeInTheDocument();
        expect(screen.queryByText('Macroeconomia')).not.toBeInTheDocument();
    });

    // Recolhido não pode virar esconderijo: quando há problema, a seção se abre
    // sozinha — senão o único lugar que conta o defeito é o que ninguém clicou.
    it('abre sozinho quando alguma rotina está atrasada', () => {
        const velho = new Date(Date.now() - 10 * 3600000).toISOString();
        render(<JobsPanel jobs={[job({ lastRunAt: velho })]} />);
        expect(screen.getByText('Macroeconomia')).toBeInTheDocument();
        expect(screen.getByText('1 atrasada(s)')).toBeInTheDocument();
    });

    it('o resumo NOMEIA a rotina com problema, sem precisar abrir', () => {
        const velho = new Date(Date.now() - 10 * 3600000).toISOString();
        render(<JobsPanel jobs={[job({ lastRunAt: velho })]} />);
        // Aparece duas vezes: no resumo do cabeçalho e na linha da rotina.
        expect(screen.getAllByText(/Macroeconomia/).length).toBeGreaterThan(1);
    });

    it('mostra o erro da última execução quando a rotina falhou', () => {
        render(<JobsPanel jobs={[job({ lastStatus: 'FAILED', lastError: 'ETIMEDOUT no Yahoo' })]} />);
        expect(screen.getByText(/ETIMEDOUT no Yahoo/)).toBeInTheDocument();
    });

    it('deixa abrir e fechar à mão', () => {
        render(<JobsPanel jobs={[job({})]} />);
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        expect(screen.getByText('Macroeconomia')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { expanded: true }));
        expect(screen.queryByText('Macroeconomia')).not.toBeInTheDocument();
    });

    it('agrupa por periodicidade, em ordem fixa', () => {
        render(<JobsPanel jobs={[
            job({ jobId: 'a', label: 'Snapshot (23:59)', maxSilenceHours: 30, lastStatus: 'FAILED', lastError: 'x' }),
            job({ jobId: 'b', label: 'Sync completo (manual)', monitored: false, maxSilenceHours: null }),
        ]}
        />);
        expect(screen.getByText('Uma ou mais vezes por dia')).toBeInTheDocument();
        expect(screen.getByText('Sob demanda')).toBeInTheDocument();
    });
});

describe('regras de leitura das rotinas', () => {
    // Rotina anual ou de disparo manual passa meses sem rodar por projeto. Cobrar
    // presença dela encheria o painel de vermelho permanente — o alarme que se
    // aprende a ignorar.
    it('rotina não monitorada nunca fica atrasada', () => {
        expect(isJobLate(job({ monitored: false, lastRunAt: null }))).toBe(false);
    });

    it('rotina cobrada que nunca rodou está atrasada', () => {
        expect(isJobLate(job({ lastRunAt: null }))).toBe(true);
    });

    it('o balde sai do teto de silêncio, não de texto do rótulo', () => {
        expect(jobTier(job({ maxSilenceHours: 2 }))).toBe('minutes');
        expect(jobTier(job({ maxSilenceHours: 30 }))).toBe('daily');
        expect(jobTier(job({ maxSilenceHours: 192 }))).toBe('sparse');
        expect(jobTier(job({ monitored: false, maxSilenceHours: null }))).toBe('demand');
    });

    it('separa nome e periodicidade do rótulo do catálogo', () => {
        expect(splitJobLabel('Macroeconomia (15 min)')).toEqual({ name: 'Macroeconomia', schedule: '15 min' });
        expect(splitJobLabel('Sync de feriados')).toEqual({ name: 'Sync de feriados', schedule: null });
    });
});
