import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingPage from './RankingPage.jsx';

vi.mock('./rankingApi', () => ({
  fetchCategorias: vi.fn(),
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
  enviarRelatorioPorEmail: vi.fn(),
}));

// fetchDiretores/criarDiretor/atualizarDiretor/removerDiretor/criarRede/
// atualizarRede/removerRede/fetchResponsaveis/criarResponsavel/
// removerResponsavel vêm de ../../lib/cadastrosApi (módulo compartilhado,
// ver CLAUDE.md) — RankingPage.jsx NÃO os importa de ./rankingApi. Mockar o
// módulo errado faz esse teste chamar o fetch real e bater no backend de
// verdade (violação da regra "nunca teste contra serviço real"); corrigido
// aqui na revisão de QA do módulo Controle de Ligações.
vi.mock('../../lib/cadastrosApi', () => ({
  fetchDiretores: vi.fn(),
  criarDiretor: vi.fn(),
  atualizarDiretor: vi.fn(),
  removerDiretor: vi.fn(),
  criarRede: vi.fn(),
  atualizarRede: vi.fn(),
  removerRede: vi.fn(),
  fetchResponsaveis: vi.fn(),
  criarResponsavel: vi.fn(),
  removerResponsavel: vi.fn(),
}));

vi.mock('../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as rankingApi from './rankingApi';
import * as cadastrosApi from '../../lib/cadastrosApi';
import { useAuth } from '../../app/AuthContext.jsx';

const CATEGORIA_PRINCIPAL = { id: 1, nome: 'Vendas', principal: true };

function redeVisivel() {
  return {
    id: 10,
    diretor_id: 1,
    nome: 'Delta',
    emoji: '🏆',
    ativo: true,
    visivel: true,
    responsavel: { id: 1, nome: 'Ana' },
    criado_em: '2024-01-01T00:00:00.000Z',
  };
}

function redeOculta() {
  return {
    id: 20,
    diretor_id: 1,
    nome: 'Lendários',
    emoji: '🥈',
    ativo: true,
    visivel: false,
    responsavel: null,
    criado_em: '2024-01-02T00:00:00.000Z',
  };
}

function diretor1({ redes } = {}) {
  return {
    id: 1,
    nome: 'Victor Hugo',
    criado_em: '2024-01-01T00:00:00.000Z',
    redes: redes || [redeVisivel(), redeOculta()],
  };
}

function redeAtiva() {
  return {
    id: 300, diretor_id: 5, nome: 'Rede Ativa', emoji: '🏆', ativo: true, visivel: true, responsavel: null,
  };
}
function redeInativa() {
  return {
    id: 301, diretor_id: 5, nome: 'Rede Escondida', emoji: '🥈', ativo: false, visivel: true, responsavel: null,
  };
}
function diretorMisto() {
  return { id: 5, nome: 'Diretor Misto', criado_em: '2024-01-01T00:00:00.000Z', redes: [redeAtiva(), redeInativa()] };
}

function mockDadosRedeInativa({ valores } = {}) {
  cadastrosApi.fetchDiretores.mockResolvedValue([diretorMisto()]);
  rankingApi.fetchCategorias.mockResolvedValue([CATEGORIA_PRINCIPAL]);
  rankingApi.fetchEntradas.mockResolvedValue(
    valores || [
      { rede_id: 300, valor: 50 },
      { rede_id: 301, valor: 999 },
    ]
  );
  cadastrosApi.fetchResponsaveis.mockResolvedValue([]);
}

function mockDadosIniciais({ diretores, responsaveis, entradas }) {
  cadastrosApi.fetchDiretores.mockResolvedValue(diretores);
  rankingApi.fetchCategorias.mockResolvedValue([CATEGORIA_PRINCIPAL]);
  rankingApi.fetchEntradas.mockResolvedValue(entradas || [{ rede_id: 10, valor: 50 }]);
  cadastrosApi.fetchResponsaveis.mockResolvedValue(responsaveis || []);
}

async function renderPage() {
  const utils = render(<RankingPage />);
  // espera a tela sair do estado "Carregando..." inicial
  await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RankingPage — ocultar rede (grid principal)', () => {
  it('uma rede com visivel:false não tem nenhuma linha no card do diretor; a rede visível aparece normalmente', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1()] });

    await renderPage();

    expect(await screen.findByText('Victor Hugo')).toBeInTheDocument();
    expect(screen.getByText('Delta')).toBeInTheDocument();
    expect(screen.queryByText('Lendários')).not.toBeInTheDocument();
  });

  it('"Gerar relatório do dia" não inclui o nome da rede oculta', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1()] });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Delta');
    expect(textarea.value).not.toContain('Lendários');
  });
});

