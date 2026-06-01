import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonChart,
  SkeletonKpiGrid,
  SkeletonTableRows,
} from './Skeleton';

describe('Skeleton (UI base — M11/I12)', () => {
  it('Skeleton base é decorativo (aria-hidden) e tem animação', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('h-4');
  });

  it('SkeletonText renderiza o número de linhas pedido', () => {
    const { container } = render(<SkeletonText lines={5} />);
    // wrapper + 5 linhas
    expect(container.querySelectorAll('div').length).toBe(6);
  });

  it('SkeletonCard expõe role=status com aria-label (A11y)', () => {
    render(<SkeletonCard />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Carregando');
  });

  it('SkeletonChart anuncia carregamento de gráfico', () => {
    render(<SkeletonChart />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Carregando gráfico');
  });

  it('SkeletonKpiGrid renderiza N cards', () => {
    const { container } = render(<SkeletonKpiGrid count={4} />);
    const grid = screen.getByRole('status');
    expect(grid).toHaveAttribute('aria-label', 'Carregando indicadores');
    // 4 blocos skeleton dentro do grid
    expect(container.querySelectorAll('.animate-pulse').length).toBe(4);
  });

  it('SkeletonTableRows renderiza N linhas', () => {
    render(<SkeletonTableRows rows={3} />);
    const list = screen.getByRole('status');
    expect(list).toHaveAttribute('aria-label', 'Carregando lista');
    // cada linha tem avatar + 2 barras = 3 skeletons; 3 linhas = 9
    expect(list.querySelectorAll('.animate-pulse').length).toBe(9);
  });
});
