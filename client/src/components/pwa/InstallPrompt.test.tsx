/**
 * Testes do InstallPrompt (banner de instalação do PWA).
 *
 * Cobre: Android/Chrome via `beforeinstallprompt` (instalar e dispensar
 * gravam a dispensa), dica manual no iOS, já instalado (standalone), já
 * dispensado, evento `appinstalled` e telas de autenticação sem banner.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { InstallPrompt } from './InstallPrompt';

let pathname = '/dashboard';
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname }) }));

const KEY = 'vertice_pwa_install_dismissed';
const originalUA = navigator.userAgent;

const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const setStandalone = (matches: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches, media: query })) as unknown as typeof window.matchMedia;
};

const firePrompt = () => {
  const evt = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(evt, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  act(() => { window.dispatchEvent(evt); });
  return { evt, prompt };
};

beforeEach(() => {
  pathname = '/dashboard';
  localStorage.clear();
  setStandalone(false);
  setUA(originalUA);
});

afterEach(() => {
  setUA(originalUA);
});

describe('InstallPrompt', () => {
  it('nada aparece antes do evento do navegador', () => {
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Android: evento mostra o banner e "Instalar app" chama o prompt nativo', async () => {
    const { container } = render(<InstallPrompt />);
    const { evt, prompt } = firePrompt();
    expect(evt.defaultPrevented).toBe(true);
    expect(screen.getByText('Instalar o Vértice')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Instalar app' }));
    await waitFor(() => expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument());
    expect(prompt).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('dispensar esconde e grava a preferência', () => {
    render(<InstallPrompt />);
    firePrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('iOS mostra a instrução manual sem botão de instalar', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    render(<InstallPrompt />);
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instalar app' })).not.toBeInTheDocument();
  });

  it('appinstalled esconde o banner e grava a dispensa', () => {
    render(<InstallPrompt />);
    firePrompt();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('já instalado, já dispensado ou em tela de login não mostra', () => {
    setStandalone(true);
    const first = render(<InstallPrompt />);
    firePrompt();
    expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument();
    first.unmount();

    setStandalone(false);
    localStorage.setItem(KEY, '1');
    const second = render(<InstallPrompt />);
    firePrompt();
    expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument();
    second.unmount();

    localStorage.clear();
    pathname = '/login';
    render(<InstallPrompt />);
    firePrompt();
    expect(screen.queryByText('Instalar o Vértice')).not.toBeInTheDocument();
  });
});