describe('RankingPage — controle de admin do botão Ocultar/Mostrar', () => {
  it('isAdmin:false — o botão Ocultar não aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    await renderPage();

    expect(await screen.findByText('Delta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Configurar diretores\/redes/ })).not.toBeInTheDocument();
  });

  it('isAdmin:true — o botão Ocultar aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    await renderPage();

    expect(await screen.findByText('Delta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
  });
});

describe('RankingPage — toggleRedeVisivel (clique em Ocultar, isAdmin:true)', () => {
  it('clicar em "Ocultar" chama atualizarRede com { visivel: false } e só atualiza o estado local após a promise resolver', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    let resolvePromise;
    cadastrosApi.atualizarRede.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(cadastrosApi.atualizarRede).toHaveBeenCalledWith(10, { visivel: false });
    expect(screen.getByText('Delta')).toBeInTheDocument();

    resolvePromise({ ...redeVisivel(), visivel: false });

    await waitFor(() => expect(screen.queryByText('Delta')).not.toBeInTheDocument());
  });

  it('se a promise rejeitar, o estado local NÃO muda e o flash de erro aparece', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });
    cadastrosApi.atualizarRede.mockRejectedValue(new Error('Falha simulada ao atualizar rede'));

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    await waitFor(() => expect(screen.getByText('Falha simulada ao atualizar rede')).toBeInTheDocument());
    expect(screen.getByText('Delta')).toBeInTheDocument();
  });
});

describe('RankingPage — ConfigView (tela "⚙ Configurar diretores/redes")', () => {
  it('isAdmin:true — rede oculta mostra "(oculta)" e o botão "Mostrar rede ... no relatório"; clicar chama atualizarRede com { visivel: true }', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1()] });
    cadastrosApi.atualizarRede.mockResolvedValue({ ...redeOculta(), visivel: true });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    expect(screen.getByText('(oculta)')).toBeInTheDocument();
    const mostrarBtn = screen.getByRole('button', { name: 'Mostrar rede Lendários no relatório' });
    expect(mostrarBtn).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar rede Delta no relatório' })).toBeInTheDocument();

    await user.click(mostrarBtn);

    expect(cadastrosApi.atualizarRede).toHaveBeenCalledWith(20, { visivel: true });
  });

  it('isAdmin:false — a ConfigView não é acessível (sem botão de navegação) e nenhum botão Ocultar/Mostrar existe em nenhum lugar', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1()] });

    await renderPage();

    expect(screen.queryByRole('button', { name: /Configurar diretores\/redes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mostrar rede/ })).not.toBeInTheDocument();
  });
});

describe('RankingPage — GG de rede (formato aninhado { id, nome }, rótulo visível trocado de "Responsável" para "GG")', () => {
  it('isAdmin:true — mostra um <select> com o GG atual selecionado e a lista de GGs cadastrados', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      diretores: [diretor1()],
      responsaveis: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Beto' }],
    });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    const selectAna = await screen.findByLabelText('GG da rede Delta');
    expect(selectAna.tagName).toBe('SELECT');
    expect(selectAna.value).toBe('1'); 

    const selectOculta = screen.getByLabelText('GG da rede Lendários');
    expect(selectOculta.value).toBe(''); 
  });

  it('isAdmin:true — trocar a seleção do <select> chama atualizarRede com { responsavelId } (number ou null)', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      diretores: [diretor1({ redes: [redeVisivel()] })],
      responsaveis: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Beto' }],
    });
    cadastrosApi.atualizarRede.mockResolvedValue({ ...redeVisivel(), responsavel: { id: 2, nome: 'Beto' } });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    const select = await screen.findByLabelText('GG da rede Delta');
    await user.selectOptions(select, '2');

    expect(cadastrosApi.atualizarRede).toHaveBeenCalledWith(10, { responsavelId: 2 });
  });

  it('isAdmin:true — selecionar "Nenhum" chama atualizarRede com { responsavelId: null }', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      diretores: [diretor1({ redes: [redeVisivel()] })],
      responsaveis: [{ id: 1, nome: 'Ana' }],
    });
    cadastrosApi.atualizarRede.mockResolvedValue({ ...redeVisivel(), responsavel: null });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    const select = await screen.findByLabelText('GG da rede Delta');
    await user.selectOptions(select, '');

    expect(cadastrosApi.atualizarRede).toHaveBeenCalledWith(10, { responsavelId: null });
  });

  it('isAdmin:false — a ConfigView não é acessível, então nenhum <select> de GG aparece fora dela', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [{ id: 1, nome: 'Ana' }] });

    await renderPage();

    expect(screen.queryByLabelText('GG da rede Delta')).not.toBeInTheDocument();
  });
});

