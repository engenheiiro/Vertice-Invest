import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authService } from './auth';
import { recordApiError } from '../utils/supportContext';

/**
 * authService.api é o funil único de rede do app: anexa Bearer + CSRF, renova
 * o token num 401 (uma renovação só para N requisições em fila), manda para o
 * /login quando a renovação falha e anota a falha final para o ticket de
 * suporte. Os métodos de sessão (login/logout/perfil) completam o contrato.
 */

vi.mock('../utils/supportContext', () => ({ recordApiError: vi.fn() }));

type FetchArgs = [input: string, init?: RequestInit];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const headerOf = (call: FetchArgs | undefined, name: string) => new Headers(call?.[1]?.headers).get(name);

const assignMock = vi.fn<(url: string) => void>();
// jsdom não deixa espionar location.assign; a rota corrente é controlada aqui.
let currentPath = '/carteira';
const locationStub = {
  get pathname() { return currentPath; },
  assign: assignMock,
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.mocked(recordApiError).mockClear();
  assignMock.mockReset();
  vi.stubGlobal('location', locationStub);
  localStorage.clear();
  authService.setAccessToken(null);
  document.cookie = 'csrfToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  currentPath = '/carteira';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('authService.api — cabeçalhos', () => {
  it('envia Bearer, JSON e cookies; GET não leva CSRF', async () => {
    authService.setAccessToken('tok-1');
    document.cookie = 'csrfToken=abc%3D1; path=/';
    fetchMock.mockResolvedValue(json({ ok: true }));

    await authService.api('/api/wallet');

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/wallet');
    expect(call[1]?.credentials).toBe('include');
    expect(headerOf(call, 'Authorization')).toBe('Bearer tok-1');
    expect(headerOf(call, 'Content-Type')).toBe('application/json');
    expect(headerOf(call, 'X-CSRF-Token')).toBeNull();
  });

  it('mutação leva o CSRF decodificado do cookie (double-submit)', async () => {
    document.cookie = 'csrfToken=abc%3D1; path=/';
    fetchMock.mockResolvedValue(json({ ok: true }));

    await authService.api('/api/wallet/add', { method: 'post' });

    expect(headerOf(fetchMock.mock.calls[0], 'X-CSRF-Token')).toBe('abc=1');
    // Sem token em memória, nenhum Authorization vazio é inventado.
    expect(headerOf(fetchMock.mock.calls[0], 'Authorization')).toBeNull();
    expect(authService.csrfHeader()).toEqual({ 'X-CSRF-Token': 'abc=1' });
  });

  it('sem cookie CSRF, csrfHeader é vazio e a mutação sai sem o header', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await authService.api('/api/x', { method: 'DELETE' });
    expect(headerOf(fetchMock.mock.calls[0], 'X-CSRF-Token')).toBeNull();
    expect(authService.csrfHeader()).toEqual({});
  });

  it('falha de rede vira mensagem legível', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(authService.api('/api/wallet')).rejects.toThrow('Erro de conexão. Verifique se o servidor está rodando.');
  });

  it('resposta não-ok (fora do 401) é anotada para o suporte e devolvida ao chamador', async () => {
    fetchMock.mockResolvedValue(json({ message: 'x' }, 500));
    const res = await authService.api('/api/wallet');
    expect(res.status).toBe(500);
    expect(recordApiError).toHaveBeenCalledWith('/api/wallet', 500);
  });

  it('resposta ok não anota nada', async () => {
    fetchMock.mockResolvedValue(json({}));
    await authService.api('/api/wallet');
    expect(recordApiError).not.toHaveBeenCalled();
  });
});

