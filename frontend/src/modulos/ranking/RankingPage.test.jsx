// Testes de componente (Vitest + React Testing Library) da feature "ocultar
// rede" em RankingPage.jsx. `rankingApi.js` e `AuthContext.jsx` são
// totalmente mockados — nenhuma chamada de rede real acontece aqui.
//
// Cobre:
//  - uma rede com visivel:false não aparece no grid principal (nó ausente
//    do DOM, não escondido via CSS);
//  - "Gerar relatório do dia" não inclui o nome da rede oculta;
//  - isAdmin:false esconde o botão Ocultar/Mostrar em todos os lugares;
//  - isAdmin:true: clicar em "Ocultar" chama atualizarRede com
//    { visivel: false } e só atualiza o estado local após a promise
//    resolver; se a promise rejeitar, o estado local não muda e o flash de
//    erro aparece.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingPage from './RankingPage.jsx';

vi.mock('./rankingApi', () => ({
  fetchRedes: vi.fn(),
  fetchCategorias: vi.fn(),
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
  criarRede: vi.fn(),
  atualizarRede: vi.fn(),
  removerRede: vi.fn(),
  criarLoja: vi.fn(),
  removerLoja: vi.fn(),
  atualizarLoja: vi.fn(),
  enviarRelatorioPorEmail: vi.fn(),
  fetchResponsaveis: vi.fn(),
  criarResponsavel: vi.fn(),
  removerResponsavel: vi.fn(),
}));

vi.mock('../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as rankingApi from './rankingApi';
import { useAuth } from '../../app/AuthContext.jsx';

const CATEGORIA_PRINCIPAL = { id: 1, nome: 'Vendas', principal: true };

function redeVisivel() {
  return {
    id: 10,
    nome: 'Rede Visível',
    responsavel: { id: 1, nome: 'Ana' },
    visivel: true,
    lojas: [{ id: 100, nome: 'Loja A', emoji: '🏆' }],
  };
}

function redeOculta() {
  return {
    id: 20,
    nome: 'Rede Oculta',
    responsavel: null,
    visivel: false,
    lojas: [{ id: 200, nome: 'Loja B', emoji: '🥈' }],
  };
}

// rede visível com uma loja ativa e uma loja oculta (Lojas.ativo:false) — usada
// para cobrir a feature "ocultar/mostrar loja individualmente".
function redeComLojaOculta() {
  return {
    id: 30,
    nome: 'Rede Mista',
    responsavel: null,
    visivel: true,
    lojas: [
      { id: 300, nome: 'Loja Ativa', emoji: '🏆', ativo: true },
      { id: 301, nome: 'Loja Escondida', emoji: '🥈', ativo: false },
    ],
  };
}

function mockDadosLojaOculta({ valores } = {}) {
  rankingApi.fetchRedes.mockResolvedValue([redeComLojaOculta()]);
  rankingApi.fetchCategorias.mockResolvedValue([CATEGORIA_PRINCIPAL]);
  rankingApi.fetchEntradas.mockResolvedValue(
    valores || [
      { loja_id: 300, valor: 50 },
      { loja_id: 301, valor: 999 },
    ]
  );
  rankingApi.fetchResponsaveis.mockResolvedValue([]);
}

function mockDadosIniciais({ redes, responsaveis }) {
  rankingApi.fetchRedes.mockResolvedValue(redes);
  rankingApi.fetchCategorias.mockResolvedValue([CATEGORIA_PRINCIPAL]);
  rankingApi.fetchEntradas.mockResolvedValue([
    { loja_id: 100, valor: 50 },
  ]);
  rankingApi.fetchResponsaveis.mockResolvedValue(responsaveis || []);
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
  it('uma rede com visivel:false não tem nenhum nó no grid principal; a rede visível aparece normalmente', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    await renderPage();

    // título do card é sempre "Rede " + responsavel.nome (não mais rede.nome estático)
    expect(await screen.findByText('Rede Ana')).toBeInTheDocument();
    expect(screen.queryByText('Rede Oculta')).not.toBeInTheDocument();
    expect(screen.queryByText('Loja B')).not.toBeInTheDocument();
  });

  it('rede visível sem responsável atribuído mostra o título "Rede sem responsável"', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosLojaOculta(); // redeComLojaOculta(): visivel:true, responsavel:null

    await renderPage();

    expect(await screen.findByText('Rede sem responsável')).toBeInTheDocument();
  });

  it('"Gerar relatório do dia" não inclui o nome da rede oculta', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Rede Visível');
    expect(textarea.value).not.toContain('Rede Oculta');
  });
});