describe('RankingPage — cadastro/remoção de GGs (seção "GGs" da ConfigView)', () => {
  it('isAdmin:true — lista os GGs cadastrados e permite cadastrar um novo', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [{ id: 1, nome: 'Ana' }] });
    cadastrosApi.criarResponsavel.mockResolvedValue({ id: 2, nome: 'Beto' });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    expect(await screen.findByRole('button', { name: 'Remover GG Ana' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Nome do GG'), 'Beto');
    await user.click(screen.getByRole('button', { name: 'Adicionar GG' }));

    expect(cadastrosApi.criarResponsavel).toHaveBeenCalledWith({ nome: 'Beto' });
    expect(await screen.findByRole('button', { name: 'Remover GG Beto' })).toBeInTheDocument();
  });

  it('isAdmin:true — não chama a API se o nome estiver vazio (validação no cliente)', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [] });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    await screen.findByText('Nenhum GG cadastrado ainda');
    await user.click(screen.getByRole('button', { name: 'Adicionar GG' }));

    expect(cadastrosApi.criarResponsavel).not.toHaveBeenCalled();
    expect(screen.getByText('Informe um nome para o GG.')).toBeInTheDocument();
  });

  it('isAdmin:true — remover um GG vinculado a uma rede (409) mostra a mensagem de erro da API e não some da lista', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [{ id: 1, nome: 'Ana' }] });
    cadastrosApi.removerResponsavel.mockRejectedValue(
      new Error('Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.')
    );

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    await screen.findByRole('button', { name: 'Remover GG Ana' });
    await user.click(screen.getByRole('button', { name: 'Remover GG Ana' }));

    expect(await screen.findByText(
      'Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover GG Ana' })).toBeInTheDocument();
  });

  it('isAdmin:true — remover um GG sem vínculo remove da lista sem esperar reload da página', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [{ id: 1, nome: 'Ana' }] });
    cadastrosApi.removerResponsavel.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    await screen.findByRole('button', { name: 'Remover GG Ana' });
    await user.click(screen.getByRole('button', { name: 'Remover GG Ana' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remover GG Ana' })).not.toBeInTheDocument());
    expect(cadastrosApi.removerResponsavel).toHaveBeenCalledWith(1);
  });

  it('isAdmin:false — a seção "GGs" não é renderizada', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })], responsaveis: [{ id: 1, nome: 'Ana' }] });

    await renderPage();

    expect(screen.queryByText('GGs')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nome do GG')).not.toBeInTheDocument();
  });
});

describe('RankingPage — POST /redes não envia responsavel (nasce sempre sem GG atribuído)', () => {
  it('addRede chama criarRede com { diretorId, nome, emoji }, sem campo de responsável no formulário de criação', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [] })], responsaveis: [] });
    cadastrosApi.criarRede.mockResolvedValue({
      id: 30, diretor_id: 1, nome: 'Rede Nova', emoji: '', ativo: true, visivel: true, responsavel: null,
    });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    expect(screen.queryByPlaceholderText('Responsável')).not.toBeInTheDocument();

    const selectDiretor = screen.getByLabelText('Diretor pai da nova rede');
    await user.selectOptions(selectDiretor, '1');
    await user.type(screen.getByPlaceholderText('Nome da rede (ex: Delta)'), 'Rede Nova');
    await user.click(screen.getByRole('button', { name: 'Adicionar rede' }));

    expect(cadastrosApi.criarRede).toHaveBeenCalledWith({ diretorId: 1, nome: 'Rede Nova', emoji: '' });
  });
});

