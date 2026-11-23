/**
 * Caracterização do ProfileIdentity: guarda um resumo (sha256 do HTML) de cada
 * combinação relevante de usuário × interação. Serve para provar que a
 * refatoração em partes não mudou nada visível. As regras finas moram em
 * `profileIdentityView.test.ts` e o comportamento em `ProfileIdentity.test.tsx`.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProfileIdentity } from './ProfileIdentity';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/auth';

const { addToast, refreshProfile } = vi.hoisted(() => ({ addToast: vi.fn(), refreshProfile: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../services/auth', () => ({
  authService: { updateAvatar: vi.fn(), removeAvatar: vi.fn(), updateProfile: vi.fn() },
}));

type Auth = ReturnType<typeof useAuth>;
type Interaction = 'nada' | 'seletor' | 'salvandoBanner' | 'removendoFoto';

const BASE = { name: 'Ana Maria Souza', email: 'ana@exemplo.com', plan: 'PRO', subscriptionStatus: 'ACTIVE' };
const AVATAR = 'data:image/webp;base64,a';

const USERS: Record<string, Record<string, unknown> | null> = {
  semUsuario: null,
  pro: BASE,
  guest: { ...BASE, plan: 'GUEST', subscriptionStatus: 'PENDING' },
  essential: { ...BASE, plan: 'ESSENTIAL', city: 'Recife' },
  elite: { ...BASE, plan: 'ELITE', city: 'Recife', state: 'PE', bannerColor: 'sunset' },
  black: { ...BASE, plan: 'BLACK', avatar: AVATAR, subscriptionStatus: 'CANCELED', bannerColor: 'gold' },
  semPlano: { name: 'Zé', email: 'z@e.com', avatar: AVATAR },
  presetInvalido: { ...BASE, bannerColor: 'neon' },
};

const never = () => new Promise<never>(() => {});

async function interact(kind: Interaction) {
  if (kind === 'nada') return;
  if (kind === 'removendoFoto') {
    const remove = screen.queryByRole('button', { name: 'Remover foto de perfil' });
    if (remove) await act(async () => { fireEvent.click(remove); });
    return;
  }
  const toggle = screen.queryByRole('button', { name: 'Personalizar banner' });
  if (!toggle) return;
  fireEvent.click(toggle);
  if (kind === 'salvandoBanner') {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Banner Real' })); });
  }
}

const digest = (html: string) => createHash('sha256').update(html).digest('hex').slice(0, 16);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authService.updateProfile).mockImplementation(never);
  vi.mocked(authService.removeAvatar).mockImplementation(never);
});

describe('caracterização do ProfileIdentity', () => {
  it('HTML de cada usuário × interação', async () => {
    const rows: string[] = [];
    const interactions: Interaction[] = ['nada', 'seletor', 'salvandoBanner', 'removendoFoto'];
    for (const [name, user] of Object.entries(USERS)) {
      vi.mocked(useAuth).mockReturnValue({ user, refreshProfile } as unknown as Auth);
      for (const kind of interactions) {
        const { container, unmount } = render(<ProfileIdentity />);
        await interact(kind);
        rows.push(`${name}/${kind}: ${digest(container.innerHTML)}`);
        unmount();
      }
    }
    expect(rows).toMatchSnapshot();
  });
});