describe('RankingPage — controle de admin do botão Ocultar/Mostrar', () => {
  it('isAdmin:false — o botão Ocultar não aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();

    expect(await screen.findByText('Rede Ana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    // a ConfigView também não é acessível: sem o botão de navegação para admin
    expect(screen.queryByRole('button', { name: /Configurar redes\/lojas/ })).not.toBeInTheDocument();
  });

  it('isAdmin:true — o botão Ocultar aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();

    expect(await screen.findByText('Rede Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
  });
});

describe('RankingPage — toggleRedeVisivel (clique em Ocultar, isAdmin:true)', () => {
  it('clicar em "Ocultar" chama atualizarRede com { visivel: false } e só atualiza o estado local após a promise resolver', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    let resolvePromise;
    rankingApi.atualizarRede.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(10, { visivel: false });
    // ainda não resolveu: a rede continua visível no grid
    expect(screen.getByText('Rede Ana')).toBeInTheDocument();

    resolvePromise({ ...redeVisivel(), visivel: false });

    await waitFor(() => expect(screen.queryByText('Rede Ana')).not.toBeInTheDocument());
  });

  it('se a promise rejeitar, o estado local NÃO muda e o flash de erro aparece', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });
    rankingApi.atualizarRede.mockRejectedValue(new Error('Falha simulada ao atualizar rede'));

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    await waitFor(() => expect(screen.getByText('Falha simulada ao atualizar rede')).toBeInTheDocument());
    // a rede continua visível no grid — estado local não mudou
    expect(screen.getByText('Rede Ana')).toBeInTheDocument();
  });
});

describe('RankingPage — ConfigView (tela "⚙ Configurar redes/lojas")', () => {
  it('isAdmin:true — rede oculta mostra o texto "(oculta do relatório)" e o botão "Mostrar"; clicar chama atualizarRede com { visivel: true }', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });
    rankingApi.atualizarRede.mockResolvedValue({ ...redeOculta(), visivel: true });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    expect(screen.getByText('(oculta do relatório)')).toBeInTheDocument();
    const mostrarBtn = screen.getByRole('button', { name: 'Mostrar' });
    expect(mostrarBtn).toBeInTheDocument();
    // a rede visível, na mesma tela, mostra "Ocultar" (não "Mostrar")
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();

    await user.click(mostrarBtn);

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(20, { visivel: true });
  });

  it('isAdmin:false — a ConfigView não é acessível (sem botão de navegação) e nenhum botão Ocultar/Mostrar existe em nenhum lugar', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    await renderPage();

    expect(screen.queryByRole('button', { name: /Configurar redes\/lojas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostrar' })).not.toBeInTheDocument();
  });
});

describe('RankingPage — responsável de rede (formato aninhado { id, nome })', () => {
  it('isAdmin:true — mostra um <select> com o responsável atual selecionado e a lista de responsáveis cadastrados', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      redes: [redeVisivel(), redeOculta()],
      responsaveis: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Beto' }],
    });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    const selectAna = await screen.findByLabelText('Responsável por Rede Visível');
    expect(selectAna.tagName).toBe('SELECT');
    expect(selectAna.value).toBe('1'); // rede.responsavel = { id: 1, nome: 'Ana' }

    const selectOculta = screen.getByLabelText('Responsável por Rede Oculta');
    expect(selectOculta.value).toBe(''); // rede.responsavel = null -> opção "Nenhum"
  });

  it('isAdmin:true — trocar a seleção do <select> chama atualizarRede com { responsavelId } (number ou null)', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      redes: [redeVisivel()],
      responsaveis: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Beto' }],
    });
    rankingApi.atualizarRede.mockResolvedValue({ ...redeVisivel(), responsavel: { id: 2, nome: 'Beto' } });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    const select = await screen.findByLabelText('Responsável por Rede Visível');
    await user.selectOptions(select, '2');

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(10, { responsavelId: 2 });
  });

  it('isAdmin:true — selecionar "Nenhum" chama atualizarRede com { responsavelId: null }', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({
      redes: [redeVisivel()],
      responsaveis: [{ id: 1, nome: 'Ana' }],
    });
    rankingApi.atualizarRede.mockResolvedValue({ ...redeVisivel(), responsavel: null });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    const select = await screen.findByLabelText('Responsável por Rede Visível');
    await user.selectOptions(select, '');

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(10, { responsavelId: null });
  });

  it('isAdmin:false — a ConfigView não é acessível, então nenhum <select> de responsável nem texto de responsável aparecem fora dela', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [{ id: 1, nome: 'Ana' }] });

    await renderPage();

    expect(screen.queryByLabelText('Responsável por Rede Visível')).not.toBeInTheDocument();
  });
});

