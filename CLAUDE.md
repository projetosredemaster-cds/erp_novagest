# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com código neste repositório.

## Visão geral do projeto

erp_Novagest é um ERP modular. Cada módulo de negócio é uma "tela" do sistema, mas **todos os módulos compartilham um único banco de dados Azure SQL e uma única API backend**. Não existe banco de dados por módulo — novos módulos adicionam tabelas/rotas à estrutura já existente. Hoje existem dois módulos de negócio: o **Ranking** (placar diário de vendas por rede — agrupadas por diretor —, com gerador de relatório pronto para WhatsApp) e o **Margens** (lançamento diário de margem de lucro por loja física, com resumo/relatório de período e exportação em PDF). Os dois consomem uma camada compartilhada de **Cadastros** (Diretor/Rede/Loja/Responsavel, sob `/api/cadastros/*`), que não tem tela própria — é CRUD comum reaproveitado pelos dois módulos de negócio (e por qualquer módulo futuro que precise da mesma hierarquia). Além disso, o sistema tem uma camada transversal de **autenticação + administração de usuários** (login, JWT, tela de gestão de usuários) que protege todos os módulos.

O repositório tem dois aplicativos independentes, sem ferramentas compartilhadas:
- `backend/` — API REST em Node.js/Express
- `frontend/` — SPA em React 19 + Vite

**Frontend e backend estão integrados.** `RankingPage.jsx` busca `diretores` (cada um com suas `redes[]` aninhadas), `categorias` e `entradas` via HTTP (helper em `frontend/src/modulos/ranking/rankingApi.js`) e persiste valores no `onBlur` de cada input — não há mais estado fictício inicial. O mesmo handler de blur (`onBlurSave`, em `RankingPage.jsx`) decide entre duas rotas conforme o valor digitado: `POST /api/ranking/entradas` (upsert) quando o valor é diferente de zero; `DELETE /api/ranking/entradas?data=...&categoriaId=...&redeId=...` (via `removerEntrada` em `rankingApi.js`) quando o valor é zero — para apagar de fato uma entrada salva anteriormente em vez de só deixar de persistir, evitando que o campo "volte" sozinho pro valor antigo depois de zerado de propósito. O contrato exato de cada rota (formato de request/response, status codes) está documentado em `CONTRATO-RANKING-API.md` na raiz do repo; consulte-o antes de mudar o formato de qualquer endpoint do Ranking. A URL base da API vem da variável de ambiente Vite `VITE_API_URL` (ver `frontend/.env.example`) — nunca hardcode a URL no componente.

**Hierarquia de dados do Ranking (v2 — Diretor > Rede).** O Ranking passou por uma mudança de arquitetura: a hierarquia era de 2 níveis (`Redes` > `Lojas`) e virou 3 níveis (`Diretores` > `Redes` > Loja física). O que antes era a tabela `Redes` (ex: "Rede V. Hugo") agora é `Diretores`; o que antes era `Lojas` (Delta, Lendários, Ouro...) agora é `Redes`. O Ranking **continua operando só no nível Diretor → Rede** — ele nunca lançou/lança valor por loja física; a tabela `Lojas` física existe no banco (módulo Margens) mas não é consumida por nenhuma rota do Ranking. Ver seção "Schema do Ranking" abaixo para os campos exatos de cada tabela após a migração.

Ao carregar a página (ou trocar a data), o frontend busca as entradas de **todas** as categorias em paralelo (`Promise.all`) e guarda tudo no estado `entries` — não busca sob demanda ao trocar de aba. Isso é proposital: garante que "Gerar relatório do dia" sempre reflita o que está salvo no banco, independente de quais categorias o usuário visitou na sessão. Ao mexer nesse fluxo, preserve esse comportamento (não volte a buscar só a categoria ativa).

A `ConfigView` de `RankingPage.jsx` (rotulada na tela como "Diretores e redes") faz CRUD real de **diretores e redes** contra o backend (`POST/PUT/DELETE /api/cadastros/diretores` e `/redes`, via `cadastrosApi.js` — ver módulo Cadastros abaixo): criar/editar só atualiza o estado local depois que a API confirma, usando o id real retornado; remover só some do estado local após a API confirmar. **Categorias continuam 100% local em memória** — não existe endpoint de escrita para elas ainda, então mudanças em categorias se perdem ao recarregar (isso sim é esperado, não é bug).

