# Contrato da API — Controle de Ligações / Reativação de Clientes (erp_Novagest) — v2 (DRAFT)

> Este documento é o contrato a ser seguido por quem for implementar o módulo
> novo de **Reativação de Clientes** — escrito **antes** do código, seguindo
> o mesmo padrão dos demais `CONTRATO-*-API.md` do projeto. Nenhuma destas
> rotas existe ainda.
>
> **v2 substitui a v1** — o desenho de "DDD vinculado direto a um número" foi
> abandonado. O modelo real é **Estado → N números remetentes ativos**, com a
> distribuição de contatos feita **manualmente pela Lívia, por Estado, a cada
> importação** (não é mais automática por DDD).
>
> **v2 = escopo ainda reduzido, por decisão do usuário.** Este documento
> cobre: (1) autenticação com o papel `operador_cobranca` e o formulário de
> login alternativo, (2) cadastro de `Estados` + `NumerosRemetentes` numa
> única tela do módulo Configurações, e (3) importação de contatos via
> planilha (`NOME`/`CONTATO`) com distribuição manual por Estado, em outro
> módulo separado.
>
> **Fora de escopo deste v2** (registrado, não implementar agora): Central de
> Mensagens (Baileys) e a conexão de fato via QR Code — os números nascem com
> `status_conexao = 'aguardando_conexao'` e ficam assim até essa fase futura;
> disparo em massa; pipeline de atendimento (`não
> atendido`/`atendido`/`perdido`/`agendado`); handoff IA→Lívia; integração
> com Gemini; agendamentos (calendário/kanban). Não projete o schema deste v2
> de um jeito que dificulte adicionar isso depois (ver nota no final).

## Contexto e decisões de design

- **Risco operacional aceito, registrado formalmente**: a integração de
  mensageria (fora de escopo deste v2, mas já decidida para o projeto) usará
  **Baileys**, biblioteca não-oficial do protocolo WhatsApp Web. Isso implica
  risco real de banimento de número por detecção de automação. Decisão do
  usuário: seguir mesmo assim.
- **Novo papel de usuário — `operador_cobranca`**: `Usuarios` ganha a coluna
  `role` (`'admin'` | `'usuario'` | `'operador_cobranca'`), convivendo com
  `is_admin` (que não é removido nem recalculado). Migration já aplicada no
  banco local nesta fase anterior do projeto.
- **Isolamento de login nas duas direções**: `POST /api/auth/login` rejeita
  `role = 'operador_cobranca'` (`403`); `POST /api/auth/reativacao/login`
  (rota nova) aceita **só** `role = 'operador_cobranca'` (`403` para
  qualquer outro role). Um admin não acessa o módulo de Reativação; a Lívia
  não acessa o resto do ERP.
- **Estados são um cadastro próprio, não mais "DDD solto por número"**: os 6
  estados iniciais (Rondônia, Sergipe, Alagoas, Ceará, Piauí, Maranhão) são
  semeados no banco, cada um com seus DDDs oficiais. A tela permite cadastrar
  Estados novos depois, inline, sem sair da tela de Números Remetentes (ver
  seção 5).
- **Um Estado pode ter vários números remetentes ativos ao mesmo tempo**
  (decisão confirmada — ex.: Maranhão pode crescer e ganhar um segundo
  número, os dois ativos juntos). Isso significa que **não existe mais
  atribuição automática de contato por DDD** — a atribuição de número é
  sempre uma escolha humana, feita no momento da importação (ver seção 8).
- **DDD → Estado continua 1:1** (um DDD pertence a no máximo um Estado,
  reforçado no schema com `UNIQUE`), mas **Estado → Número é 1:N** (um
  Estado pode ter vários números).
- **QR Code / conexão Baileys**: um número remetente nasce sempre com
  `status_conexao = 'aguardando_conexao'` e sem `numero` preenchido. A
  conexão de verdade (gerar QR, escanear, confirmar) é uma fase futura que
  não faz parte deste contrato — o botão "Conectar WhatsApp" pode aparecer
  desabilitado/placeholder na tela desta fase.
