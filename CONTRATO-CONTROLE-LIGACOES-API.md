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
| `confirmado` | bit, default 0 | **Descontinuado em v3** (ver seção "Importação (v3)" no fim do documento) — a coluna continua existindo no schema (default `0`), mas o fluxo de importação atual não grava mais nela (nem `0` nem `1`); todo lote nasce e permanece com o valor default do banco. Não confie neste campo para nada novo. |
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

> **Descontinuada em v3** (ver seção "Importação (v3)" no fim do documento):
> a tabela continua existindo no schema, mas nada no código escreve nela a
> partir da v3 — a escolha de número passou a acontecer no Painel de
> Disparo (`Disparos`/`DisparoContatos`), não mais na confirmação de um
> lote de importação.

### `Contatos`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `nome` | nvarchar(150) | da planilha |
| `telefone` | varchar(20) | **UNIQUE** globalmente; normalizado `55DDDNNNNNNNNN` |
| `ddd` | char(2) | extraído do telefone |
| `estado_id` | int, FK `Estados`, nullable | `NULL` = "sem Estado" (DDD não reconhecido) |
| `numero_remetente_id` | int, FK `NumerosRemetentes`, nullable | **Descontinuado em v3**: só era preenchido pela extinta confirmação de lote (seção 10, abaixo). A partir da v3, nenhuma rota de importação grava mais neste campo — fica sempre `NULL` para contatos importados depois da v3 (registros antigos, de antes da v3, podem ainda ter um valor histórico aqui). O Painel de Disparo nunca leu/lê este campo para montar a fila (ver "Painel de Disparo (v3)"). |
| `lote_importacao_id` | int, FK `LotesImportacao` | de qual upload este contato veio |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

> Campos de pipeline de atendimento (fora de escopo deste v2) entram nesta
> mesma tabela quando implementados — não criar tabela paralela.

### `LoteImportacaoErros` (nova, v3)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `lote_importacao_id` | int, FK `LotesImportacao` | lote que gerou o erro |
| `linha` | int, nullable | número da linha na planilha, 1-indexed, contando o cabeçalho como linha 1 |
| `tipo` | varchar(20) | `'erro'` (nome/telefone inválido) ou `'duplicado'` (telefone já cadastrado) |
| `nome_planilha` | nvarchar(150), nullable | valor de `NOME` como veio na planilha (`NULL` quando a própria ausência de nome é o motivo do erro) |
| `contato_planilha` | varchar(30), nullable | telefone normalizado (só dígitos) como foi lido da planilha |
| `motivo` | nvarchar(255) | mensagem legível, ex. `"Nome não informado."`, `"Telefone inválido ou incompleto."`, `"Telefone já cadastrado."` |
| `contato_existente_id` | int, FK `Contatos`, nullable | só para `tipo='duplicado'` contra um telefone que já existia em `Contatos` antes deste upload; fica `NULL` no sub-caso de duplicata **dentro do próprio arquivo** (ver seção "Importação (v3)" — limitação documentada, não bug) |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

Criada por `backend/src/scripts/MIGRATION-LOTE-IMPORTACAO-ERROS.sql`
(idempotente, `IF NOT EXISTS`, mesmo padrão de `MIGRATION-DISPAROS.sql`).

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

> **Atualizada em v3** — o texto abaixo é o desenho original (v2). O
> comportamento atual (gravação de erros/duplicados linha a linha em
> `LoteImportacaoErros`, e a remoção da confirmação por Estado) está
> descrito na seção "Importação (v3)", no fim deste documento — consulte-a
> para o contrato vigente desta rota.

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