`Redes` (o nível Delta/Lendários, filho de um Diretor) tem campos `visivel` e `ativo` (ambos BIT, default `1`) persistidos no banco — `Diretores` não tem nenhum dos dois. Uma rede com `visivel=false` some do grid principal (filtrada do array antes do `.map`, não `display:none`, para o grid CSS reajustar sozinho) e é excluída de `buildFullReport`; `ativo=false` é o soft-delete real (ver seção de exclusão abaixo). Os dois são controles **separados** na `ConfigView` ("Ocultar/Mostrar" para `visivel`, "Desativar/Reativar" para `ativo`) — decisão intencional, não é duplicação acidental. O toggle "Ocultar/Mostrar" só é renderizado quando `isAdmin === true` (via `AuthContext`), e mora em cada **linha de Rede** dentro do card do relatório (não mais no cabeçalho do card, que agora representa um Diretor sem campo `visivel` próprio) — mas essa restrição existe **só no frontend**: `PUT /api/cadastros/redes/:id` não tem `adminMiddleware` nem qualquer checagem de admin no backend (roda só com `authMiddleware`, igual ao resto de `/api/cadastros`), então qualquer usuário autenticado que chame a rota diretamente (curl/Postman) pode alterar `visivel`/`nome`/`emoji`/`ativo`/`responsavelId` de qualquer rede. Ao mexer nessa rota, não presuma que existe uma trava de admin no backend só porque a UI esconde o botão.

**Cadastros é uma camada compartilhada, sem tela própria.** `Diretor > Rede > Loja` (mais `Responsavel`, rotulado "GG" na UI) não pertence a nenhum módulo de negócio — o CRUD inteiro vive em `/api/cadastros/*` e é consumido tanto pela `ConfigView` de `RankingPage.jsx` (CRUD de Diretor/Rede) quanto por `MargensPage.jsx` (só leitura, `fetchRedes()`, pra montar o `<select>` de Rede/Loja do lançamento). No frontend, o helper fica em `frontend/src/lib/cadastrosApi.js`, ao lado de `apiClient.js` — não dentro de `modulos/ranking/` ou `modulos/margens/` — justamente por ser compartilhado. Esse módulo nasceu de uma extração: o CRUD de Diretor/Rede/Responsavel vivia antes em `/api/ranking/*` (ver nota de migração no topo de `CONTRATO-RANKING-API.md`). Ver seção "Arquitetura" abaixo pro CRUD completo, as regras de exclusão e o módulo Responsaveis.

**Margens é o segundo módulo de negócio** (`MargensPage.jsx`, duas views internas: "Lançamento", padrão, e "Relatório de período"). O modelo de dados tem uma pegadinha: `faturamento` e `custoProduto` (custo geral de produtos) são valores **consolidados da franquia inteira** — o mesmo número vale pra todas as lojas naquele dia, editáveis a qualquer momento na view de Lançamento, sem conceito de "confirmado". O único valor específico de cada loja é `totalTar` (taxa de cartão daquela unidade), e é isso que faz a margem de cada loja ser diferente das outras no mesmo dia. Ao confirmar uma loja (`POST /api/margens/entradas`), o backend grava esse `totalTar` **junto com uma cópia (snapshot)** do faturamento/custoProduto consolidados usados naquele momento — histórico intencional, pra sobreviver a mudanças futuras nesses valores sem reescrever o cálculo de lançamentos já confirmados (ver schema de `MargensEntradas` abaixo). Na tela, uma loja já confirmada no dia mostra o campo `totalTar` desabilitado com um selo "✓ Confirmado" e um botão "Editar" pra reabilitar; o botão "Confirmar" de uma loja ainda não confirmada só fica habilitado depois que o usuário digita algo no campo (mesmo "0" conta como valor informado, mas o campo nunca começa preenchido com "0,00" por padrão) — trava de UX proposital pra evitar confirmar margem calculada em cima de `totalTar` vazio por acidente. `GET /api/margens/relatorio?dataInicio=&dataFim=` soma o período por loja e calcula `lucro`/`percentualMargem`/`cor` (`>=41%` verde, `>=40%` amarelo, senão vermelho) agrupado Diretor→Rede→Lojas; os filtros de Rede/Cor/nome de loja na tela de relatório são aplicados 100% no frontend sobre esse resultado já buscado (mesmo princípio do Ranking, evita ida e volta ao servidor a cada filtro trocado). "Baixar PDF" usa `jsPDF`+`jspdf-autotable` inteiramente no navegador, sem rota nova no backend. Contrato completo em `CONTRATO-MARGENS-API.md` — consulte-o antes de mudar o formato de qualquer endpoint do Margens.