- **Importação em duas etapas, com escolha manual por Estado**: o upload da
  planilha não atribui número nenhum sozinho. Ele só lê, valida, agrupa por
  Estado (via DDD) e devolve um resumo. A Lívia então escolhe, **por
  Estado presente naquele lote**, qual dos números ativos daquele Estado
  recebe os contatos — só depois dessa confirmação os contatos ganham
  `numero_remetente_id`. Contato com DDD sem Estado correspondente cai em
  "Sem Estado" e fica de fora da distribuição.
- **Lote não confirmado fica pendente indefinidamente** — sem expiração
  automática, sem job de limpeza. Fica visível como pendência na tela até
  alguém voltar e confirmar.
- **Duplicidade de telefone é bloqueada globalmente**: `Contatos.telefone`
  tem `UNIQUE` no banco inteiro (não só dentro de um lote). Um telefone que já
  existe de uma importação anterior (confirmada ou não) não gera um segundo
  registro — a linha nova é contada em `total_duplicado` e descartada; o
  registro já existente (mais antigo) é o que prevalece, sem atualização de
  nome/estado/lote.
- **Planilha de entrada**: exatamente duas colunas, `NOME` e `CONTATO`
  (case-insensitive), `CONTATO` já incluindo o código do país (formato real
  observado: `55` + DDD (2 dígitos) + número, ex. `5598984761733`). A tela de
  importação exibe essa expectativa de formato como dica visível antes do
  upload.