> **Descontinuado em v3.** A escolha de número por Estado passou a
> acontecer no Painel de Disparo, no momento do disparo (ver "Painel de
> Disparo (v3)"). Esta rota continua montada no router, mas a partir da v3
> responde sempre `410 Gone`
> (`{ "error": "Rota descontinuada. A escolha de número acontece no Painel de Disparo." }`),
> independentemente do corpo ou de `:loteId` — o texto abaixo descreve o
> comportamento antigo (v2), mantido como histórico do documento, e não
> reflete mais o comportamento real da rota. Ver seção "Importação (v3)"
> no fim deste documento.

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
3. `escolhas` ausente/`null`, ou de tipo diferente de array:
   `{ "error": "Campo \"escolhas\" é obrigatório." }`. **Um array vazio
   (`"escolhas": []`) é diferente disso e é válido** — ver nota abaixo.
4. Algum item de `escolhas` malformado (`estadoId`/`numeroRemetenteId` não
   são inteiro positivo): mesma mensagem do item 3.
5. Algum `estadoId` do corpo não tem nenhum contato pendente neste lote, ou
   algum `numeroRemetenteId` não pertence ao `estadoId` informado, ou não
   está `ativo`:
   `{ "error": "Número remetente informado é inválido para o estado \"Maranhão\"." }`
6. Falta escolha para algum Estado presente no lote (todo Estado que
   apareceu no resumo da seção 9/11 precisa de uma escolha, exceto "Sem
   Estado", que nunca recebe número):
   `{ "error": "É necessário escolher um número para todos os estados deste lote." }`

### Nota — `"escolhas": []` é válido ("nada a confirmar")

Um lote pode não ter nenhum Estado pendente de escolha (todos os contatos
caíram em duplicado/erro/sem-estado, ou o lote já foi parcialmente resolvido
por fora). A seção 11 (`GET .../pendentes`) sinaliza esse caso com
`nadaAConfirmar: true` e `porEstado: []` para aquele lote. Nesse cenário, o
frontend chama esta mesma rota com `{ "escolhas": [] }` só para marcar o
lote como confirmado — não existe (nem é necessária) uma rota separada para
isso. O corpo é repassado direto ao model, que já lida corretamente com o
caso: se de fato não houver nenhum Estado pendente, o resultado é
`200 OK`/`confirmado: true`; se **houver** Estado pendente (ex.: o frontend
está com dado desatualizado) o resultado ainda é o erro do item 6 acima
(`faltando_escolha`), nunca um `confirmado` incorreto.

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

> **Descontinuada em v3**, substituída por
> `GET /api/controle-ligacoes/contatos/importar/historico` e
> `GET /api/controle-ligacoes/contatos/importar/:loteId` — não existe mais
> o conceito de "lote pendente de confirmação" (a confirmação em si foi
> removida, ver seção 10). Esta rota foi removida do router — a partir da
> v3, `GET .../contatos/importar/pendentes` casa acidentalmente com a nova
> rota `GET .../contatos/importar/:loteId` (`"pendentes"` não é um inteiro
> positivo válido para `:loteId`), então uma chamada ao caminho antigo
> agora responde `404` com
> `{ "error": "Importação não encontrada." }` — não é mais um erro de rota
> inexistente, mas o resultado ainda é um `404`. O texto abaixo descreve o
> comportamento antigo (v2), mantido como histórico do documento. Ver
> seção "Importação (v3)" no fim deste documento.

Lista lotes com `confirmado = 0` — alimenta um aviso/lista de pendências
("você tem 2 importações aguardando confirmação de número"). Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

Cada lote traz `porEstado`, o detalhamento por Estado dos contatos **ainda
pendentes de verdade** naquele lote (`estado_id IS NOT NULL AND
numero_remetente_id IS NULL`) — mesmo shape de `porEstado` já usado na
resposta da seção 9, mas recalculado na leitura (não é uma cópia congelada
do resultado da importação): se o lote já tiver sido parcialmente resolvido
por fora, um Estado cujos contatos já têm `numero_remetente_id` preenchido
não aparece mais aqui. Isso existe para o frontend saber de antemão, antes
de montar os seletores da tela de confirmação (seção 10), exatamente quais
Estados existem naquele lote — evitando deixar o operador escolher o mesmo
Estado duas vezes.

Quando `porEstado` vem vazio (nenhum contato pendente — ex.: tudo caiu em
duplicado/erro/sem-estado, ou o lote já foi todo resolvido por fora), o
lote vem com `nadaAConfirmar: true`; nesse caso a tela deve oferecer só uma
ação de "marcar como resolvido", que é `POST .../confirmar` com
`{ "escolhas": [] }` (ver nota na seção 10) — sem seletor de Estado nenhum
para exibir.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "loteImportacaoId": 12,
    "nomeArquivo": "clientes_agosto.xlsx",
    "totalImportados": 148,
    "criado_em": "...",
    "porEstado": [
      { "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" }, "totalContatos": 148 }
    ],
    "nadaAConfirmar": false
  },
  {
    "loteImportacaoId": 13,
    "nomeArquivo": "so_duplicados.xlsx",
    "totalImportados": 0,
    "criado_em": "...",
    "porEstado": [],
    "nadaAConfirmar": true
  }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar importações pendentes." }`

---

## Frontend — telas deste v2