describe('authService.api — refresh automático no 401', () => {
  it('renova o token e repete a requisição com o novo Bearer e o mesmo CSRF', async () => {
    authService.setAccessToken('velho');
    document.cookie = 'csrfToken=c1; path=/';
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ accessToken: 'novo' }))
      .mockResolvedValueOnce(json({ saved: true }));

    const res = await authService.api('/api/wallet/add', { method: 'POST', body: '{}' });

    expect(await res.json()).toEqual({ saved: true });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/refresh');
    const retry = fetchMock.mock.calls[2];
    expect(retry[0]).toBe('/api/wallet/add');
    expect(headerOf(retry, 'Authorization')).toBe('Bearer novo');
    expect(headerOf(retry, 'X-CSRF-Token')).toBe('c1');
    expect(authService.getAccessToken()).toBe('novo');
    expect(recordApiError).not.toHaveBeenCalled();
  });

  it('N requisições com 401 simultâneo disparam UMA renovação e todas são repetidas', async () => {
    authService.setAccessToken('velho');
    let releaseRefresh: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation((url) => {
      if (url === '/api/refresh') return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
      const auth = headerOf([url, fetchMock.mock.calls.at(-1)?.[1]], 'Authorization');
      return Promise.resolve(auth === 'Bearer novo' ? json({ url }) : json({}, 401));
    });

    const a = authService.api('/api/a');
    const b = authService.api('/api/b');
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/refresh')).toHaveLength(1));
    releaseRefresh(json({ accessToken: 'novo' }));

    const [ra, rb] = await Promise.all([a, b]);
    expect(await ra.json()).toEqual({ url: '/api/a' });
    expect(await rb.json()).toEqual({ url: '/api/b' });
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/refresh')).toHaveLength(1);
  });

  it('renovação falhou: limpa a sessão, manda para o /login e devolve o 401 original', async () => {
    authService.setAccessToken('velho');
    localStorage.setItem('user', '{"id":"u1"}');
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 401));

    const res = await authService.api('/api/wallet');

    expect(res.status).toBe(401);
    expect(authService.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('user')).toBeNull();
    expect(assignMock).toHaveBeenCalledWith('/login');
    // A falha que interessa ao diagnóstico é a de DEPOIS da renovação.
    expect(recordApiError).toHaveBeenCalledWith('/api/wallet', 401);
  });

  it('não redireciona quem já está no /login nem a sondagem de assinatura', async () => {
    fetchMock.mockImplementation(async () => json({}, 401));

    await authService.api('/api/subscription/status');
    expect(assignMock).not.toHaveBeenCalled();

    currentPath = '/login';
    await authService.api('/api/wallet');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('refresh recusado ou sem rede devolve null e não troca o token em memória', async () => {
    authService.setAccessToken('velho');
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockRejectedValueOnce(new TypeError('offline'));
    await expect(authService.refreshToken()).resolves.toBeNull();
    await expect(authService.refreshToken()).resolves.toBeNull();
    expect(authService.getAccessToken()).toBe('velho');
  });

  it('retry pós-refresh que ainda falha é anotado com o status final', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ accessToken: 'novo' }))
      .mockResolvedValueOnce(json({}, 403));

    const res = await authService.api('/api/research/latest');

    expect(res.status).toBe(403);
    expect(recordApiError).toHaveBeenCalledWith('/api/research/latest', 403);
  });
});

describe('authService.login / register', () => {
  it('login guarda o token só em memória e o usuário no localStorage', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: deleteCache });
    fetchMock.mockResolvedValue(json({ accessToken: 'tok', user: { id: 'u1', plan: 'PRO' } }));

    await authService.login({ email: 'a@b.com', password: 'Senha123' });

    expect(authService.getAccessToken()).toBe('tok');
    expect(JSON.parse(localStorage.getItem('user') ?? 'null')).toEqual({ id: 'u1', plan: 'PRO' });
    expect(Object.values(localStorage).join()).not.toContain('tok');
    // Troca de sessão apaga o cache de API das versões antigas da PWA.
    expect(deleteCache).toHaveBeenCalledWith('api-cache');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: 'a@b.com', password: 'Senha123' });
  });

  it('login com MFA pendente não abre sessão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(json({ mfaRequired: true }));

    await expect(authService.login({ email: 'a@b.com', password: 'x' })).resolves.toEqual({ mfaRequired: true });
    expect(authService.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('login com resposta que não é JSON acusa backend offline com o status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    await expect(authService.login({ email: 'a', password: 'b' })).rejects.toThrow('Erro do Servidor (502)');
  });

  it('login recusado propaga a mensagem do servidor (ou a padrão)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(json({ message: 'Credenciais inválidas' }, 401));
    await expect(authService.login({ email: 'a', password: 'b' })).rejects.toThrow('Credenciais inválidas');
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await expect(authService.login({ email: 'a', password: 'b' })).rejects.toThrow('Erro no login');
  });

  it('register propaga a mensagem de validação do servidor', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Email já cadastrado' }, 409));
    await expect(authService.register({ name: 'A', email: 'a@b.com', password: 'x' })).rejects.toThrow('Email já cadastrado');
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(authService.register({ name: 'A', email: 'a@b.com', password: 'x' })).rejects.toThrow('Erro ao criar conta');
    fetchMock.mockResolvedValueOnce(json({ message: 'ok' }, 201));
    await expect(authService.register({ name: 'A', email: 'a@b.com', password: 'x' })).resolves.toEqual({ message: 'ok' });
  });
});