- **Tela única em Configurações** (decisão confirmada com o usuário,
  diferente do rascunho anterior que separava Estado e Número em abas): uma
  única tela "Números Remetentes" lista os números cadastrados e permite
  criar/editar/desativar/excluir; o cadastro de um Estado novo acontece
  **inline**, dentro do próprio formulário de número (um link "Cadastrar
  novo estado" que expande um mini-formulário nome/UF/DDDs, sem navegação),
  não como uma tela CRUD separada de Estados.
- **Formato de erro padrão**: igual ao resto da API — `{ "error": "mensagem" }`.

## Schema novo

### Alteração em `Usuarios` (já aplicada em fase anterior)
```sql
ALTER TABLE Usuarios ADD role VARCHAR(30) NOT NULL DEFAULT 'usuario';
UPDATE Usuarios SET role = 'admin'   WHERE is_admin = 1;
UPDATE Usuarios SET role = 'usuario' WHERE is_admin = 0;
```

### `Estados`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `nome` | nvarchar(100) | ex. "Maranhão" |
| `uf` | char(2) | único, ex. "MA" |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

Seed inicial: Rondônia (RO), Sergipe (SE), Alagoas (AL), Ceará (CE), Piauí
(PI), Maranhão (MA).

### `EstadoDDDs`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `estado_id` | int, FK `Estados` | — |
| `ddd` | char(2) | **UNIQUE** globalmente — um DDD pertence a no máximo um Estado |

Seed inicial (DDDs oficiais dos 6 estados): RO=69; SE=79; AL=82; CE=85,88;
PI=86,89; MA=98,99.

### `NumerosRemetentes`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `estado_id` | int, FK `Estados` | um Estado pode ter vários números (1:N) |
| `apelido` | nvarchar(100) | nome de exibição, ex. "CDC Cohatrac" |
| `numero` | varchar(20), nullable | só preenchido quando a conexão Baileys for implementada (fase futura) |
| `status_conexao` | varchar(30), default `'aguardando_conexao'` | valores esperados nesta fase: só `'aguardando_conexao'`; `'conectado'`/`'desconectado'` são alcançáveis apenas na fase futura do Baileys |
| `ativo` | bit, default 1 | só números ativos aparecem como opção na tela de importação |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

### `LotesImportacao`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `nome_arquivo` | nvarchar(255) | — |
| `usuario_id` | int, FK `Usuarios` | quem importou |
| `total_linhas` | int | linhas processadas no upload |
| `total_sem_estado` | int | DDD sem Estado correspondente |
| `total_duplicado` | int | telefone já existente em `Contatos` |
| `total_erro` | int | linha rejeitada (nome/telefone inválido) |
| `confirmado` | bit, default 0 | `1` só depois que a Lívia confirmar a escolha de número por Estado |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

### `LoteImportacaoEscolhas`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `lote_importacao_id` | int, FK `LotesImportacao` | — |
| `estado_id` | int, FK `Estados` | — |
| `numero_remetente_id` | int, FK `NumerosRemetentes` | número escolhido pela Lívia para aquele Estado, naquele lote |
| `total_contatos` | int | quantos contatos deste Estado, neste lote, foram atribuídos |

**UNIQUE** em `(lote_importacao_id, estado_id)` — uma escolha por Estado por
lote (não é possível dividir os contatos de um mesmo Estado, no mesmo lote,
entre dois números — se isso vier a ser necessário, é decisão para uma
versão futura).

### `Contatos`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `nome` | nvarchar(150) | da planilha |
| `telefone` | varchar(20) | **UNIQUE** globalmente; normalizado `55DDDNNNNNNNNN` |
| `ddd` | char(2) | extraído do telefone |
| `estado_id` | int, FK `Estados`, nullable | `NULL` = "sem Estado" (DDD não reconhecido) |
| `numero_remetente_id` | int, FK `NumerosRemetentes`, nullable | só preenchido após a confirmação do lote |
| `lote_importacao_id` | int, FK `LotesImportacao` | de qual upload este contato veio |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

> Campos de pipeline de atendimento (fora de escopo deste v2) entram nesta
> mesma tabela quando implementados — não criar tabela paralela.

---

## Middlewares

### `authMiddleware` — payload ganha `role`
`req.usuario = { id, email, isAdmin, role }`.

### `operadorCobrancaMiddleware` (novo)
Aplicado em toda rota de `/api/controle-ligacoes/*`. Roda depois de
`authMiddleware`.
```json
403 Forbidden
{ "error": "Acesso restrito ao Controle de Ligações." }
```
se `req.usuario.role !== 'operador_cobranca'`.

---

## 1. `POST /api/auth/reativacao/login`

Pública. Mesmo corpo/validações/mensagens de `POST /api/auth/login`
(`CONTRATO-AUTH-API.md`), mas só autentica quem tem `role =
'operador_cobranca'`.

- `400` — campos ausentes (mensagens idênticas ao login normal).
- `401` — `{ "error": "E-mail ou senha inválidos." }`.
- `403` — credenciais corretas, papel incompatível:
  `{ "error": "Este usuário não tem acesso ao Controle de Ligações." }`.
- `200` — `{ token, usuario: { id, email, isAdmin, role } }`.
- `500` — `{ "error": "Erro interno ao autenticar." }`.

## 2. Alteração em `POST /api/auth/login`

Mesma rota existente — ganha um novo caso `403`:
```json
{ "error": "Este usuário deve acessar pelo login do Controle de Ligações." }
```
quando `role === 'operador_cobranca'`. Resposta de sucesso e payload do JWT
passam a incluir `role`.

---

## 3. `GET /api/controle-ligacoes/estados`

Lista todos os Estados cadastrados, com seus DDDs — usada para popular o
dropdown de Estado na tela de Números Remetentes. Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

### Resposta de sucesso — `200 OK`
```json
[
  { "id": 6, "nome": "Maranhão", "uf": "MA", "ddds": ["98", "99"], "criado_em": "..." }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar estados." }`

---

## 4. `POST /api/controle-ligacoes/estados`

Cria um Estado novo — usado pelo link "Cadastrar novo estado" **dentro** do
formulário de Número Remetente (ver seção 5), não numa tela própria.
Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `nome` | string | sim | não vazio |
| `uf` | string | sim | 2 letras |
| `ddds` | string[] | sim | array não-vazio, cada item com 2 dígitos |

### Validações — `400 Bad Request`
1. `nome` ausente/vazio: `{ "error": "Campo \"nome\" é obrigatório." }`
2. `uf` ausente/inválida: `{ "error": "Campo \"uf\" é obrigatório e deve ter 2 letras." }`
3. `ddds` ausente/vazio/inválido: `{ "error": "Campo \"ddds\" é obrigatório e deve conter ao menos um DDD válido." }`

### Duplicidade — `409 Conflict`
1. `uf` já cadastrada: `{ "error": "Já existe um estado com essa UF." }`
2. Algum DDD já pertence a outro Estado:
   ```json
   { "error": "O DDD \"98\" já está atribuído ao estado \"Maranhão\"." }
   ```

### Resposta de sucesso — `201 Created`
Mesmo shape da seção 3 (item único).

### Erros
`400`/`409`/`500` (`{ "error": "Erro interno ao criar estado." }`)

---

## 5. `GET /api/controle-ligacoes/numeros-remetentes`

Lista todos os números remetentes, cada um com seu Estado. Tela única de
Configurações. Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 3,
    "apelido": "CDC Cohatrac",
    "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" },
    "numero": null,
    "statusConexao": "aguardando_conexao",
    "ativo": true,
    "criado_em": "..."
  }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar números remetentes." }`