> **Atualizado em v3**: o "Módulo Importação" descrito abaixo (fluxo de
> upload → confirmação por Estado → "Importações pendentes") reflete o
> desenho v2 e **não bate mais com o backend** a partir da v3 — a tela de
> confirmação não tem mais rota pra chamar (`410`), e "Importações
> pendentes" precisa virar "Histórico de importações"
> (`GET .../historico` + `GET .../:loteId`, ver "Importação (v3)" no fim
> deste documento). `frontend/src/modulos/controle-ligacoes/importacao/ImportacaoPage.jsx`
> ainda chama as rotas antigas — ajuste de frontend fica para um follow-up
> separado, fora do escopo desta mudança de backend.

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
| POST | `/api/controle-ligacoes/contatos/importar` | operador_cobranca | Importação (v3); lê/agrupa, nunca atribui número; grava erros/duplicados linha a linha em `LoteImportacaoErros` |
| POST | `/api/controle-ligacoes/contatos/importar/:loteId/confirmar` | operador_cobranca | **Descontinuada em v3** — sempre `410 Gone` |
| GET | `/api/controle-ligacoes/contatos/importar/pendentes` | operador_cobranca | **Descontinuada em v3** — rota removida do router; casa com `:loteId` abaixo e responde `404` |
| GET | `/api/controle-ligacoes/contatos/importar/historico` | operador_cobranca | Importação (v3); todos os lotes, mais recentes primeiro |
| GET | `/api/controle-ligacoes/contatos/importar/:loteId` | operador_cobranca | Importação (v3); detalhe de um lote (resumo + `porEstado` + `erros`); `404` se não existir |
| GET | `/api/controle-ligacoes/painel-disparo` | operador_cobranca | Painel de Disparo (v3); inclui Estado vazio |
| GET | `/api/controle-ligacoes/estados/:estadoId/contatos-disponiveis` | operador_cobranca | Painel de Disparo (v3); não filtra por número |
| POST | `/api/controle-ligacoes/disparos` | operador_cobranca | Painel de Disparo (v3); máx. 10 contatos, sempre `pendente_envio`; agora é onde a escolha de número por Estado acontece |

Todos os erros seguem `{ "error": "mensagem" }`.

## Painel de Disparo (v3)

> Adendo ao contrato v2 acima — não substitui nada do que já existe, só
> acrescenta as 3 rotas do "Painel de Disparo": a Lívia seleciona
> manualmente até 10 contatos por vez, por Estado, e registra a intenção de
> disparo (grava a fila). **Envio real via Baileys/Gemini continua fora de
> escopo** — nenhum worker/processador consome `Disparos`/`DisparoContatos`
> nesta fase; todo disparo criado nasce e permanece com
> `status = 'pendente_envio'`.

### Contexto e decisões de design

- **Um contato não fica travado a um número remetente específico.** O
  Estado de um contato é fixo (definido na importação, `Contatos.estado_id`)
  mas o número usado em cada disparo é uma escolha feita **naquele
  disparo**, não uma propriedade permanente do contato — em disparos
  diferentes, o mesmo contato pode ser contatado por qualquer número ativo
  do seu Estado. Por isso a fila de contatos de um card (seção "2" abaixo)
  é filtrada por `estado_id`, nunca por `numero_remetente_id`.
  `Contatos.numero_remetente_id` (gravado na confirmação de importação, ver
  seção 10 do contrato v2) continua existindo só como campo informativo
  (qual número originou o contato), não como trava de fila — não é lido em
  nenhuma das 3 rotas novas.
- **"Disparado nos últimos 3 dias" é uma checagem por contato, não por
  número.** `disparadoUltimos3Dias` (seções 2 e 3 abaixo) é `true` se aquele
  `contato_id` aparece em `DisparoContatos` de algum `Disparos` com
  `criado_em >= DATEADD(day, -3, SYSUTCDATETIME())`, **independente de qual
  `numero_remetente_id` foi usado** naquele disparo anterior — reflete a
  mesma decisão acima (o número não é uma propriedade do contato). O
  backend sempre recalcula essa flag na leitura e de novo na criação do
  disparo (nunca confia no valor que o frontend eventualmente reenviar).
- **`GET /painel-disparo` inclui todo Estado cadastrado**, mesmo sem nenhum
  número ativo e/ou sem nenhum contato (`numerosAtivos: []`,
  `totalContatos: 0`) — decisão deliberada para o frontend poder mostrar um
  card de "estado vazio" (ex.: "nenhum número ativo cadastrado ainda") em
  vez de simplesmente omitir o Estado da lista, o que seria indistinguível
  de "Estado não existe".
