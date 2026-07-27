// Smoke test manual (NÃO Vitest, sem mocks) do módulo Cadastros, rodando
// contra o backend real em http://localhost:3000 + banco local
// erp-novagest-dev. Objetivo: validar ponta a ponta o fluxo
// Diretor -> Rede -> Loja -> GG depois da extração dessas rotas do módulo
// Ranking para /api/cadastros/* (ver CONTRATO-CADASTROS-API.md).
//
// Uso: node backend/scripts/smoke-test-cadastros.js
// Assume que o servidor já está rodando (npm run dev dentro de backend/).

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@novagest.com';
const ADMIN_SENHA = 'admin123';

const results = [];
let token = null;

// ids criados durante o teste, para a limpeza final
const created = { diretorId: null, redeId: null, lojaId: null, responsavelId: null };

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const status = ok ? 'PASSOU' : 'FALHOU';
  console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`);
}

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function main() {
  // 1. LOGIN
  const login = await call('POST', '/api/auth/login', { email: ADMIN_EMAIL, senha: ADMIN_SENHA });
  if (login.status !== 200 || !login.body?.token) {
    record('1. Login', false, `esperado 200 + token, recebido ${login.status} — ${JSON.stringify(login.body)}`);
    printFinalReport();
    process.exit(1);
  }
  token = login.body.token;
  record('1. Login', true, `usuario=${JSON.stringify(login.body.usuario)}`);

  // 2. CRIAR DIRETOR
  const diretor = await call('POST', '/api/cadastros/diretores', { nome: 'Diretor Teste QA' });
  const diretorOk = diretor.status === 201
    && diretor.body?.nome === 'Diretor Teste QA'
    && typeof diretor.body?.id === 'number'
    && diretor.body?.criado_em
    && Array.isArray(diretor.body?.redes)
    && diretor.body.redes.length === 0;
  if (diretorOk) created.diretorId = diretor.body.id;
  record('2. Criar Diretor', diretorOk, diretorOk
    ? `id=${diretor.body.id}`
    : `esperado 201 com {id, nome, criado_em, redes:[]}, recebido ${diretor.status} — ${JSON.stringify(diretor.body)}`);

  // 3. CRIAR REDE
  let rede = { status: null, body: null };
  if (created.diretorId) {
    rede = await call('POST', '/api/cadastros/redes', {
      diretorId: created.diretorId, nome: 'Rede Teste QA', emoji: '🧪',
    });
    const redeOk = rede.status === 201
      && rede.body?.diretor_id === created.diretorId
      && rede.body?.responsavel === null
      && (rede.body?.lojas === undefined || (Array.isArray(rede.body.lojas) && rede.body.lojas.length === 0));
    if (redeOk) created.redeId = rede.body.id;
    record('3. Criar Rede', redeOk, redeOk
      ? `id=${rede.body.id}`
      : `esperado 201 com diretor_id=${created.diretorId}, responsavel:null, recebido ${rede.status} — ${JSON.stringify(rede.body)}`);
  } else {
    record('3. Criar Rede', false, 'pulado — diretor do passo 2 não foi criado');
  }

  // 4. CRIAR LOJA
  let loja = { status: null, body: null };
  if (created.redeId) {
    loja = await call('POST', '/api/cadastros/lojas', { redeId: created.redeId, nome: 'Loja Teste QA' });
    const lojaOk = loja.status === 201
      && loja.body?.rede_id === created.redeId
      && loja.body?.ativo === true;
    if (lojaOk) created.lojaId = loja.body.id;
    record('4. Criar Loja', lojaOk, lojaOk
      ? `id=${loja.body.id}`
      : `esperado 201 com rede_id=${created.redeId}, ativo:true, recebido ${loja.status} — ${JSON.stringify(loja.body)}`);
  } else {
    record('4. Criar Loja', false, 'pulado — rede do passo 3 não foi criada');
  }

  // 5. CRIAR RESPONSAVEL (GG)
  const resp = await call('POST', '/api/cadastros/responsaveis', { nome: 'GG Teste QA' });
  const respOk = resp.status === 201 && typeof resp.body?.id === 'number' && resp.body?.nome === 'GG Teste QA';
  if (respOk) created.responsavelId = resp.body.id;
  record('5. Criar Responsavel (GG)', respOk, respOk
    ? `id=${resp.body.id}`
    : `esperado 201, recebido ${resp.status} — ${JSON.stringify(resp.body)}`);

  // 6. ATRIBUIR GG À REDE
  let atribuicao = { status: null, body: null };
  if (created.redeId && created.responsavelId) {
    atribuicao = await call('PUT', `/api/cadastros/redes/${created.redeId}`, { responsavelId: created.responsavelId });
    const atribuicaoOk = atribuicao.status === 200
      && atribuicao.body?.responsavel?.id === created.responsavelId
      && atribuicao.body?.responsavel?.nome === 'GG Teste QA';
    record('6. Atribuir GG à Rede', atribuicaoOk, atribuicaoOk
      ? `responsavel=${JSON.stringify(atribuicao.body.responsavel)}`
      : `esperado 200 com responsavel.id=${created.responsavelId}, recebido ${atribuicao.status} — ${JSON.stringify(atribuicao.body)}`);
  } else {
    record('6. Atribuir GG à Rede', false, 'pulado — rede ou GG anteriores não foram criados');
  }

  // 7. CONFERIR A ÁRVORE COMPLETA
  const diretores = await call('GET', '/api/cadastros/diretores');
  const diretorNaArvore = diretores.body?.find?.(d => d.id === created.diretorId);
  const redeNoDiretor = diretorNaArvore?.redes?.find(r => r.id === created.redeId);
  const arvoreDiretorOk = diretores.status === 200 && !!diretorNaArvore && !!redeNoDiretor;
  record('7a. GET /diretores — árvore aninhada', arvoreDiretorOk, arvoreDiretorOk
    ? `Diretor Teste QA encontrado com Rede Teste QA aninhada`
    : `esperado diretor id=${created.diretorId} com rede id=${created.redeId} aninhada, recebido status ${diretores.status} — diretor encontrado: ${JSON.stringify(diretorNaArvore)}`);

  const redes = await call('GET', '/api/cadastros/redes');
  const redeNaLista = redes.body?.find?.(r => r.id === created.redeId);
  const lojaNaRede = redeNaLista?.lojas?.find(l => l.id === created.lojaId);
  const arvoreRedeOk = redes.status === 200
    && !!redeNaLista
    && redeNaLista?.diretor?.id === created.diretorId
    && redeNaLista?.responsavel?.id === created.responsavelId
    && !!lojaNaRede;
  record('7b. GET /redes — diretor+responsavel+lojas aninhados', arvoreRedeOk, arvoreRedeOk
    ? `Rede Teste QA com diretor/responsavel/loja corretos`
    : `esperado rede id=${created.redeId} com diretor.id=${created.diretorId}, responsavel.id=${created.responsavelId}, loja id=${created.lojaId} em lojas[], recebido status ${redes.status} — rede encontrada: ${JSON.stringify(redeNaLista)}`);

  // 8. TESTAR BLOQUEIOS (409 esperado = sucesso do teste)
  let bloqueioRede = { status: null, body: null };
  if (created.redeId) {
    bloqueioRede = await call('DELETE', `/api/cadastros/redes/${created.redeId}`);
    const ok = bloqueioRede.status === 409;
    record('8a. DELETE Rede com Loja vinculada → 409', ok, ok
      ? `bloqueado corretamente: ${JSON.stringify(bloqueioRede.body)}`
      : `esperado 409, recebido ${bloqueioRede.status} — ${JSON.stringify(bloqueioRede.body)}`);
  } else {
    record('8a. DELETE Rede com Loja vinculada → 409', false, 'pulado — rede não foi criada');
  }

  let bloqueioDiretor = { status: null, body: null };
  if (created.diretorId) {
    bloqueioDiretor = await call('DELETE', `/api/cadastros/diretores/${created.diretorId}`);
    const ok = bloqueioDiretor.status === 409;
    record('8b. DELETE Diretor com Rede vinculada → 409', ok, ok
      ? `bloqueado corretamente: ${JSON.stringify(bloqueioDiretor.body)}`
      : `esperado 409, recebido ${bloqueioDiretor.status} — ${JSON.stringify(bloqueioDiretor.body)}`);
  } else {
    record('8b. DELETE Diretor com Rede vinculada → 409', false, 'pulado — diretor não foi criado');
  }

  let nomeDuplicado = { status: null, body: null };
  if (created.diretorId) {
    nomeDuplicado = await call('POST', '/api/cadastros/redes', {
      diretorId: created.diretorId, nome: 'Rede Teste QA', emoji: '🧪',
    });
    const ok = nomeDuplicado.status === 409;
    record('8c. POST Rede duplicada (mesmo nome+diretorId) → 409', ok, ok
      ? `bloqueado corretamente: ${JSON.stringify(nomeDuplicado.body)}`
      : `esperado 409, recebido ${nomeDuplicado.status} — ${JSON.stringify(nomeDuplicado.body)}`);
  } else {
    record('8c. POST Rede duplicada (mesmo nome+diretorId) → 409', false, 'pulado — diretor não foi criado');
  }

  // 9. LIMPEZA — nesta ordem: loja, rede, diretor, responsavel
  const leftoverIds = [];

  if (created.lojaId) {
    const del = await call('DELETE', `/api/cadastros/lojas/${created.lojaId}`);
    const ok = del.status === 204;
    record('9a. Limpeza — DELETE Loja', ok, ok ? `id=${created.lojaId} removida` : `status ${del.status} — ${JSON.stringify(del.body)}`);
    if (!ok) leftoverIds.push(`Loja id=${created.lojaId}`);
  } else {
    record('9a. Limpeza — DELETE Loja', false, 'pulado — loja não foi criada, nada a limpar');
  }

  if (created.redeId) {
    const del = await call('DELETE', `/api/cadastros/redes/${created.redeId}`);
    const ok = del.status === 204;
    record('9b. Limpeza — DELETE Rede', ok, ok ? `id=${created.redeId} removida` : `status ${del.status} — ${JSON.stringify(del.body)}`);
    if (!ok) leftoverIds.push(`Rede id=${created.redeId}`);
  } else {
    record('9b. Limpeza — DELETE Rede', false, 'pulado — rede não foi criada, nada a limpar');
  }

  if (created.diretorId) {
    const del = await call('DELETE', `/api/cadastros/diretores/${created.diretorId}`);
    const ok = del.status === 204;
    record('9c. Limpeza — DELETE Diretor', ok, ok ? `id=${created.diretorId} removido` : `status ${del.status} — ${JSON.stringify(del.body)}`);
    if (!ok) leftoverIds.push(`Diretor id=${created.diretorId}`);
  } else {
    record('9c. Limpeza — DELETE Diretor', false, 'pulado — diretor não foi criado, nada a limpar');
  }

  if (created.responsavelId) {
    const del = await call('DELETE', `/api/cadastros/responsaveis/${created.responsavelId}`);
    const ok = del.status === 204;
    record('9d. Limpeza — DELETE Responsavel (GG)', ok, ok ? `id=${created.responsavelId} removido` : `status ${del.status} — ${JSON.stringify(del.body)}`);
    if (!ok) leftoverIds.push(`Responsavel id=${created.responsavelId}`);
  } else {
    record('9d. Limpeza — DELETE Responsavel (GG)', false, 'pulado — GG não foi criado, nada a limpar');
  }

  if (leftoverIds.length > 0) {
    console.log('\n⚠️  ATENÇÃO: registros NÃO removidos, apague manualmente no banco local:');
    leftoverIds.forEach(id => console.log(`   - ${id}`));
  }

  printFinalReport();
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}

function printFinalReport() {
  console.log('\n===== RELATÓRIO FINAL =====');
  results.forEach(r => {
    console.log(`${r.ok ? 'PASSOU' : 'FALHOU'} — ${r.step}`);
  });
  const totalFail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - totalFail}/${results.length} passos OK.`);
}

main().catch(err => {
  console.error('Erro inesperado durante o smoke test:', err);
  printFinalReport();
  process.exit(1);
});