`buildFullReport` (dentro de `RankingPage.jsx`) monta o texto de "Gerar relatório do dia" iterando **todos** os diretores e, dentro de cada um, **todas** as categorias (não só a aba ativa) e omite por completo qualquer categoria sem nenhum valor lançado; dentro de cada categoria incluída, também omite diretores sem nenhuma rede preenchida e, dentro de cada diretor, redes individuais sem valor (não aparecem como linha zerada) — e sempre respeita `visivel`/`ativo` das redes (não existe mais filtro no nível Diretor). Cada bloco de categoria tem cabeçalho em maiúsculas com o nome da categoria (`*RELATÓRIO <NOME> — DD/MM*`), inclusive a categoria principal, para deixar clara a separação entre categorias ao colar no WhatsApp.

**Autenticação é obrigatória para todo o sistema.** Login é por e-mail/senha (`POST /api/auth/login`) contra a tabela `Usuarios` já existente no banco (bcrypt para hash/verificação de senha), retornando um JWT (`JWT_SECRET`, expira em 12h) que o frontend guarda via `frontend/src/app/authStorage.js` e usa em todo request subsequente (header `Authorization: Bearer <token>`, injetado automaticamente por `frontend/src/lib/apiClient.js`). Todas as rotas de `/api/ranking/*`, `/api/cadastros/*` e `/api/margens/*` exigem sessão válida (`authMiddleware` aplicado no mount, em `app.js`, não rota a rota) — apenas `POST /api/auth/login` é pública; `GET /api/auth/me` exige login mas não admin. A gestão de usuários (`/api/admin/usuarios`, CRUD só de listar/criar/excluir — sem editar) exige além disso ser admin (`adminMiddleware`, checa `req.usuario.isAdmin`). O contrato completo (payloads, status codes, mensagens de erro exatas) está em `CONTRATO-AUTH-API.md` na raiz do repo; consulte-o antes de mudar qualquer coisa relacionada a login/token/usuários. No frontend, `AuthContext.jsx` centraliza sessão/login/logout, `RequireAuth.jsx`/`RequireAdmin.jsx` protegem rotas em `AppRoutes.jsx`, e um 401 vindo de **qualquer** chamada de API dispara logout global + redirecionamento para `/login` (`authEvents.js`) — não implemente tratamento de 401 module a module.

## Comandos

Execute a partir de dentro de `backend/` ou `frontend/`, conforme o caso (não há um `package.json` na raiz do repositório).

### Backend (`backend/`)
- `npm run dev` — inicia a API com nodemon (recarregamento automático), lê o `.env`
- `npm start` — inicia a API sem recarregamento automático
- `npm run test:db` — testa a conexão com o Azure SQL usando as credenciais do `.env` (`src/scripts/testConnection.js`)
- `npm test` — roda a suíte Vitest (`vitest run`); config em `vitest.config.js`/`vitest.setup.js`, testes com Supertest cobrindo controllers/services do Ranking e do Margens (`ranking.controller.test.js`, `ranking.service.test.js`, `margens.controller.test.js`) — usam mock do model, nunca tocam o Azure SQL real (ver nota no topo de `ranking.controller.test.js` sobre por que é CJS puro em vez de `import`, mesmo padrão seguido em `margens.controller.test.js`). Cadastros ainda não tem suíte própria.
- Ainda não há linter configurado no backend.

### Frontend (`frontend/`)
- `npm run dev` — servidor de desenvolvimento Vite (HMR)
- `npm run build` — build de produção
- `npm run lint` — ESLint
- `npm run preview` — preview de um build de produção
- `npm test` — roda a suíte Vitest (`vitest run`) com React Testing Library + `jsdom` (config em `vitest.config.js`); cobre `RankingPage.test.jsx` e `MargensPage.test.jsx`.