- **Limite de 10 contatos por disparo é validado sobre o array bruto
  enviado**, antes de qualquer dedup; ids repetidos no mesmo `contatoIds`
  são deduplicados silenciosamente em `disparos.service.js` só depois dessa
  checagem (evita colidir com o `UNIQUE(disparo_id, contato_id)` de
  `DisparoContatos` sem precisar devolver erro para um caso que não é bem
  uma violação de negócio).
- **`avisos` nunca bloqueia a criação do disparo** — é só um aviso pós-fato
  (contato que já tinha `disparadoUltimos3Dias = true` no momento exato da
  criação); o disparo é criado normalmente mesmo quando `avisos` não está
  vazio. Cabe à tela decidir se confirma com o usuário antes de enviar o
  `POST`, mas o backend não impõe essa confirmação.

### Schema novo

```sql
CREATE TABLE Disparos (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    estado_id              INT NOT NULL FOREIGN KEY REFERENCES Estados(id),
    numero_remetente_id    INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    usuario_id             INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id),
    status                 VARCHAR(30) NOT NULL DEFAULT 'pendente_envio',
    criado_em              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE DisparoContatos (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    disparo_id   INT NOT NULL FOREIGN KEY REFERENCES Disparos(id),
    contato_id   INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    CONSTRAINT UQ_DisparoContatos UNIQUE (disparo_id, contato_id)
);
```

Criado por `backend/src/scripts/MIGRATION-DISPAROS.sql` (idempotente,
`IF NOT EXISTS`, mesmo padrão de `MIGRATION-PASSWORD-RESET-TOKENS.sql`).
`status` só assume `'pendente_envio'` nesta fase — outros valores (enviado,
falhou, etc.) pertencem a uma fase futura, junto com o worker de envio.

---

### 12. `GET /api/controle-ligacoes/painel-disparo`

Por Estado, números ativos vinculados e contagem de contatos. Protegida por
`authMiddleware` + `operadorCobrancaMiddleware`.

#### Resposta de sucesso — `200 OK`
```json
[
  {
    "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" },
    "totalContatos": 148,
    "numerosAtivos": [
      { "id": 3, "apelido": "CDC Cohatrac", "statusConexao": "aguardando_conexao" }
    ]
  },
  {
    "estado": { "id": 1, "nome": "Rondônia", "uf": "RO" },
    "totalContatos": 0,
    "numerosAtivos": []
  }
]
```
Inclui todo Estado cadastrado, mesmo sem número ativo ou sem contato (ver
"Contexto e decisões de design" acima).

#### Erros
`500`: `{ "error": "Erro interno ao listar painel de disparo." }`

---

### 13. `GET /api/controle-ligacoes/estados/:estadoId/contatos-disponiveis`

Contatos de um Estado, **não filtrado por número remetente** (ver decisão
de design acima). Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

#### Parâmetros
| Nome | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `:estadoId` | path, number | sim | inteiro positivo; `400` se não for |
| `busca` | query, string | não | filtra por `nome` OU `telefone` (`LIKE %busca%`) |
| `ordem` | query, string | não | `'nome_asc'` (default) \| `'nome_desc'` \| `'recentes'`; valor desconhecido cai no default silenciosamente |

#### Validações — `400 Bad Request`
1. `:estadoId` não é inteiro positivo: `{ "error": "Parâmetro \"estadoId\" deve ser um número inteiro positivo." }`

Um `estadoId` sintaticamente válido mas inexistente não é tratado como
erro — a query simplesmente não encontra `Contatos` com aquele
`estado_id` e devolve `[]`.

#### Resposta de sucesso — `200 OK`
```json
[
  { "id": 10, "nome": "Maria Silva", "telefone": "5598900000000", "disparadoUltimos3Dias": true },
  { "id": 11, "nome": "João Souza", "telefone": "5598900000001", "disparadoUltimos3Dias": false }
]
```

#### Erros
`400`/`500` (`{ "error": "Erro interno ao listar contatos disponíveis." }`)

---

### 14. `POST /api/controle-ligacoes/disparos`

Registra a intenção de disparo (grava a fila) — não envia nada de fato.
Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

#### Corpo da requisição
```json
{ "estadoId": 6, "numeroRemetenteId": 3, "contatoIds": [10, 11] }
```
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `estadoId` | number | sim | inteiro positivo |
| `numeroRemetenteId` | number | sim | inteiro positivo; deve existir, estar `ativo` e pertencer a `estadoId` |
| `contatoIds` | number[] | sim | não vazio, no máximo 10, cada item deve pertencer a `estadoId` |