---

## 6. `POST /api/controle-ligacoes/numeros-remetentes`

Cria um número remetente, vinculado a um Estado já existente. Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `apelido` | string | sim | não vazio |
| `estadoId` | number | sim | inteiro positivo, deve existir em `Estados` |

```json
{ "apelido": "CDC Cohatrac", "estadoId": 6 }
```

### Validações — `400 Bad Request`
1. `apelido` ausente/vazio: `{ "error": "Campo \"apelido\" é obrigatório." }`
2. `estadoId` ausente/inválido ou não existe: `{ "error": "Estado informado não existe." }`

### Comportamento no banco
`INSERT INTO NumerosRemetentes (estado_id, apelido, numero, status_conexao, ativo, criado_em) VALUES (@estadoId, @apelido, NULL, 'aguardando_conexao', 1, SYSUTCDATETIME())`

### Resposta de sucesso — `201 Created`
Mesmo shape da seção 5 (item único).

### Erros
`400`/`500` (`{ "error": "Erro interno ao criar número remetente." }`)

---

## 7. `PUT /api/controle-ligacoes/numeros-remetentes/:id`

Atualização parcial: `apelido`/`estadoId`/`ativo`. Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

- `:id` não encontrado → `404`: `{ "error": "Número remetente não encontrado." }`
- `estadoId`, se enviado, deve existir → `400`: `{ "error": "Estado informado não existe." }`
- `200 OK` com o shape da seção 5.
- `500`: `{ "error": "Erro interno ao atualizar número remetente." }`

## 8. `DELETE /api/controle-ligacoes/numeros-remetentes/:id`

Bloqueia com `409` se houver qualquer `Contatos.numero_remetente_id = :id`
ou `LoteImportacaoEscolhas.numero_remetente_id = :id`:
```json
{ "error": "Não é possível excluir este número pois existem contatos ou importações vinculadas a ele. Utilize a atualização (PUT) com ativo=false para desativá-lo." }
```
Sem vínculo, delete físico — `204 No Content`.

### Erros
`400` (`:id`), `404`, `409`, `500`: `{ "error": "Erro interno ao excluir número remetente." }`

---

## 9. `POST /api/controle-ligacoes/contatos/importar`

Recebe a planilha, valida, extrai DDD, agrupa por Estado. **Não atribui
número ainda** — isso só acontece na confirmação (seção 10). Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

### Requisição
`multipart/form-data`, campo `arquivo` (`.xlsx`/`.csv`). Colunas esperadas:
`NOME`, `CONTATO` (case-insensitive). A tela de upload exibe essa exigência
de formato antes do envio.