## Arquitetura

### Backend: em camadas, uma pasta por camada (ainda não por módulo)

```
backend/src/
├── app.js              # App Express: middlewares globais, monta os routers /api/<modulo>, 404 + tratamento de erro
├── server.js            # ponto de entrada, carrega o .env, sobe o listener HTTP
├── config/db.js          # singleton de ConnectionPool do mssql (getPool()), lê as variáveis de ambiente DB_*
├── middlewares/
│   ├── authMiddleware.js   # valida JWT (header Authorization: Bearer <token>), popula req.usuario = { id, email, isAdmin }
│   └── adminMiddleware.js  # roda depois do authMiddleware; 403 se req.usuario.isAdmin !== true
├── routes/<modulo>.routes.js   # auth, admin, ranking, cadastros, margens
├── controllers/<modulo>.controller.js
├── services/<modulo>.service.js  # ver observação abaixo
├── models/<modulo>.model.js
└── scripts/testConnection.js
```

O fluxo de requisição segue estritamente `routes → controller → service → model`:
- **routes** — apenas mapeia verbo HTTP + caminho para uma função do controller.
- **controller** — interpreta/valida o `req`, chama o service, formata a resposta HTTP (status codes, corpo `{ "error": "..." }` em caso de falha). Sem SQL, sem lógica de negócio.
- **service** — lógica de negócio; agnóstico a framework (sem `req`/`res`), delega o acesso a dados ao model.
- **model** — a única camada que fala com o banco de dados, via o pool compartilhado do `mssql` em `config/db.js`. Toda query é parametrizada com `request.input(...)` — nunca concatene entrada do usuário em string SQL. Upserts usam `MERGE` dentro de uma transação (ver `ranking.model.js: upsertEntrada`).

Novos módulos são montados em `app.js` como `app.use('/api/<modulo>', <modulo>Routes)`, ao lado dos mounts já existentes `/api/ranking`, `/api/cadastros`, `/api/margens`, `/api/auth` e `/api/admin`. Proteção de autenticação/autorização é aplicada de duas formas diferentes hoje, e ambas são válidas — escolha conforme o caso: `/api/ranking`, `/api/cadastros` e `/api/margens` recebem `authMiddleware` **no próprio mount** em `app.js` (ex.: `app.use('/api/margens', authMiddleware, margensRoutes)`, protege o router inteiro de uma vez); `/api/auth` e `/api/admin` aplicam `authMiddleware`/`adminMiddleware` **dentro do próprio router**, rota a rota, porque misturam rotas públicas (`POST /api/auth/login`) com protegidas no mesmo arquivo. Um módulo novo 100% protegido pode seguir o padrão do Ranking/Cadastros/Margens (middleware no mount); um módulo com rotas públicas e protegidas deve seguir o padrão de `auth.routes.js`. Existe hoje um terceiro caso híbrido dentro do próprio `cadastros.routes.js` (migrado de `ranking.routes.js` — ver módulo Cadastros abaixo): a maioria das rotas herda só o `authMiddleware` do mount, mas `POST /responsaveis` e `DELETE /responsaveis/:id` aplicam `adminMiddleware` adicionalmente **na própria rota** — ou seja, mount-level auth não impede reforçar uma rota específica com uma checagem extra dentro do mesmo router.

**Observação:** `.claude/agents/backend-architect.md` e `.claude/skiils/backend-conventions/SKILL.md` descrevem uma estrutura de pastas por módulo (`src/modulos/<modulo>/{controller,routes,service,model}.js`). O código atual usa, em vez disso, pastas planas `routes/`, `controllers/`, `models/`, `middlewares/` — `services/` existe como pasta plana também, com `ranking.service.js`, `auth.service.js`, `usuario.service.js`, `cadastros.service.js`, `margens.service.js` e `brevoEmail.service.js` (este último não corresponde a um módulo de rota, é acesso a serviço externo — ver seção do Brevo abaixo). Siga as regras de camadas (routes → controller → service → model, queries parametrizadas) independentemente de qual estrutura física de pastas você adotar; se for iniciar um novo módulo de negócio, pergunte se deve manter a estrutura plana atual ou migrar para a estrutura baseada em módulos descrita nos documentos dos agentes.