describe('RankingPage — cadastro/remoção de Responsáveis (seção "Responsáveis" da ConfigView)', () => {
  it('isAdmin:true — lista os responsáveis cadastrados e permite cadastrar um novo', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [{ id: 1, nome: 'Ana' }] });
    rankingApi.criarResponsavel.mockResolvedValue({ id: 2, nome: 'Beto' });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    expect(await screen.findByRole('button', { name: 'Remover responsável Ana' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Nome do responsável'), 'Beto');
    await user.click(screen.getByRole('button', { name: 'Adicionar responsável' }));

    expect(rankingApi.criarResponsavel).toHaveBeenCalledWith({ nome: 'Beto' });
    expect(await screen.findByRole('button', { name: 'Remover responsável Beto' })).toBeInTheDocument();
  });

  it('isAdmin:true — não chama a API se o nome estiver vazio (validação no cliente)', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [] });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    await screen.findByText('Nenhum responsável cadastrado ainda');
    await user.click(screen.getByRole('button', { name: 'Adicionar responsável' }));

    expect(rankingApi.criarResponsavel).not.toHaveBeenCalled();
    expect(screen.getByText('Informe um nome para o responsável.')).toBeInTheDocument();
  });

  it('isAdmin:true — remover um responsável vinculado a uma rede (409) mostra a mensagem de erro da API e não some da lista', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [{ id: 1, nome: 'Ana' }] });
    rankingApi.removerResponsavel.mockRejectedValue(
      new Error('Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.')
    );

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    await screen.findByRole('button', { name: 'Remover responsável Ana' });
    await user.click(screen.getByRole('button', { name: 'Remover responsável Ana' }));

    expect(await screen.findByText(
      'Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover responsável Ana' })).toBeInTheDocument();
  });

  it('isAdmin:true — remover um responsável sem vínculo remove da lista sem esperar reload da página', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [{ id: 1, nome: 'Ana' }] });
    rankingApi.removerResponsavel.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    await screen.findByRole('button', { name: 'Remover responsável Ana' });
    await user.click(screen.getByRole('button', { name: 'Remover responsável Ana' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remover responsável Ana' })).not.toBeInTheDocument());
    expect(rankingApi.removerResponsavel).toHaveBeenCalledWith(1);
  });

  it('isAdmin:false — a seção "Responsáveis" não é renderizada', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()], responsaveis: [{ id: 1, nome: 'Ana' }] });

    await renderPage();

    expect(screen.queryByText('Responsáveis')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nome do responsável')).not.toBeInTheDocument();
  });
});

describe('RankingPage — POST /redes não envia mais responsavel', () => {
  it('addRede chama criarRede só com { nome }, sem campo de responsável no formulário de criação', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [], responsaveis: [] });
    rankingApi.criarRede.mockResolvedValue({ id: 30, nome: 'Rede Nova', responsavel: null, visivel: true, lojas: [] });

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    expect(screen.queryByPlaceholderText('Responsável')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Nome da rede (ex: Rede Fulano)'), 'Rede Nova');
    await user.click(screen.getByRole('button', { name: 'Adicionar rede' }));

    expect(rankingApi.criarRede).toHaveBeenCalledWith({ nome: 'Rede Nova' });
  });
});