describe('RankingPage — ordem fixa de categorias no relatório gerado (buildFullReport)', () => {
  const CATEGORIA_ACESSORIOS = { id: 3, nome: 'Acessórios', principal: false };
  const CATEGORIA_CORRECAO = { id: 2, nome: 'Correção', principal: false };
  const CATEGORIA_RECEITA_BRUTA = { id: 1, nome: 'Receita Bruta', principal: true };

  function mockDadosOrdenacao({ categorias, valoresPorCategoria }) {
    cadastrosApi.fetchDiretores.mockResolvedValue([diretor1({ redes: [redeVisivel()] })]);
    rankingApi.fetchCategorias.mockResolvedValue(categorias);
    rankingApi.fetchEntradas.mockImplementation((_data, catId) =>
      Promise.resolve(valoresPorCategoria[catId] || [])
    );
    cadastrosApi.fetchResponsaveis.mockResolvedValue([]);
  }

  it('"Gerar relatório do dia" mostra Receita Bruta antes de Acessórios mesmo lançando valor em Acessórios primeiro e com a API retornando as categorias fora de ordem', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosOrdenacao({
      categorias: [CATEGORIA_ACESSORIOS, CATEGORIA_CORRECAO, CATEGORIA_RECEITA_BRUTA],
      valoresPorCategoria: {
        [CATEGORIA_ACESSORIOS.id]: [{ rede_id: 10, valor: 30 }],
        [CATEGORIA_RECEITA_BRUTA.id]: [{ rede_id: 10, valor: 10 }],
      },
    });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    const texto = textarea.value;

    expect(texto).toContain('RECEITA BRUTA');
    expect(texto).toContain('ACESSÓRIOS');
    expect(texto).not.toContain('CORREÇÃO');
    expect(texto.indexOf('RECEITA BRUTA')).toBeLessThan(texto.indexOf('ACESSÓRIOS'));
  });

  it('uma categoria extra (ex.: "Seguros") aparece depois das 3 fixas, na ordem de criação', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    const CATEGORIA_SEGUROS = { id: 4, nome: 'Seguros', principal: false };
    mockDadosOrdenacao({
      categorias: [CATEGORIA_RECEITA_BRUTA, CATEGORIA_CORRECAO, CATEGORIA_ACESSORIOS, CATEGORIA_SEGUROS],
      valoresPorCategoria: {
        [CATEGORIA_RECEITA_BRUTA.id]: [{ rede_id: 10, valor: 10 }],
        [CATEGORIA_CORRECAO.id]: [{ rede_id: 10, valor: 20 }],
        [CATEGORIA_ACESSORIOS.id]: [{ rede_id: 10, valor: 30 }],
        [CATEGORIA_SEGUROS.id]: [{ rede_id: 10, valor: 40 }],
      },
    });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    const texto = textarea.value;

    const idxReceita = texto.indexOf('RECEITA BRUTA');
    const idxCorrecao = texto.indexOf('CORREÇÃO');
    const idxAcessorios = texto.indexOf('ACESSÓRIOS');
    const idxSeguros = texto.indexOf('SEGUROS');

    expect(idxReceita).toBeGreaterThanOrEqual(0);
    expect(idxCorrecao).toBeGreaterThanOrEqual(0);
    expect(idxAcessorios).toBeGreaterThanOrEqual(0);
    expect(idxSeguros).toBeGreaterThanOrEqual(0);
    expect(idxReceita).toBeLessThan(idxCorrecao);
    expect(idxCorrecao).toBeLessThan(idxAcessorios);
    expect(idxAcessorios).toBeLessThan(idxSeguros);
  });
});

describe('RankingPage — ocultar/desativar rede individualmente (Redes.ativo, grid principal)', () => {
  it('uma rede com ativo:false não aparece no grid nem conta no total do diretor', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosRedeInativa();

    await renderPage();

    expect(await screen.findByText('Rede Ativa')).toBeInTheDocument();
    expect(screen.queryByText('Rede Escondida')).not.toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
    expect(screen.queryByText('R$ 1.049,00')).not.toBeInTheDocument();
  });

  it('"Gerar relatório do dia" não inclui a rede inativa mesmo com valor lançado', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosRedeInativa();

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Rede Ativa');
    expect(textarea.value).not.toContain('Rede Escondida');
  });

  it('categoria fica de fora do relatório quando só a rede inativa tem valor lançado (rede inativa não conta como "preenchida")', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosRedeInativa({ valores: [{ rede_id: 301, valor: 999 }] }); 

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Nenhum dado preenchido ainda para');
  });
});