Schema de Cadastros (compartilhado — Diretor/Rede/Loja/Responsavel, já existe no banco, dono é `/api/cadastros/*`, não recrie, evolua via migrations se necessário):
- `Diretores` (id, nome, criado_em) — antes era a tabela `Redes`; perdeu `responsavel_id`/`visivel` na migração pro schema v2 (migraram para o novo nível `Redes` abaixo).
- `Redes` (id, diretor_id → FK Diretores [renomeado de `rede_id`], nome, emoji, ativo, visivel, responsavel_id → FK Responsaveis, criado_em) — antes era a tabela `Lojas`; ganhou `responsavel_id`/`visivel`, que antes viviam no nível que hoje é `Diretores`. Nível Delta/Lendários/Destemidos, filho de um Diretor.
- `Lojas` (id, rede_id → FK Redes, nome, ativo, criado_em) — loja física (ex: "SLZ 01"), consumida hoje só pelo módulo Margens; o Ranking não opera nesse nível, nunca lançou/lança valor por loja física.
- `Responsaveis` (id, nome, criado_em) — vínculo (`responsavel_id`) é com `Redes`, não com `Diretores` nem `Lojas` (ver módulo Responsaveis abaixo). Na UI, o rótulo visível "Responsável" virou **"GG"** (ex.: label do `<select>`, "sem GG", título de seção "GGs") — é só texto de interface; `responsavelId`/`responsavel_id` e os nomes de função (`fetchResponsaveis`/`criarResponsavel`/`removerResponsavel`) continuam exatamente iguais.

Schema do Ranking (Categorias/Entradas, dono é `/api/ranking/*` — o resto da hierarquia antiga migrou pra Cadastros acima):
- `Categorias` (id, nome, principal, criado_em) — sem mudança.
- `Entradas` (id, data_ref, categoria_id → FK Categorias, rede_id → FK Redes [renomeado de `loja_id`], valor, atualizado_em; UNIQUE em data_ref+categoria_id+rede_id).

Schema do Margens (dono é `/api/margens/*`):
- `MargensEntradas` (id, data_ref, loja_id → FK Lojas, faturamento, franquia, custos, cartoes, despesas, atualizado_em; UNIQUE em data_ref+loja_id) — apesar do nome das colunas, `faturamento`/`custos` guardam um **snapshot** dos valores consolidados da franquia no momento da confirmação (não um valor específico da loja); só `cartoes` (mapeado como `totalTar` na API) é de fato específico da loja. `franquia`/`despesas` sempre `0` na versão atual — colunas mantidas no schema (reaproveitadas do desenho antigo da tabela, de antes da mudança pra valores consolidados) mas não usadas. Ver `CONTRATO-MARGENS-API.md` (v4) pro porquê desse mapeamento e a fórmula de cálculo.

Schema de autenticação (já existe no banco — não recrie a tabela nem insira um novo usuário admin manualmente, já existe um cadastrado):
- `Usuarios` (id, email, senha_hash, is_admin, criado_em). `senha_hash` nunca é incluído em nenhuma resposta HTTP, em nenhuma rota. Não há endpoint para editar usuário nem para promover/rebaixar admin — só listar, criar (sempre `is_admin = 0`) e excluir; auto-exclusão é bloqueada com `409`.

Os nomes de coluna em `ranking.model.js` (Entradas/Categorias), `cadastros.model.js` (Diretores/Redes/Lojas/Responsaveis) e `margens.model.js` (MargensEntradas) já foram **validados contra o schema real do banco local** (`erp-novagest-dev`, via `INFORMATION_SCHEMA.COLUMNS` e/ou exercitando as rotas de fato) — não é mais necessário revisá-los por padrão. Essa validação foi feita só no banco local; não presuma automaticamente que o Azure SQL de produção já recebeu a mesma migração de schema (incluindo a tabela `MargensEntradas`, que é nova) sem confirmar antes de um deploy.