describe('RankingPage — ordem fixa de categorias no relatório gerado (buildFullReport)', () => {
  // categorias retornadas pela API deliberadamente FORA da ordem fixa esperada no
  // relatório (Acessórios primeiro, Receita Bruta por último) — buildFullReport deve
  // reordenar só o texto do relatório, sem tocar em config.categorias/abas.
  const CATEGORIA_ACESSORIOS = { id: 3, nome: 'Acessórios', principal: false };
  const CATEGORIA_CORRECAO = { id: 2, nome: 'Correção', principal: false };
  const CATEGORIA_RECEITA_BRUTA = { id: 1, nome: 'Receita Bruta', principal: true };

  function mockDadosOrdenacao({ categorias, valoresPorCategoria }) {
    rankingApi.fetchRedes.mockResolvedValue([redeVisivel()]);
    rankingApi.fetchCategorias.mockResolvedValue(categorias);
    rankingApi.fetchEntradas.mockImplementation((_data, catId) =>
      Promise.resolve(valoresPorCategoria[catId] || [])
    );
    rankingApi.fetchResponsaveis.mockResolvedValue([]);
  }

  it('"Gerar relatório do dia" mostra Receita Bruta antes de Acessórios mesmo lançando valor em Acessórios primeiro e com a API retornando as categorias fora de ordem', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosOrdenacao({
      // ordem retornada pela API: Acessórios, Correção, Receita Bruta (invertida)
      categorias: [CATEGORIA_ACESSORIOS, CATEGORIA_CORRECAO, CATEGORIA_RECEITA_BRUTA],
      valoresPorCategoria: {
        // lançado em Acessórios primeiro (proposital), depois em Receita Bruta
        [CATEGORIA_ACESSORIOS.id]: [{ loja_id: 100, valor: 30 }],
        [CATEGORIA_RECEITA_BRUTA.id]: [{ loja_id: 100, valor: 10 }],
        // Correção sem nenhum valor lançado -> seção omitida (comportamento já existente)
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
        [CATEGORIA_RECEITA_BRUTA.id]: [{ loja_id: 100, valor: 10 }],
        [CATEGORIA_CORRECAO.id]: [{ loja_id: 100, valor: 20 }],
        [CATEGORIA_ACESSORIOS.id]: [{ loja_id: 100, valor: 30 }],
        [CATEGORIA_SEGUROS.id]: [{ loja_id: 100, valor: 40 }],
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

describe('RankingPage — ocultar loja individualmente (Lojas.ativo, grid principal)', () => {
  it('uma loja com ativo:false não aparece no grid nem conta no total da rede', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosLojaOculta();

    await renderPage();

    expect(await screen.findByText('Loja Ativa')).toBeInTheDocument();
    expect(screen.queryByText('Loja Escondida')).not.toBeInTheDocument();
    // total da rede deve refletir só a loja ativa (50), não a soma com a oculta (999)
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
    expect(screen.queryByText('R$ 1.049,00')).not.toBeInTheDocument();
  });

  it('"Gerar relatório do dia" não inclui a loja oculta mesmo com valor lançado', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosLojaOculta();

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Loja Ativa');
    expect(textarea.value).not.toContain('Loja Escondida');
  });

  it('categoria fica de fora do relatório quando só a loja oculta tem valor lançado (loja oculta não conta como "preenchida")', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosLojaOculta({ valores: [{ loja_id: 301, valor: 999 }] }); // só a loja oculta tem valor

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
    mockDadosIniciais({ redes: [redeVisivel()] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.paste('1.730,00');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ lojaId: 100, valor: 1730 })
    ));
    expect(await screen.findByText('R$ 1.730,00')).toBeInTheDocument();
  });

  it('digitar manualmente "1730,50" continua funcionando (vírgula decimal sem separador de milhar)', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.type(input, '1730,50');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ lojaId: 100, valor: 1730.5 })
    ));
    expect(await screen.findByText('R$ 1.730,50')).toBeInTheDocument();
  });

  it('colar um valor simples sem separador de milhar ("500,00") continua funcionando', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()] });
    rankingApi.salvarEntrada.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByPlaceholderText('0,00');
    await user.clear(input);
    await user.paste('500,00');
    await user.tab();

    await waitFor(() => expect(rankingApi.salvarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ lojaId: 100, valor: 500 })
    ));
    expect(await screen.findByText('R$ 500,00')).toBeInTheDocument();
  });
});

