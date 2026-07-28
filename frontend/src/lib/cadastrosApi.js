// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do módulo Cadastros (Diretor/Rede/Loja/Responsavel).
// Fica em src/lib (ao lado de apiClient.js) em vez de dentro de
// modulos/ranking ou modulos/margens porque é cadastro COMPARTILHADO entre
// os dois módulos de negócio (e qualquer módulo futuro) — ver
// CONTRATO-CADASTROS-API.md. Todas as rotas de /api/cadastros/* exigem
// autenticação (mesmo padrão de apiRequest usado por rankingApi.js).
import { apiRequest } from './apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchDiretores() {
  return request('/api/cadastros/diretores');
}

export function criarDiretor({ nome }) {
  return request('/api/cadastros/diretores', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function atualizarDiretor(id, { nome }) {
  return request(`/api/cadastros/diretores/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome }),
  });
}

export function removerDiretor(id) {
  return request(`/api/cadastros/diretores/${id}`, { method: 'DELETE' });
}

// GET /api/cadastros/redes — redes visíveis com diretor + responsável (GG) +
// lojas físicas aninhadas (usado pelo módulo Margens).
export function fetchRedes() {
  return request('/api/cadastros/redes');
}

export function criarRede({ diretorId, nome, emoji }) {
  return request('/api/cadastros/redes', {
    method: 'POST',
    body: JSON.stringify({ diretorId, nome, emoji }),
  });
}

export function atualizarRede(id, { nome, emoji, responsavelId, ativo, visivel, diretorId }) {
  return request(`/api/cadastros/redes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, emoji, responsavelId, ativo, visivel, diretorId }),
  });
}

export function removerRede(id) {
  return request(`/api/cadastros/redes/${id}`, { method: 'DELETE' });
}

export function criarLoja({ redeId, nome }) {
  return request('/api/cadastros/lojas', {
    method: 'POST',
    body: JSON.stringify({ redeId, nome }),
  });
}

// PUT é a única forma de "remover" uma loja da operação (ativo: false) — não existe
// rota DELETE para Loja (ver CONTRATO-CADASTROS-API.md, seção 11).
export function atualizarLoja(id, { nome, ativo, redeId }) {
  return request(`/api/cadastros/lojas/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, ativo, redeId }),
  });
}

export function fetchResponsaveis() {
  return request('/api/cadastros/responsaveis');
}

export function criarResponsavel({ nome }) {
  return request('/api/cadastros/responsaveis', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function removerResponsavel(id) {
  return request(`/api/cadastros/responsaveis/${id}`, { method: 'DELETE' });
}
