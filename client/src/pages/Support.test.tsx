/**
 * Página /suporte: é o destino do link do e-mail de resposta
 * (`/suporte?ticket=VT-0042`). Trava que o código do ticket na URL chega ao
 * SupportCenter (variante de página) e que a página tem título próprio.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Support from './Support';

const received = vi.hoisted(() => ({ props: [] as Array<{ variant: string; initialTicketCode: string | null }> }));

vi.mock('../components/dashboard/Header', () => ({ Header: () => null }));
vi.mock('../components/support/SupportCenter', () => ({
  SupportCenter: (props: { variant: string; initialTicketCode: string | null }) => {
    received.props.push(props);
    return <div data-testid="support-center" />;
  },
}));

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Support />
  </MemoryRouter>,
);

describe('Support (página)', () => {
  it('passa o código do ticket da URL ao SupportCenter de página', () => {
    received.props = [];
    renderAt('/suporte?ticket=VT-0042');
    expect(screen.getByRole('heading', { level: 1, name: /Suporte/ })).toBeInTheDocument();
    expect(received.props.at(-1)).toEqual({ variant: 'page', initialTicketCode: 'VT-0042' });
  });

  it('sem ticket na URL, abre sem conversa escolhida (null)', () => {
    received.props = [];
    renderAt('/suporte');
    expect(received.props.at(-1)).toEqual({ variant: 'page', initialTicketCode: null });
  });
});