CRUD completo de Diretor/Rede/Loja (`POST/PUT/DELETE /api/cadastros/diretores`, `/redes` e `/lojas`) vive em `/api/cadastros/*` (migrado de `/api/ranking/*` — ver nota de migração no topo de `CONTRATO-RANKING-API.md`) e está documentado em `CONTRATO-CADASTROS-API.md`, seções 1–11. Decisões de exclusão sem cascata, testadas contra o Azure SQL local:
- **Diretor**: `DELETE` bloqueia com `409` se houver qualquer rede vinculada (`Redes.diretor_id`, mesmo inativa/oculta) — sem cascata, para não apagar histórico de `Entradas` em silêncio.
- **Rede**: `DELETE` bloqueia com `409` se houver qualquer **Loja** física vinculada (`Lojas.rede_id`, checada primeiro) **ou** qualquer `Entrada` do Ranking vinculada (`Entradas.rede_id`); a forma de "remover" uma rede com histórico é soft-delete via `PUT` com `{ ativo: false }`, reaproveitando a coluna `ativo` já existente no schema. Sem nenhum dos dois vínculos, o delete físico é permitido.
- **Loja**: `DELETE` bloqueia com `409` se houver qualquer `MargensEntradas` vinculada; mesmo soft-delete via `PUT { ativo: false }`.
- `DELETE /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X&redeId=Y` (seção 4 de `CONTRATO-RANKING-API.md`) remove a entrada de uma combinação pontual (data, categoria, rede) — é o que o `onBlur` do frontend chama quando o usuário zera um campo (ver acima). É **idempotente** (sempre `204`, exista ou não a linha) e, diferente de `DELETE /api/cadastros/redes/:id`/`diretores/:id`/`lojas/:id`, não tem bloqueio de conflito. Isso não muda a exclusão de **Rede**: por ser uma exclusão pontual (uma combinação por vez), uma rede com histórico em outras datas/categorias normalmente ainda terá `Entradas` vinculadas e continuará bloqueada por `409`, só podendo ser desativada via `PUT { ativo: false }` em `/api/cadastros/redes/:id`.

**Módulo Responsaveis** (seções 12–14 de `CONTRATO-CADASTROS-API.md`): pessoas responsáveis por uma rede deixaram de ser texto livre e viraram uma entidade própria. `GET/POST /api/cadastros/responsaveis` e `DELETE /api/cadastros/responsaveis/:id` fazem o CRUD (sem `PUT`/edição); `GET` roda só com o `authMiddleware` do mount, mas `POST` e `DELETE` também exigem `adminMiddleware`. `DELETE` bloqueia com `409` se qualquer `Redes.responsavel_id` ainda apontar para aquele responsável — mesma lógica sem cascata usada em Diretores/Redes/Lojas. O vínculo é com **Rede** (Delta, Lendários...), não com Diretor — na migração v1→v2 esse vínculo estava em `Diretores.responsavel_id` (quando essa tabela ainda se chamava `Redes`) e migrou junto com o rename para o novo nível `Redes`. `POST /api/cadastros/redes` não aceita o campo `responsavelId` na criação (toda rede nasce com `responsavel: null`); a atribuição é feita depois via `PUT /api/cadastros/redes/:id` com `{ responsavelId: <id> }` (ou `{ responsavelId: null }` para desatribuir). Em `GET/POST/PUT /api/cadastros/redes`, `rede.responsavel` é um objeto `{ id, nome }` ou `null` — não string. No frontend, o cabeçalho do card de cada **Diretor** em `RankingPage.jsx` mostra só `diretor.nome` puro (Diretor não tem campo `responsavel`/GG); o responsável (rotulado "GG" na UI) aparece em cada **linha de Rede**, dentro do card do Ranking e na `ConfigView` — comportamento intencional, não é bug.

**Módulo Margens** (`/api/margens/*`, documentado em `CONTRATO-MARGENS-API.md` v4): dono só da tabela `MargensEntradas` — não duplica CRUD de Loja/Rede/Diretor/Responsavel (isso é do módulo Cadastros); `margens.model.js` faz suas próprias queries de JOIN de **leitura** direto contra `Lojas`/`Redes`/`Diretores`/`Responsaveis` (não chama `cadastros.model.js`) só pra montar o relatório agrupado e validar a existência de `lojaId` no upsert. `POST /api/margens/entradas` faz upsert (`MERGE`) por `(data, lojaId)`, sempre gravando `franquia=0`/`despesas=0`/`custos=custoProduto`/`cartoes=totalTar` (ver schema de `MargensEntradas` acima e a pegadinha do snapshot documentada na Visão Geral).

