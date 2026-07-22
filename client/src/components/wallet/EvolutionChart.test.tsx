import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../contexts/WalletContext', () => ({
    useWallet: () => ({
        history: [],
        isPrivacyMode: false,
        kpis: {
            totalEquity: 8353.77,
            totalInvested: 8353.77,
            totalResult: 0,
        },
    }),
}));

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: 'dark' }),
}));

vi.mock('recharts', async () => {
    const ReactModule = await import('react');
    const Container = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children);
    const Chart = ({ children, data }: { children?: React.ReactNode; data?: Array<{ isLive?: boolean; isVisualAnchor?: boolean }> }) => ReactModule.createElement('svg', {
        'data-testid': 'composed-chart',
        'data-point-count': String(data?.length ?? 0),
        'data-first-anchor': String(data?.[0]?.isVisualAnchor === true),
        'data-last-live': String(data?.[(data?.length ?? 1) - 1]?.isLive === true),
    }, children);
    const Empty = () => null;

    return {
        ResponsiveContainer: Container,
        ComposedChart: Chart,
        Area: Empty,
        Line: Empty,
        XAxis: Empty,
        YAxis: Empty,
        Tooltip: Empty,
        CartesianGrid: Empty,
    };
});

import { EvolutionChart } from './EvolutionChart';

describe('EvolutionChart — carteira sem snapshots', () => {
    it('ancora a linha à esquerda e mantém o ponto LIVE no final quando existe somente um dado real', () => {
        render(<EvolutionChart />);

        const chart = screen.getByTestId('composed-chart');
        expect(chart).toHaveAttribute('data-point-count', '2');
        expect(chart).toHaveAttribute('data-first-anchor', 'true');
        expect(chart).toHaveAttribute('data-last-live', 'true');
    });
});
