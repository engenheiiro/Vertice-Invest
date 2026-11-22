/**
 * Testes do ProfileIdentity (cartão de identidade do Perfil).
 *
 * Cobre: iniciais/avatar, localização e status, banner por plano × preset
 * escolhido, troca e restauração do banner, e a foto de perfil — validação de
 * formato/tamanho, recorte para data URL (Image/canvas dublados: o jsdom não
 * decodifica imagem), envio, remoção e erros do servidor.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileIdentity } from './ProfileIdentity';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/auth';

const addToast = vi.fn();
const refreshProfile = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../services/auth', () => ({
  authService: { updateAvatar: vi.fn(), removeAvatar: vi.fn(), updateProfile: vi.fn() },
}));

const auth = vi.mocked(authService);
type Auth = ReturnType<typeof useAuth>;

function mockUser(user: Record<string, unknown> | null) {
  vi.mocked(useAuth).mockReturnValue({ user, refreshProfile } as unknown as Auth);
}

const BASE_USER = { name: 'Ana Maria Souza', email: 'ana@exemplo.com', plan: 'PRO', subscriptionStatus: 'ACTIVE' };

/** Imagem que "carrega" assim que recebe o src, com 400×200 (recorte central 200×200). */
class FakeImage {
  width = 400;
  height = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
}

const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (container: HTMLElement, file: File) => fireEvent.change(fileInput(container), { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  refreshProfile.mockResolvedValue(undefined);
  mockUser(BASE_USER);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('identidade', () => {
  it('mostra iniciais, e-mail, status ativo e nível de acesso do plano', () => {
    render(<ProfileIdentity />);
    expect(screen.getByText('AM')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana Maria Souza' })).toBeInTheDocument();
    expect(screen.getByText('ana@exemplo.com')).toBeInTheDocument();
    expect(screen.getByText('Brasil')).toBeInTheDocument();
    expect(screen.getByText('active')).toHaveClass('text-emerald-400');
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar foto de perfil' })).toBeInTheDocument();
  });

  it('com avatar e cidade mostra a foto, a cidade/UF e o botão de remover', () => {
    mockUser({ ...BASE_USER, plan: 'BLACK', avatar: 'data:image/webp;base64,a', city: 'Recife', state: 'PE', subscriptionStatus: 'CANCELED' });
    render(<ProfileIdentity />);
    expect(screen.getByAltText('Foto de perfil')).toBeInTheDocument();
    expect(screen.getByText('Recife/PE')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText('canceled')).toHaveClass('text-slate-300');
    expect(screen.getByRole('button', { name: 'Remover foto de perfil' })).toBeInTheDocument();
  });

  it('sem usuário cai nas iniciais VI e sem personalização de banner', () => {
    mockUser(null);
    render(<ProfileIdentity />);
    expect(screen.getByText('VI')).toBeInTheDocument();
    expect(screen.getByText('STD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Personalizar banner' })).not.toBeInTheDocument();
  });
});

describe('banner', () => {
  it('aplica um preset, atualiza o perfil e fecha o seletor', async () => {
    auth.updateProfile.mockResolvedValue({});
    render(<ProfileIdentity />);
    const toggle = screen.getByRole('button', { name: 'Personalizar banner' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Padrão do plano/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Banner Oceano' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Banner atualizado.', 'success'));
    expect(auth.updateProfile).toHaveBeenCalledWith({ bannerColor: 'ocean' });
    expect(refreshProfile).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Banner Oceano' })).not.toBeInTheDocument();
  });

  it('escolher o preset já ativo só fecha, e "Padrão do plano" restaura', async () => {
    mockUser({ ...BASE_USER, bannerColor: 'gold' });
    auth.updateProfile.mockResolvedValue({});
    render(<ProfileIdentity />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar banner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Banner Ouro' }));
    expect(auth.updateProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Banner Ouro' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Personalizar banner' }));
    fireEvent.click(screen.getByRole('button', { name: /Padrão do plano/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Banner restaurado para o padrão do plano.', 'success'));
    expect(auth.updateProfile).toHaveBeenCalledWith({ bannerColor: '' });
  });

  it('erro ao salvar o banner avisa e mantém o seletor aberto', async () => {
    auth.updateProfile.mockRejectedValue(new Error('Servidor fora.'));
    render(<ProfileIdentity />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar banner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Banner Grafite' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Servidor fora.', 'error'));
    expect(screen.getByRole('button', { name: 'Banner Grafite' })).toBeInTheDocument();
  });
});

describe('foto de perfil', () => {
  it('recusa formato fora de PNG/JPEG/WebP e arquivo acima de 8MB', () => {
    const { container } = render(<ProfileIdentity />);
    pick(container, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(addToast).toHaveBeenCalledWith('Formato inválido. Use PNG, JPEG ou WebP.', 'error');

    const big = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    pick(container, big);
    expect(addToast).toHaveBeenCalledWith('Imagem muito grande (máx. 8MB).', 'error');
    expect(auth.updateAvatar).not.toHaveBeenCalled();
  });

  it('recorta para 256×256, cai em JPEG sem WebP e envia', async () => {
    vi.stubGlobal('Image', FakeImage);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation((type?: string) => (type === 'image/jpeg' ? 'data:image/jpeg;base64,ok' : 'data:image/png;base64,no'));
    auth.updateAvatar.mockResolvedValue({});

    const { container } = render(<ProfileIdentity />);
    pick(container, new File(['abc'], 'foto.png', { type: 'image/png' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Foto de perfil atualizada.', 'success'));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 0, 200, 200, 0, 0, 256, 256);
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.82);
    expect(auth.updateAvatar).toHaveBeenCalledWith('data:image/jpeg;base64,ok');
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('imagem que não decodifica vira toast de erro', async () => {
    class BrokenImage extends FakeImage {
      set src(_v: string) { setTimeout(() => this.onerror?.(), 0); }
    }
    vi.stubGlobal('Image', BrokenImage);
    const { container } = render(<ProfileIdentity />);
    pick(container, new File(['abc'], 'foto.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Imagem inválida.', 'error'));
    expect(auth.updateAvatar).not.toHaveBeenCalled();
  });

  it('remove a foto e informa erro do servidor na remoção', async () => {
    mockUser({ ...BASE_USER, avatar: 'data:image/webp;base64,a' });
    auth.removeAvatar.mockResolvedValueOnce({}).mockRejectedValueOnce({});
    render(<ProfileIdentity />);
    const remove = screen.getByRole('button', { name: 'Remover foto de perfil' });

    fireEvent.click(remove);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Foto de perfil removida.', 'success'));
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Não foi possível remover a foto.', 'error'));
  });
});
