/**
 * Testes do ProfileSettings (Informações Pessoais do Perfil).
 *
 * Cobre: carga dos dados do usuário (corretora conhecida × "Outra"), máscaras
 * de CPF/CEP, validação do CPF antes de salvar, preenchimento do endereço pelo
 * ViaCEP (fetch dublado — nunca rede real), CEP inexistente/fora do ar e a
 * gravação com o payload normalizado (salário numérico, corretora livre).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ProfileSettings } from './ProfileSettings';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/auth';

const refreshProfile = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../services/auth', () => ({ authService: { updateProfile: vi.fn() } }));

const updateProfile = vi.mocked(authService.updateProfile);
const fetchMock = vi.fn();

const USER = {
  name: 'Ana Souza', email: 'ana@exemplo.com', phone: '81999990000', occupation: 'Engenheira',
  cpf: '', brokerage: 'Corretora Pequena', cep: '', street: '', neighborhood: '', city: '', state: '',
  birthDate: '1990-05-10', salary: 8000,
};

function mockUser(user: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({ user, refreshProfile } as unknown as ReturnType<typeof useAuth>);
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  refreshProfile.mockResolvedValue(undefined);
  mockUser(USER);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfileSettings', () => {
  it('carrega o perfil e trata corretora desconhecida como "Outra"', async () => {
    const { container } = render(<ProfileSettings />);
    expect(field('Nome Completo')).toHaveValue('Ana Souza');
    expect(field('Salário Atual (R$)')).toHaveValue(8000);
    expect(screen.getByLabelText('Principal Corretora')).toHaveValue('Outra');
    expect(field('Qual corretora?')).toHaveValue('Corretora Pequena');
    expect(field('Email (Imutável)')).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('corretora conhecida fica no select e esconde o campo livre', () => {
    mockUser({ ...USER, brokerage: 'BTG Pactual', salary: null });
    render(<ProfileSettings />);
    expect(screen.getByLabelText('Principal Corretora')).toHaveValue('BTG Pactual');
    expect(screen.queryByLabelText('Qual corretora?')).not.toBeInTheDocument();
    expect(field('Salário Atual (R$)')).toHaveValue(null);
  });

  it('aplica máscara de CPF e recusa CPF inválido sem chamar a API', () => {
    render(<ProfileSettings />);
    fireEvent.change(field('CPF'), { target: { value: '11111111111' } });
    expect(field('CPF')).toHaveValue('111.111.111-11');
    save();
    expect(screen.getByText('CPF inválido.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();

    fireEvent.change(field('CPF'), { target: { value: '52998224726' } });
    expect(screen.queryByText('CPF inválido.')).not.toBeInTheDocument();
    save();
    expect(screen.getByText('CPF inválido.')).toBeInTheDocument();
  });

  it('salva com CPF válido, corretora livre aparada e salário numérico', async () => {
    updateProfile.mockResolvedValue({});
    render(<ProfileSettings />);
    fireEvent.change(field('CPF'), { target: { value: '52998224725' } });
    fireEvent.change(field('Qual corretora?'), { target: { value: '  Minha Corretora  ' } });
    fireEvent.change(field('Salário Atual (R$)'), { target: { value: '9500.5' } });
    save();

    expect(await screen.findByText('Perfil atualizado com sucesso.')).toBeInTheDocument();
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ana Souza', cpf: '529.982.247-25', brokerage: 'Minha Corretora', salary: 9500.5, birthDate: '1990-05-10',
    }));
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('salário vazio vai como string vazia e erro do servidor aparece', async () => {
    updateProfile.mockRejectedValue(new Error('Telefone inválido.'));
    render(<ProfileSettings />);
    fireEvent.change(screen.getByLabelText('Principal Corretora'), { target: { value: 'Rico' } });
    fireEvent.change(field('Salário Atual (R$)'), { target: { value: '' } });
    save();
    expect(await screen.findByText('Telefone inválido.')).toBeInTheDocument();
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ brokerage: 'Rico', salary: '' }));
  });

  it('CEP com 8 dígitos preenche o endereço pelo ViaCEP ao sair do campo', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ logradouro: 'Rua do Sol', bairro: 'Boa Vista', localidade: 'Recife', uf: 'PE' }) });
    render(<ProfileSettings />);
    fireEvent.change(field('CEP'), { target: { value: '50050000' } });
    expect(field('CEP')).toHaveValue('50050-000');
    fireEvent.blur(field('CEP'));

    await waitFor(() => expect(field('Cidade')).toHaveValue('Recife'));
    expect(fetchMock).toHaveBeenCalledWith('https://viacep.com.br/ws/50050000/json/');
    expect(field('Logradouro')).toHaveValue('Rua do Sol');
    expect(field('Bairro')).toHaveValue('Boa Vista');
    expect(field('Estado (UF)')).toHaveValue('PE');
  });

  it('CEP incompleto não consulta; CEP inexistente e falha de rede avisam', async () => {
    render(<ProfileSettings />);
    fireEvent.change(field('CEP'), { target: { value: '5005' } });
    fireEvent.blur(field('CEP'));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ json: async () => ({ erro: true }) });
    fireEvent.change(field('CEP'), { target: { value: '00000000' } });
    fireEvent.blur(field('CEP'));
    expect(await screen.findByText('CEP não encontrado.')).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(field('CEP'), { target: { value: '11111111' } });
    fireEvent.blur(field('CEP'));
    expect(await screen.findByText('Não foi possível consultar o CEP.')).toBeInTheDocument();
  });
});