describe('RankingPage — parsing de valor BR no input de lançamento (parseValorBR)', () => {
  it('colar "1.730,00" (formato BR com milhar) soma o total corretamente como R$ 1.730,00, não R$ 1,73', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.paste('1.730,00');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ redeId: 10, valor: 1730 })
    ));
    expect(await screen.findByText('R$ 1.730,00')).toBeInTheDocument();
  });

  it('digitar manualmente "1730,50" continua funcionando (vírgula decimal sem separador de milhar)', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.type(input, '1730,50');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ redeId: 10, valor: 1730.5 })
    ));
    expect(await screen.findByText('R$ 1.730,50')).toBeInTheDocument();
  });

  it('colar um valor simples sem separador de milhar ("500,00") continua funcionando', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.paste('500,00');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ redeId: 10, valor: 500 })
    ));
    expect(await screen.findByText('R$ 500,00')).toBeInTheDocument();
  });
});

describe('RankingPage — ConfigView: botão Desativar/Reativar rede (Redes.ativo)', () => {
  it('isAdmin:false — nenhum botão Desativar/Reativar rede existe em lugar nenhum', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosRedeInativa();

    await renderPage();

    expect(screen.queryByRole('button', { name: /Desativar rede/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reativar rede/ })).not.toBeInTheDocument();
  });

  it('isAdmin:true — a rede inativa mostra o texto "(inativa)" e o botão "Reativar rede ..."', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosRedeInativa();

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    expect(screen.getByText('(inativa)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar rede Rede Escondida' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar rede Rede Ativa' })).toBeInTheDocument();
  });

  it('isAdmin:true — clicar em "Desativar rede ..." chama atualizarRede com { ativo: false } e só atualiza o estado local após a promise resolver', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosRedeInativa();

    let resolvePromise;
    cadastrosApi.atualizarRede.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    await user.click(screen.getByRole('button', { name: 'Desativar rede Rede Ativa' }));

    expect(cadastrosApi.atualizarRede).toHaveBeenCalledWith(300, { ativo: false });
    expect(screen.getByRole('button', { name: 'Desativar rede Rede Ativa' })).toBeInTheDocument();

    resolvePromise({ ...redeAtiva(), ativo: false });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reativar rede Rede Ativa' })).toBeInTheDocument());
  });

  it('se a promise rejeitar, o estado local NÃO muda e o flash de erro aparece', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosRedeInativa();
    cadastrosApi.atualizarRede.mockRejectedValue(new Error('Falha simulada ao atualizar rede'));

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));

    await user.click(screen.getByRole('button', { name: 'Desativar rede Rede Ativa' }));

    await waitFor(() => expect(screen.getByText('Falha simulada ao atualizar rede')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Desativar rede Rede Ativa' })).toBeInTheDocument();
  });
});

describe('RankingPage — polling automático de sincronização multi-usuário (a cada 5s)', () => {
  function armPolling() {
    fireEvent.click(screen.getByRole('button', { name: /Configurar diretores\/redes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao relatório/ }));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('atualiza o valor de uma rede não focada depois de ~5s quando o polling (fetchEntradas) retorna um valor novo', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    await renderPage();
    expect(await screen.findByPlaceholderText('0,00')).toHaveValue('50,00');

    vi.useFakeTimers();
    armPolling();

    rankingApi.fetchEntradas.mockResolvedValue([{ rede_id: 10, valor: 777 }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByPlaceholderText('0,00')).toHaveValue('777,00');
  });

  it('NÃO sobrescreve o valor do input atualmente focado, mesmo que o polling retorne um valor diferente do servidor', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    await renderPage();
    const input = await screen.findByPlaceholderText('0,00');

    vi.useFakeTimers();
    armPolling();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '123' } });

    rankingApi.fetchEntradas.mockResolvedValue([{ rede_id: 10, valor: 999 }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(input).toHaveValue('123');
  });

  it('pausa o polling quando a aba fica oculta (document.hidden) e retoma quando ela volta a ficar visível', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    await renderPage();

    vi.useFakeTimers();
    armPolling();
    rankingApi.fetchEntradas.mockClear();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(rankingApi.fetchEntradas).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(rankingApi.fetchEntradas).toHaveBeenCalled();
  });

  it('limpa o interval ao desmontar o componente (nenhuma chamada de polling depois do unmount)', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ diretores: [diretor1({ redes: [redeVisivel()] })] });

    const { unmount } = await renderPage();

    vi.useFakeTimers();
    armPolling();
    rankingApi.fetchEntradas.mockClear();

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(rankingApi.fetchEntradas).not.toHaveBeenCalled();
  });
});
