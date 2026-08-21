// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do módulo Controle de Ligações — Estados e Números
// Remetentes (CONTRATO-CONTROLE-LIGACOES-API.md, seções 3 a 8). Fica dentro
// de modulos/controle-ligacoes/configuracoes por ser exclusivo deste módulo
// isolado (diferente de cadastrosApi.js, que é compartilhado entre módulos
// do ERP normal). `token` é sempre passado explicitamente pelo componente
// chamador (via `useAuth().token`), mesmo padrão de authApi.js/UsuariosPage.
import { apiRequest } from '../../../lib/apiClient.js';

export function fetchEstados(token) {
  return apiRequest('/api/controle-ligacoes/estados', { token });
}

export function criarEstado(token, { nome, uf, ddds }) {
  return apiRequest('/api/controle-ligacoes/estados', {
    method: 'POST',
    body: JSON.stringify({ nome, uf, ddds }),
    token,
  });
}

export function fetchNumerosRemetentes(token) {
  return apiRequest('/api/controle-ligacoes/numeros-remetentes', { token });
}

export function criarNumeroRemetente(token, { apelido, estadoId }) {
  return apiRequest('/api/controle-ligacoes/numeros-remetentes', {
    method: 'POST',
    body: JSON.stringify({ apelido, estadoId }),
    token,
  });
}

// Atualização parcial (seção 7 do contrato): envia só os campos informados.
export function atualizarNumeroRemetente(token, id, { apelido, estadoId, ativo } = {}) {
  const body = {};
  if (apelido !== undefined) body.apelido = apelido;
  if (estadoId !== undefined) body.estadoId = estadoId;
  if (ativo !== undefined) body.ativo = ativo;

  return apiRequest(`/api/controle-ligacoes/numeros-remetentes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    token,
  });
}

export function removerNumeroRemetente(token, id) {
  return apiRequest(`/api/controle-ligacoes/numeros-remetentes/${id}`, { method: 'DELETE', token });
}