Variáveis de ambiente obrigatórias (ver `backend/.env.example`): `PORT`, `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `JWT_SECRET` (segredo de assinatura dos tokens JWT, nunca versionado), `BREVO_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_REMETENTE_NOME`, `EMAIL_DESTINATARIOS` (envio de relatório por e-mail, ver abaixo), `NODE_ENV` e `FRONTEND_URL` (controlam a allowlist de CORS, ver abaixo). `getPool()` em `config/db.js` lança erro imediatamente se alguma variável `DB_*` estiver ausente, e reseta a promise da pool em cache em caso de falha de conexão, para que a próxima chamada possa tentar novamente.

**Segurança de borda é aplicada globalmente em `app.js`, antes de qualquer rota.** `helmet()` roda com configuração padrão. O CORS é restrito por allowlist: se `NODE_ENV=production`, só `FRONTEND_URL` é aceito; fora de produção, `http://localhost:5173` (porta padrão do Vite) é sempre aceito além de `FRONTEND_URL`. `POST /api/auth/login` tem rate limit dedicado via `express-rate-limit` (10 tentativas por IP a cada 15 minutos, `429` com corpo `{ "error": "..." }` ao estourar) — aplicado como `app.use('/api/auth/login', loginLimiter)` **antes** do mount de `authRoutes` em `app.js`, não dentro de `auth.routes.js`. Nenhuma outra rota tem rate limit hoje.

`POST /api/ranking/relatorio/email` (protegida por `authMiddleware`, igual ao resto de `/api/ranking`) envia o texto do relatório do dia por e-mail via API transacional do Brevo (`https://api.brevo.com/v3/smtp/email`). `backend/src/services/brevoEmail.service.js` é uma camada de acesso a serviço externo com o mesmo papel que um model tem para o banco (não conhece `req`/`res`, só monta a chamada HTTP e propaga o erro do Brevo) — `ranking.service.js`/`ranking.controller.js` chamam essa função como fariam com qualquer outro service. Erros retornados pelo Brevo viram `502`; validação de `texto` ausente vira `400`. No frontend, `rankingApi.js` expõe `enviarRelatorioPorEmail`, chamada a partir de `RankingPage.jsx` junto do fluxo de "Gerar relatório do dia". Contrato completo (payload, status codes) na seção 11 de `CONTRATO-RANKING-API.md`.

### Frontend: o registro de módulos comanda rotas + navegação

```
frontend/src/
├── app/
│   ├── AppShell.jsx        # layout: Sidebar + <Outlet/>
│   ├── Sidebar.jsx          # renderiza os links de navegação a partir do moduleRegistry
│   └── moduleRegistry.js    # fonte única de verdade dos módulos
├── routes/AppRoutes.jsx     # monta as entradas <Route> a partir do moduleRegistry
├── lib/
│   ├── apiClient.js         # fetch com Authorization + tratamento de 401 global
│   └── cadastrosApi.js      # CRUD de Diretor/Rede/Loja/Responsavel — compartilhado, não pertence a um módulo
└── modulos/<modulo>/         # hoje: ranking, margens, admin (usuarios), auth
    ├── <Modulo>Page.jsx
    └── <modulo>Api.js        # helper de fetch isolado da UI, só do que é exclusivo do módulo (ver rankingApi.js/margensApi.js)
```

Para adicionar uma nova tela de módulo: crie `modulos/<modulo>/<Modulo>Page.jsx` e adicione uma entrada em `moduleRegistry.js` (`{ id, label, path, icon, element }`) — hoje tem três: `ranking`, `margens`, `usuarios` (este último `adminOnly`). `Sidebar` e `AppRoutes` leem esse array — nada mais precisa mudar para ganhar um link de navegação + rota. `icon` é uma **string simples** (emoji, ex.: `'📊'`), renderizada como texto puro em `Sidebar.jsx` (`<span>{mod.icon}</span>`) — não é um componente de ícone (não há `lucide-react` nem equivalente instalado no projeto); `element` é a referência ao componente (`MargensPage`, não `<MargensPage/>`), instanciado por `AppRoutes.jsx`. Um módulo pode opcionalmente ter `adminOnly: true` (ver o módulo `usuarios`) — isso faz `Sidebar.jsx` nunca renderizar o link para usuário não-admin (não é só CSS escondido) e `AppRoutes.jsx` envolver a rota com `<RequireAdmin/>`, bloqueando acesso direto pela URL.

