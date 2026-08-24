// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do módulo Controle de Ligações — Importação de
// contatos (CONTRATO-CONTROLE-LIGACOES-API.md, seção "Importação (v3)").
// `token` sempre passado explicitamente pelo componente chamador.
//
// v3: a escolha de número remetente por Estado deixou de acontecer aqui —
// passou a acontecer no Painel de Disparo, no momento do disparo. Isso
// eliminou o conceito de "lote pendente de confirmação": não existem mais
// `confirmarImportacao`/`fetchImportacoesPendentes` (as rotas que elas
// chamavam foram descontinuadas/removidas do router). Em vez disso, esta
// tela agora só sobe um arquivo e consulta o histórico completo de lotes.
import { apiRequest } from '../../../lib/apiClient.js';

// multipart/form-data — o campo é sempre "arquivo" (contrato v3, herdado da
// seção 9 v2). `apiClient.js` já sabe omitir o Content-Type fixo quando o
// body é FormData.
export function importarContatos(token, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);

  return apiRequest('/api/controle-ligacoes/contatos/importar', {
    method: 'POST',
    body: formData,
    token,
  });
}

// Lista todos os lotes de importação (não só pendentes — esse conceito não
// existe mais), mais recentes primeiro.
export function fetchHistoricoImportacoes(token) {
  return apiRequest('/api/controle-ligacoes/contatos/importar/historico', { token });
}

// Detalhe de um lote: mesmo resumo do histórico, mais `porEstado` e a lista
// de linhas rejeitadas (`erros`).
export function fetchDetalheImportacao(token, loteId) {
  return apiRequest(`/api/controle-ligacoes/contatos/importar/${loteId}`, { token });
}
