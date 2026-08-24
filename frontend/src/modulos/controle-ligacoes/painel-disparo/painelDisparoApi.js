// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do Painel de Disparo (CONTRATO-CONTROLE-LIGACOES-API.md,
// seções 12 a 14 — adendo "Painel de Disparo (v3)"). Fica dentro de
// modulos/controle-ligacoes/painel-disparo por ser exclusivo desta tela,
// mesmo padrão de controleLigacoesConfigApi.js/importacaoApi.js. `token` é
// sempre passado explicitamente pelo componente chamador (via
// `useAuth().token`).
import { apiRequest } from '../../../lib/apiClient.js';

// Monta a query string a partir de um objeto de filtros genérico — hoje só
// `busca`/`ordem` (seção 13 do contrato), mas pensado para crescer (ex.:
// filtro futuro de status de pipeline) sem precisar reescrever a assinatura
// da função ou do chamador. Chaves ausentes/vazias/nulas são omitidas.
function buildFiltrosQuery(filtros = {}) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    params.set(chave, valor);
  });
  return params.toString();
}

// `cache: 'no-store'` nas duas leituras abaixo: dados do Painel de Disparo
// mudam a cada poucos segundos (fila de contatos disponíveis, status de
// conexão) — não devem ser servidos do cache HTTP do navegador (evita
// receber uma resposta 304/stale que não reflita o estado atual). Opção só
// deste módulo, `apiRequest` continua sem cache explícito por padrão para
// qualquer outro `<modulo>Api.js`.
export function fetchPainelDisparo(token) {
  return apiRequest('/api/controle-ligacoes/painel-disparo', { token, cache: 'no-store' });
}

export function fetchContatosDisponiveis(token, estadoId, filtros = {}) {
  const query = buildFiltrosQuery(filtros);
  return apiRequest(
    `/api/controle-ligacoes/estados/${estadoId}/contatos-disponiveis${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

// Só verifica (não grava nada) — usada antes de criarDisparo, para o
// fluxo em 2 passos do Painel de Disparo: primeiro checa se algum contato
// selecionado já foi contatado nos últimos 3 dias, sem persistir nada;
// o disparo de fato só é gravado se o usuário confirmar mesmo com aviso,
// ou automaticamente quando não há nenhum aviso (ver PainelDisparoPage.jsx).
export function verificarDisparo(token, { estadoId, numeroRemetenteId, contatoIds }) {
  return apiRequest('/api/controle-ligacoes/disparos/verificar', {
    method: 'POST',
    body: JSON.stringify({ estadoId, numeroRemetenteId, contatoIds }),
    token,
  });
}

export function criarDisparo(token, { estadoId, numeroRemetenteId, contatoIds }) {
  return apiRequest('/api/controle-ligacoes/disparos', {
    method: 'POST',
    body: JSON.stringify({ estadoId, numeroRemetenteId, contatoIds }),
    token,
  });
}