Chamadas de API ficam isoladas num arquivo `<modulo>Api.js` ao lado da página (ex.: `rankingApi.js`, `margensApi.js`), usando `fetch` nativo (sem axios) e `import.meta.env.VITE_API_URL` como base — não chame `fetch` direto de dentro do componente. A exceção é cadastro compartilhado (Diretor/Rede/Loja/Responsavel): fica em `frontend/src/lib/cadastrosApi.js`, ao lado de `apiClient.js`, por não pertencer a um módulo de negócio específico (ver módulo Cadastros na Visão Geral). Variável de ambiente obrigatória (ver `frontend/.env.example`): `VITE_API_URL`.

### Estilo: Tailwind é o padrão do projeto; MUI só quando compensa

Tailwind CSS v4 (config em `index.css` via `@theme`/variáveis CSS em `:root`, ex.: `--bg`, `--panel`, `--teal` — sem `tailwind.config.js`) é o sistema de estilo padrão para todas as telas, inclusive telas que replicam um visual de protótipo já existente (reproduza com classes Tailwind/valores arbitrários, sem criar um arquivo `.css` separado). O MUI (`@mui/material`) fica reservado para casos em que um componente pronto e complexo compensa o custo (`DataGrid`, `DatePicker`, `Autocomplete`, `Dialog` complexo).

**Regra rígida, aplicada em todo o projeto (`.claude/skiils/frontend-conventions/SKILL.md`):** nunca misture MUI e Tailwind no mesmo componente/elemento — nada de classes Tailwind em componentes MUI, nem `sx` + `className` no mesmo elemento. Cada arquivo tem um único dono de estilo; declare isso com um comentário no topo: `// style-system: MUI` ou `// style-system: Tailwind` (ver início de `RankingPage.jsx`).

## Subagentes e skills

Este repositório define subagentes específicos do projeto em `.claude/agents/` e skills em `.claude/skiils/` (note que a pasta se chama `skiils`, não `skills`):
- `agent-organizer` — orquestra tarefas que tocam mais de uma camada (ex.: endpoint novo + a tela que o consome), dividindo o trabalho entre os demais subagentes.
- `backend-architect` — especialista em Node/Express/Azure SQL; cuida de routes/controllers/services/models.
- `frontend-developer` — especialista em React; cuida de componentes/telas, aplicando a divisão MUI/Tailwind acima.
- `qa-tester` (arquivo `.claude/agents/test-engineer.md` — nome do arquivo ficou desatualizado; o agente é invocado pelo `name:` do frontmatter, que é `qa-tester`) — especialista em QA; escreve testes automatizados, roda validações manuais possíveis e dá veredito de "pronto para produção" ou não. Deve ser acionado como última fase depois que `backend-architect`/`frontend-developer` terminam uma feature nova. Vitest/Supertest (backend) e Vitest/React Testing Library (frontend) já estão instalados e configurados (ver seção Comandos, `npm test` em cada app) — este agente deve estender essa suíte existente para features novas, não presumir que precisa introduzir a infraestrutura do zero. (O texto interno do próprio `test-engineer.md` ainda afirma que essa infraestrutura de testes não existe — está desatualizado/contradiz este parágrafo; corrija se for editar esse arquivo.)

As skills `backend-conventions`, `frontend-conventions` e `testing-conventions` valem mesmo fora desses subagentes — ou seja, em qualquer edição direta de arquivo de backend, `.jsx`, ou ao escrever testes.

REGRA DE SEGURANÇA: nenhum subagente deve editar backend/.env, rodar
migrations, ou executar qualquer comando que se conecte a um banco fora
de localhost, sem pedir confirmação explícita ao usuário antes. Toda
alteração de schema/dados deve ser feita e validada primeiro no banco
local (erp-novagest-dev).