describe('authService — logout e recuperação de senha', () => {
  it('logout limpa a sessão local mesmo se o servidor não responder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authService.setAccessToken('tok');
    localStorage.setItem('user', '{}');
    fetchMock.mockRejectedValue(new TypeError('offline'));

    await authService.logout();

    expect(authService.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('forgotPassword não revela se o e-mail existe: só 5xx é erro', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(authService.forgotPassword('x@y.com')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(authService.forgotPassword('x@y.com')).rejects.toThrow('Erro no servidor');
  });

  it('resetPassword envia token + nova senha e propaga a recusa', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Token expirado' }, 400));
    await expect(authService.resetPassword('t1', 'Nova1234')).rejects.toThrow('Token expirado');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ token: 't1', newPassword: 'Nova1234' });
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(authService.resetPassword('t1', 'x')).rejects.toThrow('Falha ao redefinir senha');
    fetchMock.mockResolvedValueOnce(json({}, 200));
    await expect(authService.resetPassword('t1', 'x')).resolves.toBeUndefined();
  });
});

describe('authService — perfil, MFA e conta', () => {
  it('updateProfile/avatar atualizam o usuário guardado com o que o servidor devolveu', async () => {
    fetchMock.mockImplementation(async () => json({ user: { id: 'u1', name: 'Novo' } }));

    await authService.updateProfile({ name: 'Novo' });
    expect(JSON.parse(localStorage.getItem('user') ?? 'null')).toEqual({ id: 'u1', name: 'Novo' });

    localStorage.clear();
    await authService.updateAvatar('data:image/png;base64,AAA');
    expect(localStorage.getItem('user')).not.toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ avatar: 'data:image/png;base64,AAA' });

    localStorage.clear();
    await authService.removeAvatar();
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE');
    expect(localStorage.getItem('user')).not.toBeNull();
  });

  it.each([
    ['updateProfile', () => authService.updateProfile({}), 'Erro ao atualizar perfil'],
    ['updateAvatar', () => authService.updateAvatar('x'), 'Erro ao atualizar foto'],
    ['removeAvatar', () => authService.removeAvatar(), 'Erro ao remover foto'],
    ['changePassword', () => authService.changePassword({}), 'Erro ao alterar senha'],
    ['setupMfa', () => authService.setupMfa('pw'), 'Erro ao iniciar configuração do MFA'],
    ['enableMfa', () => authService.enableMfa('123456'), 'Código inválido'],
    ['disableMfa', () => authService.disableMfa({ token: '1' }), 'Erro ao desativar o MFA'],
    ['deactivateAccount', () => authService.deactivateAccount('pw'), 'Falha ao desativar conta'],
    ['exportData', () => authService.exportData(), 'Erro ao exportar dados'],
  ] as const)('%s: sem mensagem do servidor usa a padrão; com mensagem, a do servidor', async (_n, call, fallback) => {
    fetchMock.mockImplementationOnce(async () => json({}, 400));
    await expect(call()).rejects.toThrow(fallback);
    fetchMock.mockImplementationOnce(async () => json({ message: 'Motivo do servidor' }, 400));
    await expect(call()).rejects.toThrow('Motivo do servidor');
  });

  it('fluxo MFA devolve o segredo, os códigos de backup e o status', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ secret: 'S', otpauth: 'otpauth://x', qr: 'data:' }))
      .mockResolvedValueOnce(json({ backupCodes: ['a', 'b'] }))
      .mockResolvedValueOnce(json({ mfaEnabled: true }))
      .mockResolvedValueOnce(json({}));

    await expect(authService.setupMfa('pw')).resolves.toMatchObject({ secret: 'S' });
    await expect(authService.enableMfa('123456')).resolves.toEqual({ backupCodes: ['a', 'b'] });
    await expect(authService.getMfaStatus()).resolves.toEqual({ mfaEnabled: true });
    await authService.markTutorialSeen();
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/mfa/setup', '/api/mfa/enable', '/api/mfa/status', '/api/tutorial-seen']);
  });

  it('deleteAccount sinaliza mfaRequired para a tela pedir o código', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Informe o código', mfaRequired: true }, 401))
      .mockResolvedValueOnce(json({ accessToken: 'novo' }))
      .mockResolvedValueOnce(json({ message: 'Informe o código', mfaRequired: true }, 401));

    const err = await authService.deleteAccount('pw').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: 'Informe o código', mfaRequired: true });
  });

  it('deleteAccount manda senha e código MFA no DELETE', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await authService.deleteAccount('pw', '654321');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ password: 'pw', mfaToken: '654321' });
  });
});
