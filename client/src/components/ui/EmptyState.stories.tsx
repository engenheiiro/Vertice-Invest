import type { Meta, StoryObj } from '@storybook/react';
import { PieChart, Target, BrainCircuit } from 'lucide-react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const CarteiraSemAtivos: Story = {
  args: {
    icon: <PieChart size={28} />,
    title: 'Sua carteira está vazia',
    description: 'Adicione seu primeiro ativo para acompanhar patrimônio, rentabilidade e proventos em tempo real.',
    action: (
      <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl px-5 py-2.5 text-sm transition-colors">
        Adicionar primeiro ativo
      </button>
    ),
  },
};

export const SemMetas: Story = {
  args: {
    icon: <Target size={28} />,
    title: 'Crie sua primeira meta',
    description: 'Defina um alvo, um aporte mensal, e acompanhe quanto falta para chegar lá.',
  },
};

export const SemRelatorio: Story = {
  args: {
    icon: <BrainCircuit size={28} />,
    title: 'Análise não encontrada',
    description: 'Use o painel admin para gerar o relatório inaugural desta categoria.',
  },
};