### Validações — `400 Bad Request`
1. Nenhum arquivo: `{ "error": "Arquivo é obrigatório." }`
2. Extensão inválida: `{ "error": "Formato de arquivo não suportado. Envie .xlsx ou .csv." }`
3. Colunas ausentes: `{ "error": "A planilha deve conter as colunas \"NOME\" e \"CONTATO\"." }`

### Processamento por linha
1. `NOME` vazio ou `CONTATO` sem DDD extraível (menos de 12-13 dígitos, já
   contando o `55`) → rejeitada, conta em `total_erro`.
2. Telefone normalizado já existe em `Contatos` → rejeitada, conta em
   `total_duplicado` (o registro existente não é alterado).
3. Extrai DDD (posições 3-4, depois do `55`); busca `EstadoDDDs`.
   - Encontrado → grava `Contatos` com `estado_id` preenchido,
     `numero_remetente_id = NULL`.
   - Não encontrado → grava com `estado_id = NULL`, conta em
     `total_sem_estado`.
4. Todo contato deste upload é vinculado ao `lote_importacao_id` criado
   para esta chamada, com `LotesImportacao.confirmado = 0`.

### Resposta de sucesso — `201 Created`
```json
{
  "loteImportacaoId": 12,
  "totalLinhas": 154,
  "totalImportados": 148,
  "totalSemEstado": 4,
  "totalDuplicado": 2,
  "totalErro": 0,
  "porEstado": [
    { "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" }, "totalContatos": 148 }
  ],
  "criado_em": "..."
}
```

`porEstado` alimenta a tela de confirmação (seção 10): para cada Estado
presente, o frontend busca os números ativos daquele Estado (via seção 5,
filtrando `ativo=true` e `estadoId`) e monta o seletor.

### Erros
`400`/`500` (`{ "error": "Erro interno ao importar contatos." }`)

---

## 10. `POST /api/controle-ligacoes/contatos/importar/:loteId/confirmar`

Recebe a escolha de número por Estado e efetiva a distribuição. Protegida
por `authMiddleware` + `operadorCobrancaMiddleware`.

### Corpo da requisição
```json
{
  "escolhas": [
    { "estadoId": 6, "numeroRemetenteId": 3 },
    { "estadoId": 4, "numeroRemetenteId": 9 }
  ]
}
```

### Validações — `400 Bad Request`
1. `:loteId` não é inteiro positivo, ou não existe: `{ "error": "Lote de importação não encontrado." }`
2. Lote já confirmado: `{ "error": "Este lote já foi confirmado anteriormente." }`
3. `escolhas` ausente/vazio: `{ "error": "Campo \"escolhas\" é obrigatório." }`
4. Algum `estadoId` do corpo não tem nenhum contato pendente neste lote, ou
   algum `numeroRemetenteId` não pertence ao `estadoId` informado, ou não
   está `ativo`:
   `{ "error": "Número remetente informado é inválido para o estado \"Maranhão\"." }`