`usuario_id` do registro vem de `req.usuario.id` (populado pelo
`authMiddleware`), não do corpo da requisição.

#### Validações — `400 Bad Request` (nesta ordem)
1. `contatoIds` ausente/vazio: `{ "error": "Campo \"contatoIds\" é obrigatório." }`
2. `contatoIds.length > 10`: `{ "error": "Máximo de 10 contatos por disparo." }`
3. `numeroRemetenteId` (ou `estadoId`) em formato inválido, inexistente,
   não `ativo`, ou de outro Estado:
   `{ "error": "Número remetente inválido para o estado informado." }`
4. Algum item de `contatoIds` em formato inválido ou de um `Contato` que não
   pertence a `estadoId`:
   `{ "error": "Todos os contatos devem pertencer ao estado informado." }`

O backend sempre recalcula as duas checagens acima contra o banco no
momento do `POST` — nunca confia em nenhum dado enviado pelo frontend além
dos ids.

#### Comportamento no banco (transação)
1. Valida `numeroRemetenteId` (existe, `ativo = 1`, `estado_id = @estadoId`).
2. Valida que todo `contatoId` de `contatoIds` existe e tem
   `estado_id = @estadoId` (a mesma query já recalcula
   `disparadoUltimos3Dias` de cada um).
3. Insere 1 linha em `Disparos` (`status = 'pendente_envio'`).
4. Insere 1 linha em `DisparoContatos` por `contatoId`.

#### Resposta de sucesso — `201 Created`
```json
{
  "disparoId": 42,
  "totalContatos": 2,
  "avisos": [
    { "id": 10, "nome": "Maria Silva", "telefone": "5598900000000" }
  ]
}
```
`avisos` lista os contatos que já tinham `disparadoUltimos3Dias = true` no
momento deste `POST` — **não bloqueia** a criação, o disparo é criado de
qualquer forma (ver "Contexto e decisões de design" acima). Array vazio
quando nenhum contato do disparo tinha sido disparado nos últimos 3 dias.

#### Erros
`400`/`500` (`{ "error": "Erro interno ao criar disparo." }`)

---

## Importação (v3)

> Adendo ao contrato v2 acima — substitui o modelo de "importação em duas
> etapas com escolha manual por Estado" (seções 9–11) pelo modelo mais
> simples confirmado junto com o Painel de Disparo (v3, seção anterior): a
> escolha de número por Estado deixou de acontecer na importação e passou a
> acontecer **no momento do disparo**. Isso elimina o conceito de "lote
> pendente de confirmação" — todo lote de importação, a partir de agora,
> nasce e permanece "completo": todo contato válido (com ou sem Estado) já
> está disponível para o Painel de Disparo assim que o upload termina, sem
> nenhuma etapa extra.

### O que mudou em relação à v2

- **`POST /api/controle-ligacoes/contatos/importar` (seção 9) não muda a
  lógica de leitura/validação/agrupamento** (extração de DDD, checagem de
  duplicidade global de telefone, agrupamento por Estado) — isso continua
  idêntico à v2. O que muda é que, além de contar `total_erro`/
  `total_duplicado`, cada linha rejeitada agora também grava uma linha em
  `LoteImportacaoErros` (ver schema acima), com o número da linha na
  planilha, o motivo e (quando aplicável) o `Contatos.id` já existente que
  causou a rejeição por duplicidade.
- **A rota nunca mais atribui `numero_remetente_id`** — isso já era
  verdade na v2 também (a atribuição só acontecia na confirmação), mas na
  v3 não existe mais *nenhuma* rota de importação que atribua esse campo.
- **`POST .../:loteId/confirmar` (seção 10) foi descontinuada** — sempre
  responde `410 Gone` (ver seção 10 acima para o detalhe). A rota continua
  montada no router propositalmente, para dar um erro claro em vez de um
  `404` genérico para qualquer cliente antigo que ainda a chame.
- **`GET .../pendentes` (seção 11) foi removida do router**, substituída
  pelas duas rotas novas abaixo (histórico geral + detalhe de um lote).
- **`LotesImportacao.confirmado` não é mais gravado** em nenhum ponto do
  código deste fluxo — a coluna continua existindo no banco (não houve
  `ALTER TABLE DROP COLUMN`), só ficou sem uso.

