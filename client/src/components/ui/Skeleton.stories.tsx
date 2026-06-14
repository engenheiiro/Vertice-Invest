import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonChart, SkeletonKpiGrid, SkeletonTableRows } from './Skeleton';

const meta: Meta = {
  title: 'UI/Skeleton',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
};

export default meta;

export const Linha: StoryObj = {
  render: () => <Skeleton className="h-4 w-48" />,
};

export const Circulo: StoryObj = {
  render: () => <Skeleton circle className="h-10 w-10" />,
};

export const TextoMultiLinha: StoryObj = {
  render: () => <SkeletonText lines={4} className="max-w-xs" />,
};

export const CardGenerico: StoryObj = {
  render: () => <SkeletonCard className="h-40 max-w-sm" />,
};

export const Grafico: StoryObj = {
  render: () => <SkeletonChart className="h-64" />,
};

export const GridKPIs: StoryObj = {
  render: () => <SkeletonKpiGrid count={4} />,
};

export const LinhasTabela: StoryObj = {
  render: () => <SkeletonTableRows rows={5} />,
};