5. Falta escolha para algum Estado presente no lote (todo Estado que
   apareceu no resumo da seção 9 precisa de uma escolha, exceto "Sem
   Estado", que nunca recebe número):
   `{ "error": "É necessário escolher um número para todos os estados deste lote." }`

### Comportamento no banco (transação)
1. Para cada item de `escolhas`: `UPDATE Contatos SET numero_remetente_id = @numeroRemetenteId WHERE lote_importacao_id = @loteId AND estado_id = @estadoId AND numero_remetente_id IS NULL`.
2. Insere uma linha em `LoteImportacaoEscolhas` por item, com `total_contatos` = linhas afetadas no passo anterior.
3. `UPDATE LotesImportacao SET confirmado = 1 WHERE id = @loteId`.

### Resposta de sucesso — `200 OK`
```json
{ "loteImportacaoId": 12, "confirmado": true }
```

### Erros
`400`/`404`/`500` (`{ "error": "Erro interno ao confirmar importação." }`)

---

## 11. `GET /api/controle-ligacoes/contatos/importar/pendentes`

Lista lotes com `confirmado = 0` — alimenta um aviso/lista de pendências
("você tem 2 importações aguardando confirmação de número"). Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

### Resposta de sucesso — `200 OK`
```json
[
  { "loteImportacaoId": 12, "nomeArquivo": "clientes_agosto.xlsx", "totalImportados": 148, "criado_em": "..." }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar importações pendentes." }`

---

## Frontend — telas deste v2

- **Login**: sem mudança de desenho em relação à fase anterior (botão que
  alterna para o formulário "NovaGest — Controle de Ligações", chamando
  `POST /api/auth/reativacao/login`).
- **Módulo Configurações → "Números Remetentes"** (tela única):
  lista de números (apelido, estado, status, ativo/inativo, ações) +
  formulário de criação/edição no mesmo local (modal ou painel lateral,
  critério visual do frontend-developer). Dentro do formulário, um link
  "Cadastrar novo estado" expande um mini-formulário (`nome`, `uf`, `ddds`)
  que chama a seção 4 e, ao salvar, já seleciona o Estado recém-criado no
  dropdown principal — sem navegação, sem sair da tela.
- **Módulo Importação** (separado): upload com a dica de formato
  (`NOME`/`CONTATO`) visível antes do envio → resumo pós-upload (seção 9) →
  tela de confirmação com um seletor de número por Estado presente,
  puxando só números `ativo=true` daquele Estado → botão "Confirmar
  distribuição" (seção 10). Uma lista de "Importações pendentes" (seção 11)
  fica visível nesse módulo para retomar uma confirmação que ficou pra
  trás.

Ambas as telas ficam atrás de `RequireOperadorCobranca` (mesmo padrão de
`RequireAdmin`), dentro do shell isolado do módulo.

---

## Resumo rápido

| Método | Rota | Auth | Observação |
|---|---|---|---|
| POST | `/api/auth/reativacao/login` | pública | só `role = operador_cobranca` |
| POST | `/api/auth/login` | pública | (alterado) rejeita `operador_cobranca` com `403` |
| GET/POST | `/api/controle-ligacoes/estados` | operador_cobranca | DDD 1:1 por Estado |
| GET/POST/PUT/DELETE | `/api/controle-ligacoes/numeros-remetentes` | operador_cobranca | Estado 1:N números; tela única em Configurações |
| POST | `/api/controle-ligacoes/contatos/importar` | operador_cobranca | só lê/agrupa, não atribui número; bloqueia duplicado por telefone |
| POST | `/api/controle-ligacoes/contatos/importar/:loteId/confirmar` | operador_cobranca | efetiva a escolha manual de número por Estado |
| GET | `/api/controle-ligacoes/contatos/importar/pendentes` | operador_cobranca | lotes com `confirmado=0` |

Todos os erros seguem `{ "error": "mensagem" }`.

## Fora de escopo deste v2 (registrado, não implementar agora)

- Central de Mensagens (Baileys) + conexão real via QR Code (`numero` e
  `status_conexao` de verdade nascem aqui).
- Disparo em massa (limite de 10/número, aviso de 3 dias, seleção manual).
- Pipeline de atendimento (`não atendido`/`atendido`/`perdido`/`agendado`)
  — colunas entram em `Contatos`, não em tabela nova.
- Handoff automático IA → Lívia (regra: IA manda a 1ª mensagem; assim que o
  cliente responder, transfere para a Lívia — sem réplica da IA).
- Integração com Gemini (`GEMINI_API_KEY` — ainda não provisionada).
- Agendamentos (calendário + kanban, mesmo dado, com toggle de visão).
- Divisão de um mesmo Estado, no mesmo lote, entre dois números diferentes
  (hoje é sempre um número por Estado por lote — `UNIQUE` em
  `LoteImportacaoEscolhas`).