describe('RankingPage — ConfigView: botão Ocultar/Mostrar loja (Lojas.ativo)', () => {
  it('isAdmin:false — nenhum botão Ocultar/Mostrar loja existe em lugar nenhum', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosLojaOculta();

    await renderPage();

    expect(screen.queryByRole('button', { name: /Ocultar loja/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mostrar loja/ })).not.toBeInTheDocument();
  });

  it('isAdmin:true — a loja oculta mostra o texto "(oculta)" e o botão "Mostrar loja"', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosLojaOculta();

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    expect(screen.getByText('(oculta)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar loja Loja Escondida' })).toBeInTheDocument();
    // a loja ativa, na mesma rede, mostra "Ocultar loja ..." (não "Mostrar loja ...")
    expect(screen.getByRole('button', { name: 'Ocultar loja Loja Ativa' })).toBeInTheDocument();
  });

  it('isAdmin:true — clicar em "Ocultar loja" chama atualizarLoja com { ativo: false } e só atualiza o estado local após a promise resolver', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosLojaOculta();

    let resolvePromise;
    rankingApi.atualizarLoja.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    await user.click(screen.getByRole('button', { name: 'Ocultar loja Loja Ativa' }));

    expect(rankingApi.atualizarLoja).toHaveBeenCalledWith(300, { ativo: false });
    // ainda não resolveu: o botão continua no estado "Ocultar loja"
    expect(screen.getByRole('button', { name: 'Ocultar loja Loja Ativa' })).toBeInTheDocument();

    resolvePromise({ id: 300, nome: 'Loja Ativa', emoji: '🏆', ativo: false });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mostrar loja Loja Ativa' })).toBeInTheDocument());
  });

  it('se a promise rejeitar, o estado local NÃO muda e o flash de erro aparece', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosLojaOculta();
    rankingApi.atualizarLoja.mockRejectedValue(new Error('Falha simulada ao atualizar loja'));

    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    await user.click(screen.getByRole('button', { name: 'Ocultar loja Loja Ativa' }));

    await waitFor(() => expect(screen.getByText('Falha simulada ao atualizar loja')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Ocultar loja Loja Ativa' })).toBeInTheDocument();
  });
});

describe('RankingPage — polling automático de sincronização multi-usuário (a cada 5s)', () => {
  // Os timers fake precisam estar instalados ANTES de o setInterval do polling ser
  // criado, senão o intervalo real já agendado no primeiro mount não é afetado pelo
  // avanço de tempo fake. Por isso cada teste: 1) renderiza e espera a carga inicial
  // com timers reais (via renderPage(), que já usa waitFor normalmente); 2) instala
  // vi.useFakeTimers(); 3) alterna currentView 'report' -> 'config' -> 'report'
  // (usando o botão de admin) só para forçar o efeito de polling a limpar o interval
  // real antigo e recriar um novo já sob os timers fake — sem isso o teste não
  // conseguiria "adiantar" o polling.
  function armPolling() {
    fireEvent.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao relatório/ }));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('atualiza o valor de uma loja não focada depois de ~5s quando o polling (fetchEntradas) retorna um valor novo', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();
    expect(await screen.findByPlaceholderText('0,00')).toHaveValue('50');

    vi.useFakeTimers();
    armPolling();

    rankingApi.fetchEntradas.mockResolvedValue([{ loja_id: 100, valor: 777 }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByPlaceholderText('0,00')).toHaveValue('777');
  });

  it('NÃO sobrescreve o valor do input atualmente focado, mesmo que o polling retorne um valor diferente do servidor', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();
    const input = await screen.findByPlaceholderText('0,00');

    vi.useFakeTimers();
    armPolling();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '123' } });

    rankingApi.fetchEntradas.mockResolvedValue([{ loja_id: 100, valor: 999 }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(input).toHaveValue('123');
  });

  it('pausa o polling quando a aba fica oculta (document.hidden) e retoma quando ela volta a ficar visível', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

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
    mockDadosIniciais({ redes: [redeVisivel()] });

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