### Numeração de linha (`LoteImportacaoErros.linha`)

A planilha é lida em `importacao.service.js: lerPlanilha`, que devolve uma
lista de registros já com o número de linha original anexado
(`registro.linha`). A numeração é 1-indexed **contando o cabeçalho como
linha 1** — ou seja, a primeira linha de dados é `linha = 2`. Linhas
totalmente vazias são puladas silenciosamente (nunca geram erro nem
consomem um número de linha "visível" para o usuário além do que já é
natural da planilha).

### Sub-caso: duplicata dentro do próprio arquivo

Quando o mesmo telefone aparece 2+ vezes no mesmo upload, a 1ª ocorrência é
válida (assumindo que passe nas outras validações) e a 2ª em diante é
contada como duplicada. Para uma duplicata **contra o banco** (telefone que
já existia em `Contatos` antes deste upload), `LoteImportacaoErros.contato_existente_id`
aponta para o `Contatos.id` já existente. Para uma duplicata **dentro do
próprio arquivo**, esse campo fica `NULL` — **limitação documentada, não
bug**: a 1ª ocorrência só ganha um `Contatos.id` de verdade quando é
inserida, dentro da mesma transação que grava o lote inteiro
(`criarLoteEContatos`, em `importacao.model.js`); no momento em que o
service decide que a 2ª ocorrência é duplicada (antes de a transação
começar), a 1ª ocorrência ainda não tem id nenhum. Resolver isso exigiria
reestruturar o INSERT em duas fases (inserir 1ªs ocorrências, capturar ids,
só então gravar os erros) — decisão consciente de não fazer isso agora; a
linha de erro ainda é gravada normalmente, só sem essa referência cruzada.

### `GET /api/controle-ligacoes/contatos/importar/historico`

Lista **todos** os lotes de importação (não só pendentes — esse conceito
não existe mais), mais recentes primeiro. Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Resposta de sucesso — `200 OK`
```json
[
  {
    "loteImportacaoId": 12,
    "nomeArquivo": "clientes_agosto.xlsx",
    "usuarioEmail": "liv@teste.com",
    "totalLinhas": 150,
    "totalImportados": 148,
    "totalSemEstado": 0,
    "totalDuplicado": 2,
    "totalErro": 0,
    "criado_em": "..."
  }
]
```
`usuarioEmail` vem de um `LEFT JOIN` com `Usuarios` via
`LotesImportacao.usuario_id` (`LEFT`, não `INNER`, para não sumir um lote
antigo se o usuário que importou já tiver sido excluído — nesse caso
`usuarioEmail` vem `null`).

#### Erros
`500`: `{ "error": "Erro interno ao listar histórico de importações." }`

---

### `GET /api/controle-ligacoes/contatos/importar/:loteId`

Detalhe de um lote específico: o mesmo resumo do histórico acima, mais
`porEstado` (contagem de `Contatos` daquele lote agrupados por Estado,
**sem** o filtro de `numero_remetente_id IS NULL` que a extinta rota de
`pendentes` usava — aqui é sempre o total real e completo do lote) e a
lista de linhas rejeitadas daquele lote (`erros`, de
`LoteImportacaoErros`). Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Parâmetros
| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `:loteId` | path, number | sim | inteiro positivo; `404` (não `400`) se não for, mesma mensagem de "não encontrado" |

#### Resposta de sucesso — `200 OK`
```json
{
  "loteImportacaoId": 12,
  "nomeArquivo": "clientes_agosto.xlsx",
  "usuarioEmail": "liv@teste.com",
  "totalLinhas": 150,
  "totalImportados": 148,
  "totalSemEstado": 0,
  "totalDuplicado": 2,
  "totalErro": 0,
  "criado_em": "...",
  "porEstado": [
    { "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" }, "totalContatos": 148 }
  ],
  "erros": [
    {
      "linha": 7,
      "tipo": "duplicado",
      "nomePlanilha": "João Silva",
      "contatoPlanilha": "5598900000000",
      "motivo": "Telefone já cadastrado.",
      "contatoExistenteId": 5
    }
  ]
}
```
`erros[].contatoExistenteId` é `null` quando `tipo = 'erro'`, e também
`null` no sub-caso de duplicata dentro do próprio arquivo (ver acima).

#### Erros
- `404` — `:loteId` não é inteiro positivo, ou não existe:
  `{ "error": "Importação não encontrada." }`
- `500`: `{ "error": "Erro interno ao buscar detalhe da importação." }`

---

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