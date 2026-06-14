import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'radio', options: ['primary', 'outline', 'ghost'] },
    status: { control: 'radio', options: ['idle', 'loading', 'success', 'error'] },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Confirmar', variant: 'primary', status: 'idle' },
};

export const Outline: Story = {
  args: { children: 'Cancelar', variant: 'outline', status: 'idle' },
};

export const Ghost: Story = {
  args: { children: 'Fechar', variant: 'ghost', status: 'idle' },
};

export const Loading: Story = {
  args: { children: 'Salvar', status: 'loading' },
};

export const Success: Story = {
  args: { children: 'Salvo', status: 'success' },
};

export const Error: Story = {
  args: { children: 'Tentar novamente', status: 'error' },
};

export const Disabled: Story = {
  args: { children: 'Indisponível', disabled: true },
};
