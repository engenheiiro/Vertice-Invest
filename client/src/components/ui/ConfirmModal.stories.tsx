import type { Meta, StoryObj } from '@storybook/react';
import { ConfirmModal } from './ConfirmModal';

const meta: Meta<typeof ConfirmModal> = {
  title: 'UI/ConfirmModal',
  component: ConfirmModal,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmModal>;

export const Informativo: Story = {
  args: {
    title: 'Confirmar Upgrade',
    message: 'Você será redirecionado para a página de planos. Deseja continuar?',
    confirmText: 'Ver Planos',
    isDestructive: false,
  },
};

export const Destrutivo: Story = {
  args: {
    title: 'Excluir Carteira Permanentemente?',
    message: 'Todo o histórico de transações, lotes fiscais e snapshots serão apagados da sua conta.',
    confirmText: 'Sim, Excluir Tudo',
    isDestructive: true,
  },
};
