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
    "nomeColaboradora": null,
    "ativo": true,
    "criado_em": "..."
  }
]
```

`nomeColaboradora` (string ou `null`) é o nome da colaboradora usada pelo
worker de envio ao montar a mensagem daquele número (ver "Envio de Disparos
(v6)"); `null` quando ainda não configurado. Nasce sempre `null` na criação
(seção 6) — hoje só é definido/alterado via `PUT` (seção 7).

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

Atualização parcial: `apelido`/`estadoId`/`ativo`/`nomeColaboradora`. Todos os
campos são opcionais e independentes — envie só o(s) que quer mudar.
Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

| Campo | Tipo | Semântica quando ausente | Semântica quando enviado |
|---|---|---|---|
| `apelido` | string | não muda | grava (não pode ser vazio → `400`) |
| `estadoId` | number | não muda | grava, precisa existir em `Estados` (senão `400`) |
| `ativo` | boolean | não muda | grava |
| `nomeColaboradora` | string \| null | não muda | ver abaixo |

`nomeColaboradora` tem uma semântica própria, diferente dos outros três
campos: **ausente no body** → não mexe no valor atual; **string não vazia**
→ grava (com `trim()`); **string vazia (`""`, ou só espaços) ou `null`** →
limpa a coluna para `NULL` (remove o nome da colaboradora); **qualquer outro
tipo** (number, boolean, array, objeto) → `400`:
```json
{ "error": "Campo \"nomeColaboradora\", quando enviado, deve ser uma string ou null." }
```

- `:id` não encontrado → `404`: `{ "error": "Número remetente não encontrado." }`
- `estadoId`, se enviado, deve existir → `400`: `{ "error": "Estado informado não existe." }`
- `200 OK` com o shape da seção 5 (inclusive `nomeColaboradora` já atualizado).
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
| POST | `/api/controle-ligacoes/disparos/verificar` | operador_cobranca | Painel de Disparo (v4); só verifica (nunca grava), devolve `avisos` |
| POST | `/api/controle-ligacoes/disparos` | operador_cobranca | Painel de Disparo (v3/v4); máx. 10 contatos, sempre `pendente_envio`; agora é onde a escolha de número por Estado acontece; **a partir da v4 não devolve mais `avisos`** (ver seção 15) |
| GET | `/api/controle-ligacoes/disparos/:id` | operador_cobranca | Envio de Disparos (v6); detalhe do disparo + status individual de cada contato |

Todos os erros seguem `{ "error": "mensagem" }`.

## Painel de Disparo (v3, com adendo v4)

> Adendo ao contrato v2 acima — não substitui nada do que já existe, só
> acrescenta as rotas do "Painel de Disparo": a Lívia seleciona
> manualmente até 10 contatos por vez, por Estado, e registra a intenção de
> disparo (grava a fila). **Envio real via Baileys/Gemini continua fora de
> escopo** — nenhum worker/processador consome `Disparos`/`DisparoContatos`
> nesta fase; todo disparo criado nasce e permanece com
> `status = 'pendente_envio'`.
>
> **v4** separou o que era uma única chamada (`POST /disparos`, que gravava
> o disparo e devolvia `avisos` na mesma resposta) em duas chamadas reais:
> `POST /disparos/verificar` (seção 15, só verifica, nunca grava, devolve
> `avisos`) e `POST /disparos` (seção 14, sempre grava, não devolve mais
> `avisos`). Isso resolve uma confusão de UX da v3: o usuário via o aviso na
> resposta do `POST /disparos` e achava que ainda podia "cancelar" — mas o
> registro já tinha sido gravado antes mesmo do aviso chegar à tela. Ver
> seção 15 para o fluxo esperado.
>
> **Adendo posterior (sem número de versão próprio, correção de bug de
> produção):** `POST /disparos/verificar` e `POST /disparos` passaram a
> validar também que o `numeroRemetenteId` escolhido está com
> `status_conexao = 'conectado'` e com `nome_colaboradora` preenchido —
> antes dessa correção, `POST /disparos` respondia `201` mesmo para um
> número desconectado do WhatsApp ou sem colaboradora configurada, e só o
> worker assíncrono (`workers/envioDisparos.worker.js`, que roda minutos
> depois) barrava o envio, deixando o operador sem saber na hora que o
> disparo estava fadado a falhar. Ver seções 14 e 15 abaixo para os novos
> status/corpos de erro.

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
- **`avisos` nunca bloqueia a criação do disparo, e a partir da v4 é
  responsabilidade exclusiva de `POST /disparos/verificar` (seção 15), não
  mais de `POST /disparos` (seção 14).** `avisos` lista contatos que já
  tinham `disparadoUltimos3Dias = true` no momento da verificação; a rota
  de verificação não grava nada, então a tela pode mostrar o aviso e ainda
  dar ao usuário a chance real de cancelar antes de qualquer coisa existir
  no banco. Só depois de o usuário confirmar (ou quando não havia aviso
  nenhum) é que a tela deve chamar `POST /disparos`, que sempre grava
  quando chamado — o backend não impõe essa ordem/confirmação, é uma
  expectativa de uso da tela, não uma trava de código.
- **A checagem de conexão/colaboradora do número remetente é feita uma vez
  só, dentro de `disparos.model.js: validarNumeroEContatos`**, a mesma
  função interna já reaproveitada por `verificarDisparo()`/`criarDisparo()`
  — não há duplicação de lógica entre `POST /disparos/verificar` e
  `POST /disparos`, só o mapeamento HTTP do status devolvido é repetido em
  cada controller (mesmo padrão já usado para `numero_invalido`/
  `contatos_invalidos`). As duas checagens rodam **depois** da checagem de
  `numeroRemetenteId` existir/estar `ativo`/pertencer ao Estado, e **antes**
  de qualquer validação de `contatoIds` — nesta ordem: (1) conexão, (2)
  colaboradora, (3) contatos. Em `POST /disparos`, isso acontece dentro da
  mesma transação que faz os `INSERT`s — qualquer um dos dois novos status
  dá rollback antes de gravar `Disparos`/`DisparoContatos`, igual já
  acontecia para `numero_invalido`/`contatos_invalidos`.

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
Protegida por `authMiddleware` + `operadorCobrancaMiddleware`. **Sempre
grava quando chamada** — não existe modo "só verificar" nesta rota a
partir da v4 (isso é `POST /disparos/verificar`, seção 15). A expectativa
de uso é a tela chamar `POST /disparos/verificar` primeiro, mostrar
`avisos` ao usuário se houver, e só então chamar esta rota (com o mesmo
payload) para efetivar — mas o backend não impõe essa ordem.

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
4. `numeroRemetenteId` existe/está `ativo`/pertence ao Estado, mas
   `status_conexao != 'conectado'`:
   `{ "error": "Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar." }`
5. `numeroRemetenteId` conectado, mas `nome_colaboradora` é `NULL`, vazio ou
   só espaços (checado com `trim()`):
   `{ "error": "Este número não tem nome da colaboradora configurado. Preencha em Configurações antes de disparar." }`
6. Algum item de `contatoIds` em formato inválido ou de um `Contato` que não
   pertence a `estadoId`:
   `{ "error": "Todos os contatos devem pertencer ao estado informado." }`

O backend sempre recalcula todas as checagens acima contra o banco no
momento do `POST` — nunca confia em nenhum dado enviado pelo frontend além
dos ids. As validações 4 e 5 (conexão/colaboradora) existem para o operador
não descobrir só minutos depois, pelo worker de envio, que o disparo estava
fadado a falhar (ver "Contexto e decisões de design" acima).

#### Comportamento no banco (transação)
1. Valida `numeroRemetenteId` (existe, `ativo = 1`, `estado_id = @estadoId`).
2. Valida `status_conexao = 'conectado'` e `nome_colaboradora` preenchido
   (com conteúdo além de espaços) do mesmo `numeroRemetenteId`.
3. Valida que todo `contatoId` de `contatoIds` existe e tem
   `estado_id = @estadoId`.
4. Insere 1 linha em `Disparos` (`status = 'pendente_envio'`).
5. Insere 1 linha em `DisparoContatos` por `contatoId`.

Qualquer falha nos passos 1–3 dá `ROLLBACK` da transação antes de qualquer
`INSERT` — nada é gravado.

A partir da v4, este `POST` **não recalcula/devolve mais `avisos`** — quem
precisa do aviso de "contato já disparado nos últimos 3 dias" deve chamar
`POST /disparos/verificar` (seção 15) antes.

#### Resposta de sucesso — `201 Created`
```json
{
  "disparoId": 42,
  "totalContatos": 2
}
```

#### Erros
`400`/`500` (`{ "error": "Erro interno ao criar disparo." }`)

---

### 15. `POST /api/controle-ligacoes/disparos/verificar`

Nova na v4. Só verifica — **nunca grava nada no banco** (sem transação de
escrita, é leitura pura contra `NumerosRemetentes`/`Contatos`/`Disparos`/
`DisparoContatos`). Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`. Existe para o Painel de Disparo poder
mostrar `avisos` ao usuário (contatos já disparados nos últimos 3 dias)
**antes** de qualquer coisa ser gravada, dando a ele uma chance real de
cancelar — diferente da v3, em que o aviso só chegava depois que o
`POST /disparos` já tinha gravado o registro.

#### Corpo da requisição
Mesmo formato de `POST /disparos` (seção 14):
```json
{ "estadoId": 6, "numeroRemetenteId": 3, "contatoIds": [10, 11] }
```
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `estadoId` | number | sim | inteiro positivo |
| `numeroRemetenteId` | number | sim | inteiro positivo; deve existir, estar `ativo` e pertencer a `estadoId` |
| `contatoIds` | number[] | sim | não vazio, no máximo 10, cada item deve pertencer a `estadoId` |

#### Validações — `400 Bad Request` (nesta ordem, idênticas a `POST /disparos`)
1. `contatoIds` ausente/vazio: `{ "error": "Campo \"contatoIds\" é obrigatório." }`
2. `contatoIds.length > 10`: `{ "error": "Máximo de 10 contatos por disparo." }`
3. `numeroRemetenteId` (ou `estadoId`) em formato inválido, inexistente,
   não `ativo`, ou de outro Estado:
   `{ "error": "Número remetente inválido para o estado informado." }`
4. `numeroRemetenteId` existe/está `ativo`/pertence ao Estado, mas
   `status_conexao != 'conectado'`:
   `{ "error": "Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar." }`
5. `numeroRemetenteId` conectado, mas `nome_colaboradora` é `NULL`, vazio ou
   só espaços (checado com `trim()`):
   `{ "error": "Este número não tem nome da colaboradora configurado. Preencha em Configurações antes de disparar." }`
6. Algum item de `contatoIds` em formato inválido ou de um `Contato` que não
   pertence a `estadoId`:
   `{ "error": "Todos os contatos devem pertencer ao estado informado." }`

#### Comportamento no banco (leitura, sem transação de escrita)
1. Valida `numeroRemetenteId` (existe, `ativo = 1`, `estado_id = @estadoId`).
2. Valida `status_conexao = 'conectado'` e `nome_colaboradora` preenchido
   (com conteúdo além de espaços) do mesmo `numeroRemetenteId`.
3. Valida que todo `contatoId` de `contatoIds` existe e tem
   `estado_id = @estadoId` (a mesma query já recalcula
   `disparadoUltimos3Dias` de cada um).
4. Não insere nada em `Disparos`/`DisparoContatos`.

#### Resposta de sucesso — `200 OK`
```json
{
  "avisos": [
    { "contatoId": 10, "nome": "Maria Silva", "telefone": "5598900000000" }
  ]
}
```
Note que o campo é `contatoId` (não `id`, diferente do formato de `avisos`
que a v3 documentava dentro de `POST /disparos`) — mudança deliberada de
nome. Array vazio quando nenhum contato informado tinha
`disparadoUltimos3Dias = true`. Esta rota **não bloqueia** nada — mesmo com
`avisos` não vazio, cabe à tela decidir se pede confirmação ao usuário
antes de chamar `POST /disparos` de fato.

#### Erros
`400`/`500` (`{ "error": "Erro interno ao verificar disparo." }`)

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

## Conexão Baileys (v5)

> Adendo ao contrato v2 acima — implementa a **primeira metade** da
> integração com WhatsApp via Baileys: conectar um número remetente (gerar
> QR, escanear, manter a sessão viva, atualizar `numero`/`status_conexao`).
> Chamada de "v5" porque a v4 já foi usada pelo adendo do Painel de Disparo
> que separou `POST /disparos/verificar` de `POST /disparos` (ver seção
> "Painel de Disparo (v3, com adendo v4)" acima) — não há reaproveitamento
> de número de versão no meio do documento.
>
> **Deliberadamente fora deste adendo** (2ª metade, trabalho futuro): envio
> de mensagem de fato (worker de fila que consome `Disparos`/
> `DisparoContatos` e realmente manda algo pelo socket Baileys).

### Contexto e decisões de design

- **Baileys roda no mesmo processo do backend Node** (sem microsserviço
  separado). A sessão de cada número remetente é persistida em disco via
  `useMultiFileAuthState`, uma pasta por `numero_remetente_id`
  (`backend/sessions/baileys/{numeroRemetenteId}/`) — nunca versionada (ver
  `backend/.gitignore`).
- **QR entregue como string crua via Server-Sent Events**, não como imagem
  gerada no backend — o frontend renderiza o QR client-side com uma lib de
  QR (mais leve; evita adicionar `qrcode` como dependência do backend).
- **Gerenciamento de sessão isolado em `backend/src/services/baileysSession.service.js`**,
  com um `Map` em memória de `numeroRemetenteId → sessão` (socket Baileys
  ativo, listeners SSE, timers, contador de tentativas de reconexão). Esse
  service não conhece `req`/`res` — expõe `abrirConexao`,
  `removerListener`, `desconectar`, `getStatusEmMemoria`, chamadas pelo
  controller (`numerosRemetentes.controller.js`).
- **Um único socket Baileys por número remetente, reaproveitado por todas as
  abas/streams simultâneas.** `GET .../conexao/stream` chamado duas vezes
  para o mesmo `:id` (ex.: duas abas abertas) não cria duas sessões — a 2ª
  chamada apenas registra mais um "listener" na sessão já em memória, e
  ambas recebem os mesmos eventos (`qr`/`conectado`/`erro`) via broadcast. A
  2ª aba recebe imediatamente, ao conectar, o último QR já conhecido (ou um
  `conectado` imediato, numa corrida rara em que a sessão fechou entre a
  checagem do controller e o registro do listener), em vez de esperar até a
  próxima rotação de QR (~20s).
- **Fechar a aba antes do QR ser escaneado remove só aquele listener**
  (`req.on('close', ...)` no controller chama `removerListener`), sem matar
  a sessão Baileys em memória — outra aba pode continuar esperando o mesmo
  QR, ou o usuário pode reabrir a tela e continuar de onde parou.
- **Persistência no banco das transições assíncronas (`conectado` e
  `desconectado` por falha de reconexão) é feita diretamente por
  `baileysSession.service.js`**, não pelo controller — porque essas
  transições podem acontecer sem nenhum cliente SSE conectado no momento
  (ex.: o QR foi escaneado depois que a aba já tinha sido fechada, mas a
  sessão em memória seguia viva; ou uma sessão caiu horas depois de
  qualquer stream ter sido aberto). A desconexão **manual** (`POST
  .../desconectar`) é a exceção: como é uma ação explícita dentro de um
  único request/response, a gravação (`numero=NULL`,
  `status_conexao='aguardando_conexao'`) é feita pelo controller, depois
  que `baileysSession.service.js` confirma que a sessão foi encerrada.
- **`NumerosRemetentes.updateConexao` (novo, em `numerosRemetentes.model.js`)
  não usa `COALESCE`** como `updateNumero` (usado pelo `PUT` já existente):
  aqui cada campo enviado é gravado exatamente como recebido, inclusive
  `numero: null` explícito (necessário para *limpar* a coluna na
  desconexão — `COALESCE(NULL, numero)` manteria o valor antigo, o oposto
  do que se precisa). Um campo `undefined` simplesmente não entra no
  `SET` — por isso é possível atualizar só `status_conexao` (caso da
  reconexão automática esgotada) sem tocar em `numero`.
- **Timeout de QR: 2 minutos.** Se ninguém escanear dentro desse prazo, o
  stream recebe `event: erro` e a sessão em memória é encerrada (o socket é
  finalizado, a pasta de credenciais **não** é apagada apenas por esse
  motivo — só é apagada em `POST .../desconectar` ou num logout forçado
  pelo próprio WhatsApp). Uma nova chamada a `GET .../stream` depois disso
  começa um pareamento do zero.
- **Reconexão automática só se aplica a uma sessão que já chegou a ficar
  `'conectado'` e caiu de forma inesperada** (ex.: queda de rede) — até 3
  tentativas, com backoff simples (`tentativa * 2000ms`). Esgotadas as 3
  tentativas, `status_conexao` vira `'desconectado'` (diferente de
  `'aguardando_conexao'`, reservado para quando nunca houve conexão ou ela
  foi encerrada de propósito) — `numero` é preservado. Se a queda acontecer
  **antes** de completar o pareamento (sessão ainda `'conectando'`), não há
  retentativa em segundo plano: a sessão é encerrada e cabe ao operador
  abrir o stream de novo para tentar um pareamento novo.
- **Dois casos especiais de fechamento de conexão do próprio Baileys são
  tratados fora do fluxo de retentativa genérico:**
  - `DisconnectReason.restartRequired` (515): passo normal logo após o
    pareamento via QR — o socket é recriado imediatamente com as mesmas
    credenciais, sem contar como tentativa de reconexão nem gerar nenhum
    evento visível ao usuário.
  - `DisconnectReason.loggedOut` (401): a sessão foi invalidada pelo
    próprio WhatsApp (ex.: removida no celular) — não há como reconectar
    sem novo QR; a pasta de credenciais é apagada e `status_conexao` volta
    para `'aguardando_conexao'` (com `numero=NULL`), igual a uma
    desconexão manual.
- **Reconciliação de sessões no boot do processo** (`reconciliarSessoesNoBoot`,
  em `baileysSession.service.js`, chamada uma única vez a partir de
  `server.js`, em paralelo ao `app.listen` — não bloqueia o processo subir):
  se o processo Node reiniciar enquanto um `NumerosRemetentes.status_conexao`
  ainda está `'conectado'` no banco, o `Map` em memória (`sessoes`) se perde
  no restart, mas o banco continua dizendo `'conectado'` — enganando
  qualquer tela/worker que confie nesse campo sem checar se existe socket
  vivo de verdade. No boot, a rotina busca todos os `NumerosRemetentes` com
  `status_conexao = 'conectado'` e, **em sequência** (nunca em paralelo, para
  não abrir várias conexões Baileys de uma vez), tenta restaurar cada um a
  partir da pasta de credenciais já salva em disco
  (`backend/sessions/baileys/{numeroRemetenteId}/`), reaproveitando o mesmo
  caminho de abertura de socket que o fluxo de pareamento por QR já usa
  (`iniciarSocket`/`handleConnectionUpdate`) — só que sem UI esperando por
  QR algum:
  - **Sucesso** (Baileys reconecta com as credenciais salvas,
    `connection === 'open'` de novo, sem nunca pedir `qr`): `status_conexao`
    permanece `'conectado'` (a mesma gravação de sempre, via
    `persistirConectado`) e a sessão fica no `Map` como se tivesse acabado
    de conectar via QR.
  - **Falha** — pasta de credenciais ausente em disco, o Baileys emitir `qr`
    de novo (tratado como credencial inválida — nesse caso a rotina não fica
    esperando alguém escanear no boot), logout/erro definitivo reportado
    pelo Baileys, ou um timeout curto por número (produção: 20s) sem
    resolver nem `open` nem `close`: `status_conexao` vira `'desconectado'`
    e `numero=NULL`, a pasta de sessão órfã é removida do disco, e nenhuma
    entrada fica pendurada no `Map`.
  - Há um pequeno intervalo entre uma tentativa e a próxima (produção:
    2.5s), só para não sobrecarregar o processo/Baileys logo no boot.
  - **Efeito observável**: a reconciliação não é instantânea. Um número que
    estava `'conectado'` antes de um restart do processo pode aparecer
    brevemente ainda como `'conectado'` no banco/na tela até a rotina
    terminar de processá-lo (pode levar alguns segundos por número, em
    sequência) — não presuma que o status já reflete a realidade nos
    primeiros instantes depois do processo subir.
  - A rotina nunca rejeita/derruba o processo — qualquer erro inesperado
    (inclusive falha ao consultar o banco) é capturado e só logado.

### `GET /api/controle-ligacoes/numeros-remetentes/:id/conexao/stream` (SSE)

Abre (ou reaproveita) a sessão Baileys daquele número remetente e transmite
os eventos de conexão conforme acontecem. Protegida por `authMiddleware` +
`operadorCobrancaMiddleware` (herdado do mount, igual ao resto do módulo).

#### Parâmetros
| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `:id` | path, number | sim | inteiro positivo; `400` se não for |

#### Eventos emitidos (`Content-Type: text/event-stream`)
| Evento | Payload | Quando |
|---|---|---|
| `qr` | `{ "qr": "<string crua>" }` | a cada QR novo emitido pelo Baileys (~20s até escanear) |
| `conectado` | `{ "numero": "5598999999999" }` | conexão confirmada — `NumerosRemetentes.numero`/`status_conexao='conectado'` já foram gravados no banco antes deste evento ser emitido |
| `erro` | `{ "mensagem": "..." }` | falha ao conectar, timeout de QR (2 min) sem escaneamento, ou logout forçado pelo WhatsApp |
| `ja_conectado` | `{ "numero": "5598999999999" }` | `:id` já está `status_conexao='conectado'` no banco no momento em que o stream foi aberto — **nenhuma sessão/QR novo é aberta**; o stream é encerrado logo em seguida |

O stream é encerrado pelo servidor após `conectado`, `erro`, ou
`ja_conectado` (nunca fica aberto indefinidamente após um desses três).

#### Erros
- `400`: `{ "error": "Parâmetro \"id\" deve ser um número inteiro positivo." }`
- `404`: `{ "error": "Número remetente não encontrado." }`
- `500`: `{ "error": "Erro interno ao abrir conexão com o WhatsApp." }` (antes de qualquer header SSE ter sido enviado; se a falha acontecer depois, vira `event: erro` dentro do próprio stream, já com `200` na resposta)

---

### `POST /api/controle-ligacoes/numeros-remetentes/:id/conexao/desconectar`

Encerra a sessão Baileys daquele número remetente (logout + remoção da
pasta de sessão em disco) e grava `numero=NULL`/
`status_conexao='aguardando_conexao'`. Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Parâmetros
| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `:id` | path, number | sim | inteiro positivo; `400` se não for |

#### Resposta de sucesso — `200 OK`
Mesmo formato de objeto que `PUT /numeros-remetentes/:id` já devolve hoje
(`{ id, apelido, numero: null, statusConexao: "aguardando_conexao", ativo, criado_em, estado }`).

#### Erros
- `400`: `{ "error": "Parâmetro \"id\" deve ser um número inteiro positivo." }`
- `404`: `{ "error": "Número remetente não encontrado." }`
- `500`: `{ "error": "Erro interno ao desconectar número remetente." }`

#### Observação
Idempotente na prática: chamar esta rota para um número que já está
`'aguardando_conexao'` (sem sessão em memória) não falha — `baileysSession.service.js`
simplesmente não encontra nada para encerrar em memória, mas ainda tenta
remover a pasta de sessão em disco (sem erro se ela não existir) antes do
controller gravar `numero=NULL`/`status_conexao='aguardando_conexao'`
(valores que, nesse caso, já eram os mesmos).

---

## Envio de Disparos (v6)

> Adendo ao contrato v2 acima — implementa a **segunda metade** da
> integração com WhatsApp via Baileys: o worker que consome a fila de
> `DisparoContatos` pendentes (gravada pelo Painel de Disparo, ver seção
> anterior) e envia de fato a primeira mensagem de cada contato, com
> rotação round-robin de templates. Chamado de "v6" porque "v5" já foi usado
> pelo adendo "Conexão Baileys" logo acima — não há reaproveitamento de
> número de versão no meio do documento (nota: o rascunho inicial desta
> tarefa sugeria "v4", mas esse número já pertence à separação
> verificar/criar de `POST /disparos`, e "v5" já pertence à Conexão
> Baileys — corrigido para "v6" ao escrever este adendo).
>
> **Deliberadamente fora deste adendo**: qualquer CRUD para
> `MensagensTemplates`. `NumerosRemetentes.nome_colaboradora` passou a ser
> editável via `PUT /api/controle-ligacoes/numeros-remetentes/:id` (seção 7
> acima, campo `nomeColaboradora`) numa tarefa posterior a este adendo — ver
> "Lacuna conhecida" no fim desta seção, atualizada para refletir isso.

### Contexto e decisões de design

- **O worker roda dentro do próprio processo backend** (`setInterval`,
  iniciado a partir de `server.js` junto com `reconciliarSessoesNoBoot`),
  sem processo/fila separados — mesmo princípio de todo o resto da
  integração Baileys deste projeto.
- **Processamento sempre em sequência, nunca em paralelo** — tanto os itens
  de um mesmo lote/ciclo quanto os ciclos entre si (um `setInterval` que
  disparasse antes do ciclo anterior terminar é pulado, não executado em
  paralelo) — paralelismo quebraria o delay entre mensagens, que é uma
  exigência de mitigação de risco de banimento do número, não só
  performance.
- **Um contato pertence a um Estado fixo, mas o número usado no disparo é
  uma escolha feita naquele disparo** (ver "Painel de Disparo" acima) — o
  worker só lê `Disparos.numero_remetente_id` (gravado no momento do
  disparo), nunca recalcula ou reatribui esse vínculo.
- **Rotação round-robin de templates**: a cada envio bem-sucedido, o próximo
  template ativo (por `ordem`, ciclando de volta ao primeiro depois do
  último) é calculado e só persistido em `ConfiguracoesEnvio.ultimo_template_usado_id`
  **junto com** a gravação do sucesso do próprio `DisparoContatos`, na mesma
  transação — um envio que falha (pré-condição não satisfeita, ou o
  `sock.sendMessage` de fato rejeitar) nunca avança a rotação.
- **Transação curta, desenhada para nunca ficar aberta durante a chamada de
  rede ao Baileys** (que pode levar segundos): o cálculo de qual seria o
  próximo template é uma leitura curta, fora de transação; a chamada
  `sock.sendMessage` acontece depois, também fora de transação; só a
  gravação do resultado de sucesso (`DisparoContatos` + `ConfiguracoesEnvio`)
  é uma transação curta e atômica. Isso abre uma janela teórica de condição
  de corrida no cálculo do "próximo" template entre itens processados quase
  ao mesmo tempo — não mitigada com `UPDLOCK`/`HOLDLOCK` nesta fase porque
  (a) o worker processa a fila estritamente em sequência e (b) hoje só
  existe uma única instância do worker rodando (sem deploy
  multi-processo/multi-instância). Revisitar se isso mudar.
- **Nenhum retry automático nesta fase**: um item que falha fica
  `status='falha'` e nunca é reprocessado sozinho — reenviar exigiria uma
  ação manual futura (fora de escopo deste adendo).

### Schema novo

```sql
CREATE TABLE MensagensTemplates (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    corpo      NVARCHAR(MAX) NOT NULL,   -- placeholder suportado: {nomeColaboradora}
    ordem      INT NOT NULL,
    ativo      BIT NOT NULL DEFAULT 1,
    criado_em  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE ConfiguracoesEnvio (           -- linha única
    id                        INT IDENTITY(1,1) PRIMARY KEY,
    ultimo_template_usado_id  INT NULL FOREIGN KEY REFERENCES MensagensTemplates(id)
);

ALTER TABLE NumerosRemetentes ADD nome_colaboradora NVARCHAR(150) NULL;

ALTER TABLE DisparoContatos ADD status             VARCHAR(20) NOT NULL DEFAULT 'pendente'; -- 'pendente' | 'enviado' | 'falha'
ALTER TABLE DisparoContatos ADD template_usado_id   INT NULL FOREIGN KEY REFERENCES MensagensTemplates(id);
ALTER TABLE DisparoContatos ADD mensagem_enviada    NVARCHAR(MAX) NULL;
ALTER TABLE DisparoContatos ADD enviado_em          DATETIME2 NULL;
ALTER TABLE DisparoContatos ADD erro                NVARCHAR(500) NULL;
```

Criado por `backend/src/scripts/MIGRATION-ENVIO-DISPAROS.sql` (idempotente,
`IF NOT EXISTS`/`IF COL_LENGTH`, mesmo padrão de `MIGRATION-DISPAROS.sql`).
A migration também garante uma linha única em `ConfiguracoesEnvio`
(`ultimo_template_usado_id = NULL`), inserida só se a tabela estiver vazia.
**Este script ainda não foi executado contra nenhum banco** — precisa
rodar manualmente (local: `erp-novagest-dev`) antes do worker/da rota
funcionarem de verdade.

### Lacuna conhecida: sem CRUD para `MensagensTemplates` (`nome_colaboradora` já resolvido)

Não existe, nesta fase, nenhuma rota para criar/editar templates de
mensagem (`MensagensTemplates`) — a única forma de popular essa tabela é SQL
direto contra o banco. **Atualização**: `NumerosRemetentes.nome_colaboradora`
deixou de ser parte dessa lacuna — é editável via `PUT
/api/controle-ligacoes/numeros-remetentes/:id` (campo `nomeColaboradora`,
seção 7), exposto também em `GET`/`POST` da mesma rota (seções 5–6). Sem
`MensagensTemplates` populado manualmente, o worker continua gravando
`status='falha'` para todo item pendente cujo número não tenha
`nome_colaboradora` configurado (`'Número sem nome de colaboradora
configurado.'`) ou sem nenhum template ativo (`'Nenhum template de mensagem
ativo cadastrado.'`) — a diferença é que o primeiro caso agora pode ser
corrigido pela UI/API, não só por SQL direto.

### O worker: `backend/src/workers/envioDisparos.worker.js`

Inicia junto com o processo backend (`server.js`, ao lado de
`reconciliarSessoesNoBoot`) — não é uma rota HTTP, não tem endpoint próprio.

#### Configuração (variáveis de ambiente, todas opcionais)

| Variável | Default | O que controla |
|---|---|---|
| `ENVIO_DISPAROS_INTERVALO_MS` | `15000` | intervalo entre um ciclo do worker e o próximo |
| `ENVIO_DISPAROS_LOTE_TAMANHO` | `5` | quantos itens `status='pendente'` são buscados por ciclo |
| `ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS` | `4000` | delay aplicado entre tentativas de envio reais dentro do mesmo ciclo |

#### A cada ciclo

1. Busca até `ENVIO_DISPAROS_LOTE_TAMANHO` linhas de `DisparoContatos` com
   `status='pendente'` (mais antigas primeiro), via JOIN com `Disparos`
   (pega `numero_remetente_id`) e `Contatos` (pega `telefone`/`nome`).
2. Processa cada uma **em sequência** (nunca em paralelo):
   1. Checa, **nesta ordem**: sessão Baileys `'conectado'` em memória, depois
      `NumerosRemetentes.nome_colaboradora` preenchido. Falha em qualquer um
      dos dois grava `status='falha'` com a mensagem correspondente
      (`'Número não está conectado.'` ou `'Número sem nome de colaboradora
      configurado.'`) e **não** consome/avança a rotação de template — não
      houve nenhuma tentativa de envio de fato.
   2. Calcula (sem persistir ainda) o próximo template ativo na rotação
      round-robin — lê `ConfiguracoesEnvio.ultimo_template_usado_id` e a
      lista de `MensagensTemplates` ativos (por `ordem`); se
      `ultimo_template_usado_id` for `NULL` ou não bater com nenhum template
      ativo, começa do primeiro; cicla de volta ao primeiro depois do
      último. Se não houver **nenhum** template ativo: `status='falha'`,
      `erro='Nenhum template de mensagem ativo cadastrado.'`, sem consumir
      rotação (não havia o que consumir).
   3. Monta a mensagem substituindo `{nomeColaboradora}` no corpo do
      template escolhido.
   4. Obtém o socket Baileys ativo e chama `sock.onWhatsApp(telefone)` para
      confirmar, contra os servidores do WhatsApp, que aquele número
      corresponde de fato a uma conta ativa — necessário porque
      `sock.sendMessage` pode resolver com sucesso mesmo quando o número não
      existe no WhatsApp (não lança exceção nesse caso), e o telefone salvo
      em `Contatos.telefone` pode não bater com a variante que o WhatsApp tem
      registrada (ex.: 9º dígito de celular). Se `onWhatsApp` não encontrar
      nenhuma correspondência (`exists`/`jid` ausentes na resposta) ou
      lançar um erro inesperado (falha de rede, etc.): `status='falha'`,
      `erro='Número não possui WhatsApp ativo ou não pôde ser verificado.'`
      (ou a mensagem do erro de verificação, se foi exceção), **sem** chamar
      `sock.sendMessage` e **sem** consumir/avançar a rotação de template —
      mesma regra de "sem tentativa real" já aplicada no passo 2.1.
   5. Se `onWhatsApp` confirmou a existência, chama
      `sock.sendMessage(jid, { text: mensagem })` usando o `jid` **devolvido
      por `onWhatsApp`** no passo anterior — não o telefone concatenado
      manualmente (`"{telefone}@s.whatsapp.net"`); os dois podem divergir.
      - **Sucesso**: grava, numa única transação,
        `DisparoContatos.status='enviado'` (+ `template_usado_id`,
        `mensagem_enviada`, `enviado_em`) **e**
        `ConfiguracoesEnvio.ultimo_template_usado_id` — as duas gravações
        nunca acontecem uma sem a outra.
      - **Falha** (exceção do `sendMessage`, ou o socket ter caído entre a
        checagem do passo 2.1 e agora): `status='falha'`, `erro=<mensagem
        do erro>`, **sem** tocar em `ConfiguracoesEnvio` (a rotação não
        avança) e sem retry automático.
3. Delay (`ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS`) aplicado sempre que o
   worker chegou a gerar tráfego de rede de verdade — sucesso ou falha nos
   passos 2.4 (verificação via `onWhatsApp`) ou 2.5 (`sendMessage`); um item
   que falhou já no passo 2.1 ou 2.2 (sem sessão conectada, sem
   `nome_colaboradora` ou sem template ativo — nenhum tráfego de rede pro
   WhatsApp) não consome esse delay antes do próximo item do lote.

O worker nunca lança/derruba o processo — qualquer erro inesperado (falha ao
buscar o lote, falha ao gravar no banco) é capturado e só logado.

### `GET /api/controle-ligacoes/disparos/:id`

Detalhe de um disparo específico: Estado, Número Remetente e a lista de
contatos daquele disparo com o status individual de envio de cada um
(`'pendente'` | `'enviado'` | `'falha'`). Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Parâmetros
| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `:id` | path, number | sim | inteiro positivo; `400` se não for |

#### Resposta de sucesso — `200 OK`
```json
{
  "disparoId": 15,
  "estado": { "id": 6, "nome": "Maranhão", "uf": "MA" },
  "numeroRemetente": { "id": 3, "apelido": "CDC Cohatrac" },
  "contatos": [
    {
      "nome": "Maria Silva",
      "telefone": "5598900000000",
      "status": "enviado",
      "mensagemEnviada": "...",
      "enviadoEm": "2026-...",
      "erro": null
    }
  ]
}
```

#### Erros
- `400`: `{ "error": "Parâmetro \"id\" deve ser um número inteiro positivo." }`
- `404`: `{ "error": "Disparo não encontrado." }`
- `500`: `{ "error": "Erro interno ao buscar detalhe do disparo." }`

---

## Central de Mensagens (v7)

> Adendo ao contrato v2 acima — implementa a **primeira funcionalidade** da
> Central de Mensagens: captura de mensagens recebidas via Baileys (listener
> `messages.upsert`), integração com o worker de envio já existente (toda
> mensagem que a IA manda também vira uma linha em `Mensagens`), e as 3
> rotas REST que uma tela de inbox vai consumir numa fase posterior (a tela
> em si **não** faz parte deste adendo — fica para quem implementar o
> frontend depois). Ganhou depois uma 4ª rota, `GET .../conversas/stream`
> (SSE — ver rota 4 abaixo), para a tela de Conversas não depender só de
> atualização manual/polling. Ganhou depois ainda a coluna
> `e_primeira_resposta_cliente` em `Mensagens`, o campo `primeiraResposta`
> no payload SSE de `nova-mensagem`, e uma 5ª rota, `GET .../notificacoes`
> — juntos, a base do sino de notificações do frontend (ver "Sino de
> notificações" e rota 5 abaixo), que conta só a PRIMEIRA resposta de cada
> contato (handoff IA→humano) ainda não vista, não toda mensagem nova.
>
> **Deliberadamente fora deste adendo**: qualquer tela/rota de "iniciar"
> uma conversa nova (só é possível responder um contato que já tem pelo
> menos 1 mensagem recebida — ver `POST .../mensagens`), handoff
> automático IA→Lívia, indicador de "digitando", suporte a mídia (áudio,
> imagem, documento — mensagens desse tipo viram um texto placeholder fixo,
> ver "Contexto e decisões de design" abaixo), e paginação de
> `GET .../mensagens` (devolve o histórico inteiro do contato de uma vez).

### Contexto e decisões de design

- **O listener roda dentro da própria sessão Baileys já gerenciada por
  `baileysSession.service.js`** — registrado em `iniciarSocket`, ao lado
  dos listeners de `creds.update`/`connection.update` já existentes, o que
  cobre automaticamente todos os caminhos que criam um socket novo (QR
  normal, reconexão automática, restauração no boot), sem duplicar código.
- **Só processa eventos `messages.upsert` com `type === 'notify'`** — o
  Baileys também emite esse evento com `type: 'append'` durante
  sincronização de histórico, o que acontece sobretudo quando uma sessão é
  **restaurada na reconciliação de boot** (`restaurarSessaoNoBoot`).
  Processar `'append'` inundaria `Mensagens` com histórico antigo toda vez
  que o processo reinicia — qualquer `type` diferente de `'notify'` é
  ignorado silenciosamente (comportamento esperado, não uma falha, não
  logado como erro).
- **Mensagens com `key.fromMe === true` NÃO são mais ignoradas** (mudança
  posterior à v7 original). A hipótese inicial era que `fromMe===true`
  seria sempre o eco de uma mensagem que o próprio número enviou (worker de
  envio ou rota de resposta manual), o que duplicaria a linha se gravado de
  novo — **confirmado por teste real que essa hipótese estava errada**: o
  Baileys nunca emite `messages.upsert`/`type:'notify'` pro que o próprio
  socket do backend acabou de enviar via `sock.sendMessage`; todo
  `fromMe===true` que chega neste listener é sempre uma mensagem que o
  atendente mandou manualmente pelo próprio celular (fora do fluxo
  automático), e estava sumindo silenciosamente antes desta correção.
  `handleMessagesUpsert` agora captura `const ehDoAtendente =
  msg?.key?.fromMe === true` e deixa a mensagem seguir o fluxo normal
  (resolver telefone, achar contato, desembrulhar envelope, extrair texto),
  gravando com `remetente: ehDoAtendente ? 'atendente' : 'cliente'`. Quando
  `ehDoAtendente`, `ePrimeiraRespostaCliente` é forçado `false` sem chamar
  `existeMensagemClienteAnterior` (não faz sentido essa checagem pra
  mensagem que não é do cliente) — ver "Sino de notificações" abaixo. O
  valor `'atendente'` em `Mensagens.remetente` (coluna `VARCHAR(20)`, sem
  `CHECK` de enum no schema) se soma a `'cliente'`/`'ia'`/`'colaboradora'`
  já existentes.
- **Dedup via índice único FILTRADO, não checagem prévia**: em vez de fazer
  um `SELECT` antes de cada `INSERT` para checar se aquele
  `baileys_message_id` já foi processado, a tabela tem
  `CREATE UNIQUE INDEX UQ_Mensagens_baileysId ON Mensagens
  (numero_remetente_id, baileys_message_id) WHERE baileys_message_id IS NOT
  NULL` e o model captura a violação (driver `mssql`: `err.number === 2627`
  ou `2601`) e ignora em silêncio (log informativo, não erro) — mais
  simples e sem condição de corrida entre checagem e gravação.
  **Correção de bug (visto em produção/teste)**: a versão original desta
  tabela usava uma `UNIQUE CONSTRAINT` simples em vez de um índice
  filtrado, com a premissa incorreta de que "SQL Server trata múltiplos
  `NULL` numa `UNIQUE CONSTRAINT` como não-conflitantes" — isso é **falso**
  para uma constraint simples (que permite no máximo UM `NULL` por
  combinação das demais colunas) e só é verdadeiro para um **índice único
  filtrado**. Como toda mensagem enviada por nós (`remetente IN ('ia',
  'colaboradora')`) grava `baileys_message_id = NULL`, a constraint antiga
  bloqueava a SEGUNDA mensagem nossa para o mesmo número remetente
  ("Violation of UNIQUE KEY constraint" ao responder mais de uma vez pela
  tela de Conversas). O índice filtrado acima corrige isso: linhas com
  `baileys_message_id IS NULL` são inteiramente ignoradas na checagem de
  unicidade, então mensagens nossas nunca colidem entre si nem com nada; a
  proteção original (não duplicar o mesmo evento `messages.upsert` recebido
  duas vezes) continua intacta.
- **Mensagem de mídia (áudio, imagem, documento, etc.) — ou qualquer tipo
  não reconhecido depois de desembrulhar os envelopes conhecidos (ver passo
  4 abaixo) — vira um texto placeholder fixo**
  (`'[Mensagem de mídia não suportada nesta versão]'`); o listener só
  extrai texto real de `conversation`/`extendedTextMessage.text` na
  mensagem JÁ desembrulhada. Tratamento de mídia de verdade (download/
  armazenamento do arquivo) é trabalho futuro.
- **Telefone não encontrado em `Contatos` (ex.: mensagem de um grupo, ou de
  um número fora da base) é ignorado silenciosamente** (log informativo) —
  a Central de Mensagens só existe para contatos já importados; não cria
  `Contatos` novos a partir de mensagens recebidas.
- **`POST /conversas/:contatoId/:numeroRemetenteId/mensagens` responde
  sempre pelo `numeroRemetenteId` informado na própria rota** — mudança
  posterior à v7 original; antes a rota (sem esse segmento) inferia o
  número olhando a mensagem mais recente da conversa
  (`findUltimoNumeroRemetenteDaConversa`, função que ficou sem uso, ainda
  existe no model mas não é mais chamada por nenhuma rota), o que ficou sem
  sentido depois que cada [contato, número] virou uma thread própria — não
  existe seleção manual de número na resposta, ao contrário do Painel de
  Disparo. Consequência: só é possível responder uma thread que já tem
  histórico (`existeMensagemNaThread`, ver "Mudança de modelo: threads por
  [contato, número]" abaixo) — sem isso, `400` (ver rota 3 abaixo).
- **A mesma checagem `sock.onWhatsApp(telefone)` do worker de envio é
  reaplicada aqui** antes de `sock.sendMessage`, pelo mesmo motivo
  documentado na seção "Envio de Disparos (v6)": `sendMessage` pode
  resolver com sucesso mesmo quando o número não existe de fato no
  WhatsApp, e o telefone salvo em `Contatos.telefone` pode não bater com a
  variante que o WhatsApp tem registrada. O `jid` usado em `sendMessage` é
  sempre o devolvido por `onWhatsApp`, nunca o telefone concatenado
  manualmente.

### Schema novo

```sql
CREATE TABLE Mensagens (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    contato_id             INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    numero_remetente_id    INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    remetente              VARCHAR(20) NOT NULL,   -- 'cliente' | 'ia' | 'colaboradora' | 'atendente'
    corpo                  NVARCHAR(MAX) NOT NULL,
    baileys_message_id     VARCHAR(100) NULL,      -- preenchido em mensagens que chegam via listener ('cliente' ou 'atendente')
    lida                   BIT NOT NULL DEFAULT 0,
    e_primeira_resposta_cliente BIT NOT NULL DEFAULT 0, -- ver "Sino de notificações" abaixo
    criado_em              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Unicidade de baileys_message_id garantida por um ÍNDICE ÚNICO FILTRADO
-- (não uma UNIQUE CONSTRAINT simples — ver "Contexto e decisões de design"
-- acima para o porquê dessa correção):
CREATE UNIQUE INDEX UQ_Mensagens_baileysId
ON Mensagens (numero_remetente_id, baileys_message_id)
WHERE baileys_message_id IS NOT NULL;
```

Criado por `backend/src/scripts/MIGRATION-MENSAGENS.sql` (idempotente,
`IF NOT EXISTS`, mesmo padrão de `MIGRATION-DISPAROS.sql` — inclui também
um passo de correção que remove a `UNIQUE CONSTRAINT` antiga com bug, caso
um banco já tenha rodado uma versão anterior desta migration). **Este
script ainda não foi executado contra nenhum banco** — precisa rodar
manualmente (local: `erp-novagest-dev`) antes do listener/worker/rotas
abaixo funcionarem de verdade.

`lida` só tem sentido para `remetente='cliente'` (mensagem enviada por nós
não tem o conceito de "não lida" do ponto de vista do operador) — as
funções de leitura nunca filtram/contam `lida` para `remetente IN ('ia',
'colaboradora')`.

`e_primeira_resposta_cliente` foi adicionada depois, por
`backend/src/scripts/MIGRATION-NOTIFICACOES.sql` (idempotente,
`IF NOT EXISTS` via `sys.columns`, mesmo padrão de
`MIGRATION-ENVIO-DISPAROS.sql`) — ver "Sino de notificações" abaixo para o
propósito e a rota que a consome. **Este script também ainda não foi
executado contra nenhum banco** — precisa rodar manualmente (local:
`erp-novagest-dev`, depois de `MIGRATION-MENSAGENS.sql` já ter rodado)
antes do listener/rota abaixo funcionarem de verdade.

### O listener: `baileysSession.service.js` (`messages.upsert`)

Registrado dentro de `iniciarSocket(numeroRemetenteId, sessao)`, ao lado dos
listeners já existentes:

```js
sock.ev.on('messages.upsert', (upsert) => {
  handleMessagesUpsert(numeroRemetenteId, sock, upsert).catch((err) => {
    console.error(`[baileysSession] erro inesperado tratando messages.upsert (numeroRemetenteId=${numeroRemetenteId}):`, err);
  });
});
```

Para cada evento com `type === 'notify'`, e para cada `msg` em
`upsert.messages`:

1. Captura `const ehDoAtendente = msg.key.fromMe === true` — **NÃO ignora
   mais** essas mensagens (mudança posterior à v7 original, ver bloco
   acima sobre o bug corrigido); a mensagem segue o fluxo normal dos
   passos 2–6 abaixo, com `ehDoAtendente` usado nos passos 5 e 6 pra
   decidir `remetente`/`ePrimeiraRespostaCliente`.
2. Resolve o telefone real do remetente a partir de `msg.key`
   (`resolverTelefoneDoRemetente`, em `baileysSession.service.js`):
   - Se `msg.key.remoteJid` terminar em `@s.whatsapp.net` (ou `@g.us`/outro
     sufixo de grupo — normalizado do mesmo jeito, sem tratamento especial):
     extrai o telefone normalizado (só dígitos, sufixo de servidor e de
     dispositivo removidos) diretamente do `remoteJid`.
   - **Correção de bug (causa raiz de "mensagens recebidas não aparecem na
     Central de Mensagens")**: o WhatsApp moderno frequentemente endereça o
     remetente por um **LID** (`msg.key.remoteJid` termina em `@lid` — um
     identificador interno de ~15 dígitos, **não** o telefone) em vez de
     `@s.whatsapp.net`. Extrair dígitos direto de um `@lid` produzia um
     "telefone" que nunca batia com nenhum `Contatos.telefone`, e a
     mensagem era descartada com um log que sugeria erroneamente que o
     telefone tinha sido extraído certo mas não encontrado na base. Quando
     `remoteJid` termina em `@lid`, a resolução tenta, nesta ordem
     (confirmado contra o código-fonte de `@whiskeysockets/baileys@7.0.0-rc14`
     — reconfirme se a lib for atualizada, os nomes de campo não são
     documentação pública estável):
     1. `msg.key.remoteJidAlt` — quando presente, é a contrapartida em
        telefone/PN que o próprio Baileys já inclui no envelope da
        mensagem; só é usado se `jidDecode` confirmar que ele mesmo não é
        outro `@lid`.
     2. `sock.signalRepository.lidMapping.getPNForLID(remoteJid)` — cache/
        armazenamento persistente de pares LID↔PN que o Baileys mantém por
        conta própria; só resolve se algum evento anterior já tiver
        alimentado esse mapeamento para aquele remetente.
     Se nenhuma das duas fontes resolver, a mensagem é ignorada com um log
     explícito de **"LID não resolvido"** (diferente do log de "telefone
     sem Contato correspondente" do passo 3 — são causas bem diferentes:
     uma é "não sabemos o telefone", a outra é "sabemos o telefone e não
     está na nossa base").
3. Busca o `Contato` correspondente. **Segundo bug corrigido** (também
   causa de "mensagens recebidas não aparecem na Central de Mensagens",
   diferente do bug de LID do passo 2): o servidor do WhatsApp às vezes
   representa a conta do remetente **sem o 9º dígito** do celular
   brasileiro (formato pré-2012) mesmo quando o número de discagem real
   inclui o 9 — ambiguidade real do lado do WhatsApp, não um erro de
   captura. Caso real de teste: `remoteJid` chegou como `558582336124` (12
   dígitos, sem o 9) via `@s.whatsapp.net` direto, mas o `Contato` estava
   gravado como `5585982336124` (13 dígitos, com o 9) — a busca exata
   falhava e a mensagem era descartada. A busca agora tenta, numa única
   query `SELECT TOP (1) id FROM Contatos WHERE telefone IN (...)`
   (`findContatoIdPorTelefoneComVariantes`, em `mensagens.model.js`), o
   telefone recebido **e**, quando o formato bate com `55`+DDD (2
   dígitos)+número de celular (12 dígitos sem o 9 ↔ 13 dígitos com o 9), a
   variante com/sem o 9º dígito (`gerarVariantesTelefoneBr`, em
   `baileysSession.service.js`); qualquer outro formato/tamanho tenta só o
   telefone original. Como `Contatos.telefone` é `UNIQUE` globalmente, no
   máximo uma linha pode bater. Se nenhum candidato encontrar, ignora a
   mensagem (log informativo, mostrando o telefone original recebido, não
   as variantes tentadas).
4. **Desembrulha envelopes conhecidos antes de extrair o texto**
   (`desembrulharMensagem`, em `baileysSession.service.js`) — **terceiro bug
   corrigido** (causa raiz confirmada de "mensagens de TEXTO PURO somem por
   completo da Central de Mensagens", sem sequer virar placeholder de mídia
   nem deixar log nenhum): o WhatsApp aninha o conteúdo real de uma mensagem
   dentro de um ou mais envelopes quando a conversa tem **mensagens
   temporárias/efêmeras** ativadas (`message.ephemeralMessage.message`) ou
   quando a mensagem é "ver uma vez" (`message.viewOnceMessage.message` /
   `message.viewOnceMessageV2.message`, duas versões de payload que o
   Baileys usa dependendo da versão do app do remetente). Sem desembrulhar
   isso primeiro, `msg.message.conversation`/`msg.message.extendedTextMessage.text`
   nunca batiam — a mensagem de texto virava, na melhor das hipóteses, um
   placeholder de mídia incorreto. `desembrulharMensagem` percorre esses 3
   envelopes recursivamente (limite de 5 níveis), então uma combinação como
   ephemeral contendo viewOnce também é resolvida. Só depois desse
   desembrulhamento é que o código tenta `conversation`/
   `extendedTextMessage.text`; sem nenhum dos dois, cai no placeholder de
   mídia (mesmo comportamento de antes, preservado para mídia real).
   - **`protocolMessage` (edição de mensagem existente) — decisão
     explícita**: depois de desembrulhar, se o resultado tiver a chave
     `protocolMessage` (o WhatsApp usa esse tipo para vários eventos
     internos: edição de mensagem, revogação, mudança de configuração de
     mensagem temporária, sincronização de histórico...), a mensagem é
     **ignorada deliberadamente, sem gravar nenhuma linha em `Mensagens`**,
     com um log explícito (`"mensagem de edição (protocolMessage), ignorada
     nesta versão"`, incluindo `numeroRemetenteId`/`contatoId`/
     `baileysMessageId`/`protocolType`). Escolhida em vez de gravar o texto
     editado como uma nova linha porque reconstruir/representar uma edição
     de mensagem já existente está fora do escopo desta correção — o ponto
     crítico é que esse `continue` **sempre** vem acompanhado de log, nunca
     é um caminho silencioso equivalente ao bug original.
   - **Log de debug para tipo não reconhecido**: se, depois de desembrulhar
     e de descartar `protocolMessage`, o objeto de mensagem não bater com
     `conversation` nem `extendedTextMessage` (ex.: um tipo de mídia real,
     ou algum tipo futuro ainda não tratado), `extrairTextoDaMensagem` loga
     (`console.log`) as chaves de nível superior desse objeto
     (`Object.keys(...)`) antes de cair no placeholder — facilita achar
     rapidamente o próximo tipo não coberto sem precisar investigar do zero.
5. **Antes de inserir**, decide `ePrimeiraRespostaCliente`: se
   `ehDoAtendente` (passo 1), é sempre `false` **sem** chamar
   `existeMensagemClienteAnterior` (não faz sentido essa checagem pra
   mensagem que não é do cliente); senão, checa
   `mensagensModel.existeMensagemClienteAnterior(contatoId,
   numeroRemetenteId)` (2 parâmetros desde a mudança pra threads separadas
   por [contato, número] — ver "Mudança de modelo: threads por [contato,
   número]" mais abaixo) — se a thread nunca teve nenhuma mensagem
   `remetente='cliente'` até agora, esta é a primeira resposta dela
   (handoff IA→humano), e `ePrimeiraRespostaCliente=true` é repassado para
   o insert (ver "Sino de notificações" abaixo). Essa checagem precisa
   acontecer ANTES do `INSERT` do passo 6, nunca depois — checar depois
   sempre encontraria a própria linha recém-gravada.
6. Insere em `Mensagens`: `contato_id`, `numero_remetente_id` = o número
   **desta sessão** (que recebeu a mensagem), `remetente: ehDoAtendente ?
   'atendente' : 'cliente'`, `corpo`, `baileys_message_id = msg.key.id`,
   `lida=0`, `e_primeira_resposta_cliente` = o valor calculado no passo 5.
   `mensagens.model.js: inserirMensagemRecebida` recebe `remetente` como
   parâmetro opcional (default `'cliente'`, pra não quebrar chamadores que
   não passam esse campo). Uma violação do índice único filtrado (evento
   duplicado) é capturada e ignorada em silêncio pelo model (ver "Contexto
   e decisões de design" acima).

Nenhum erro inesperado (falha de banco, etc.) derruba o processo — capturado
e só logado, mesmo princípio do resto da integração Baileys deste projeto.
**Garantia por mensagem, não só por batch**: o `.catch(...)` no
`sock.ev.on('messages.upsert', ...)` mostrado acima só cobre uma exceção não
tratada no nível do `upsert` inteiro — antes desta correção, uma exceção
lançada ao processar UMA mensagem do array `upsert.messages` (ex.: erro no
insert, erro inesperado na resolução de telefone) abortava o `for...of` com
`await` de `handleMessagesUpsert` ali mesmo, e todas as mensagens seguintes
do mesmo batch — inclusive várias mensagens de texto em sequência, exatamente
o padrão relatado no bug de mensagens temporárias — nunca chegavam a ser
processadas, com só um log genérico de batch (sem indicar qual mensagem
falhou nem por quê) como rastro. `handleMessagesUpsert` agora envolve o corpo
de processamento de cada `msg` num `try/catch` individual dentro do laço: uma
falha em uma mensagem é logada com contexto (`numeroRemetenteId`, `contatoId`
se já resolvido, `baileysMessageId`) e o laço segue normalmente para a
próxima mensagem do batch — nunca aborta o resto.

### Sino de notificações

`e_primeira_resposta_cliente` (ver "Schema novo" acima) marca a mensagem que
representa a PRIMEIRA resposta de um contato desde sempre — não "primeira do
dia" nem qualquer outra janela de tempo, é sempre relativo ao histórico
inteiro daquele contato em `Mensagens`. O objetivo é alimentar um sino de
notificações no frontend que conta quantos contatos tiveram esse momento de
handoff IA→humano e ainda não foram vistos — diferente de "notificar a cada
mensagem nova", que geraria ruído a cada troca de mensagem de uma conversa já
em andamento.

- `mensagens.model.js: existeMensagemClienteAnterior(contatoId,
  numeroRemetenteId)` — checagem de existência simples (`SELECT TOP (1) 1
  ... WHERE contato_id = @contatoId AND numero_remetente_id =
  @numeroRemetenteId AND remetente = 'cliente'`; ganhou o segundo parâmetro
  na mudança pra threads separadas por [contato, número] — antes filtrava
  só por `contatoId`), chamada pelo listener antes de cada insert de
  mensagem recebida, só quando a mensagem NÃO é do atendente (ver passo 5
  acima).
- `mensagens.model.js: contarNotificacoesNaoVistas()` —
  `SELECT COUNT(*) ... WHERE e_primeira_resposta_cliente = 1 AND lida = 0`,
  usada pela rota `GET /notificacoes` abaixo. "Vista" aqui é o mesmo conceito
  de `lida` já usado no resto da Central de Mensagens — abrir a conversa
  daquele contato (`GET .../:contatoId/mensagens`) marca a mensagem como
  lida e, por consequência, ela some da contagem de notificações não vistas
  também (não há uma coluna/flag separada só para o sino).
- `mensagens.model.js: listNotificacoesPendentes(limite = 10)` — mesmo
  filtro de `contarNotificacoesNaoVistas`, só que devolvendo linhas
  (`contatoId`/`numeroRemetenteId`/`nomeContato`/`telefone`/`preview`/
  `criado_em`) em vez de `COUNT(*)`, `ORDER BY criado_em DESC`, `TOP
  (@limite)` parametrizado. `numeroRemetenteId` (campo novo, mudança
  posterior à v7 original — vem de `m.numero_remetente_id` no SELECT) é
  necessário pro clique numa notificação no frontend conseguir pré-
  selecionar a thread certa (`contatoId`+`numeroRemetenteId`) sem depender
  da lista de `GET /conversas` já estar carregada. Usada pela rota
  `GET /notificacoes` abaixo para alimentar o dropdown do sino no frontend
  com nome/preview/horário de cada notificação pendente. Sem paginação
  nesta fase — `limite` é fixo em 10 (as 10 notificações mais recentes),
  não configurável por query string. `preview` é o `corpo` da mensagem
  truncado para no máximo 80 caracteres, com "…" acrescentado no final
  quando de fato corta (corpo com 80 caracteres ou menos vem inalterado,
  sem reticências) — truncagem feita em `truncarTexto`, dentro do próprio
  `mensagens.model.js`. `criado_em` é devolvido em snake_case (não
  convertido para `criadoEm`), mesmo padrão já usado por
  `GET /conversas/:contatoId/:numeroRemetenteId/mensagens`
  (`listMensagensEMarcarLidas`) para timestamp de mensagem nesta área da
  API — não é inconsistência.
- O payload do evento `'mensagem-recebida'` emitido em
  `mensagensEvents.service.js` (consumido por `GET /conversas/stream`, ver
  seção 4 abaixo) ganhou o campo `primeiraResposta` (boolean) — reflete se
  aquela mensagem específica foi a primeira de cliente já recebida daquele
  contato, lido do `OUTPUT` do próprio `INSERT` (`mensagemInserida.e_primeira_resposta_cliente`),
  não da variável calculada antes do insert — evita qualquer discrepância
  entre o booleano JS enviado e o `BIT` que o SQL Server de fato gravou.

### O worker de envio grava em `Mensagens`

`backend/src/workers/envioDisparos.worker.js: processarItem` — logo depois
da chamada já existente a `disparosModel.marcarContatoEnviado({...})` (que
já roda com o envio via `sock.sendMessage` confirmado com sucesso), o worker
também grava a mesma mensagem em `Mensagens`
(`remetente='ia'`, `numero_remetente_id`, `contato_id` = `item.contatoId`,
`corpo` = a mesma mensagem já montada e enviada). Essa gravação é envolvida
em seu próprio `try/catch`: uma falha ao registrar em `Mensagens` é só
logada — **não** faz o worker tratar o envio (que já teve sucesso de fato)
como falha, e **não** dispara reenvio nem reprocessamento.

### 1. `GET /api/controle-ligacoes/conversas`

> **MUDANÇA DE MODELO (posterior à v7 original): esta rota agora lista
> THREADS `(contato, número remetente)`, não mais "1 linha por contato".**
> `mensagens.model.js: listConversas` foi reescrita — a query virou uma CTE
> agrupando por `(c.id, m.numero_remetente_id, n.apelido, ...)` com um
> `CROSS APPLY` pra pegar a última mensagem de cada thread, em vez do
> antigo `GROUP BY` só por `contato_id` + duas queries em lote separadas
> (`MAX(id)`/`MIN(id)`) pra achar "número atual" vs "número inicial". Um
> contato com histórico em mais de um número aparece em **múltiplas
> linhas** nesta lista agora, uma por thread — antes aparecia numa linha só.

Lista as threads que já têm pelo menos 1 mensagem trocada, ordenadas pela
mensagem mais recente (DESC). Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Parâmetros (query, ambos opcionais)
| Nome | Tipo | Validação |
|---|---|---|
| `busca` | string | filtra por nome OU telefone do contato (`LIKE`) |
| `apenasNaoLidas` | `'true'`\|`'false'` | qualquer valor diferente de `'true'` (inclusive ausente) é tratado como `false` |

#### Resposta de sucesso — `200 OK`
```json
[
  {
    "contato": { "id": 42, "nome": "Maria Silva", "telefone": "5598900000000" },
    "numeroRemetenteAtual": { "id": 3, "apelido": "CDC Cohatrac" },
    "numeroRemetenteInicial": { "id": 3, "apelido": "CDC Cohatrac" },
    "ultimaMensagem": { "corpo": "Oi, tudo bem?", "remetente": "cliente", "criado_em": "2026-08-25T12:00:00.000Z" },
    "naoLidas": 2
  }
]
```
`numeroRemetenteAtual` e `numeroRemetenteInicial` **são sempre o mesmo
valor agora** — como cada item já é uma thread escopada a um único número,
não existe mais "número que iniciou" vs "número mais recente" divergindo
(diferente do modelo antigo, onde um contato podia ser respondido por
números diferentes ao longo do tempo dentro da MESMA linha da lista). O
campo duplicado foi mantido de propósito, não removido, só pra não quebrar
o frontend — que já lia os dois campos separadamente (ex.: o chip `via
{apelido}` na lista usa `numeroRemetenteInicial`). Ambos vêm `null` só na
teoria (todo item desta lista já tem, por definição, ao menos 1 mensagem —
não há caso real de `null` aqui).

#### Erros
- `500`: `{ "error": "Erro interno ao listar conversas." }`

### 2. `GET /api/controle-ligacoes/conversas/:contatoId/:numeroRemetenteId/mensagens`

> **MUDANÇA DE ROTA (adendo posterior).** O path ganhou o segmento
> `:numeroRemetenteId` — era `GET /conversas/:contatoId/mensagens`. Motivo:
> cada combinação (contato, número remetente) passou a ser tratada como uma
> thread separada (ver `mensagens.model.js: listConversas`/
> `listMensagensEMarcarLidas`/`existeMensagemNaThread`), então o histórico
> de mensagens também precisa ser escopado por thread, não só por contato.

Histórico completo de mensagens de uma thread (contato + número remetente),
ordenado por `criado_em ASC`. **Efeito colateral esperado**: ao ser chamada,
marca como lida (`lida=1`) toda mensagem `remetente='cliente' AND lida=0`
daquele contato **e daquele número remetente** — "abrir a conversa = marcar
como lida", como qualquer inbox. Protegida por `authMiddleware` +
`operadorCobrancaMiddleware`.

#### Parâmetros
| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `:contatoId` | path, number | sim | inteiro positivo; `400` se não for |
| `:numeroRemetenteId` | path, number | sim | inteiro positivo; `400` se não for |

#### Resposta de sucesso — `200 OK`

> **MUDANÇA DE FORMATO (breaking, não aditiva).** O campo
> `numeroRemetenteInicial` saiu desta resposta — como a thread já é
> escopada por `(contatoId, numeroRemetenteId)`, o número é sempre o mesmo
> do início ao fim; o cabeçalho da conversa no frontend usa
> `numeroRemetenteAtual`, já disponível na lista de `GET /conversas` (ver
> seção 1 acima), sem precisar duplicar essa informação aqui.

```json
{
  "mensagens": [
    { "id": 1, "remetente": "cliente", "corpo": "Oi, tudo bem?", "criado_em": "2026-08-25T12:00:00.000Z" },
    { "id": 2, "remetente": "ia", "corpo": "Olá! ...", "criado_em": "2026-08-25T12:01:00.000Z" }
  ]
}
```
Uma thread que existe (contato válido) mas nunca teve nenhuma mensagem
nessa combinação específica devolve `200` com `{ "mensagens": [] }` —
**não** `404` (só `:contatoId` inexistente em `Contatos` vira `404`, ver
abaixo; `existeMensagemNaThread` decide isso na rota de resposta, seção 3).

#### Erros
- `400`: `{ "error": "Parâmetros \"contatoId\" e \"numeroRemetenteId\" devem ser números inteiros positivos." }`
- `404`: `{ "error": "Contato não encontrado." }`
- `500`: `{ "error": "Erro interno ao listar mensagens do contato." }`

### 3. `POST /api/controle-ligacoes/conversas/:contatoId/:numeroRemetenteId/mensagens`

> Mesma mudança de rota da seção 2 — ganhou `:numeroRemetenteId` no path.

Envia uma resposta manual (`remetente='colaboradora'`) para o contato, pelo
número remetente informado na própria rota (a thread selecionada) — não
mais "o último número que respondeu", já que agora a thread já deixa isso
explícito. Protegida por `authMiddleware` + `operadorCobrancaMiddleware`.

#### Corpo da requisição
```json
{ "corpo": "Oi Maria, tudo bem?" }
```

#### Validações (nesta ordem)
1. `:contatoId` e `:numeroRemetenteId` inteiros positivos (`400` combinado se qualquer um não for).
2. `corpo` presente e não-vazio após `trim()` (`400` se ausente/vazio/só espaços).
3. `:contatoId` existe em `Contatos` (`404` se não existir).
4. A thread `(contatoId, numeroRemetenteId)` tem pelo menos 1 mensagem em
   `Mensagens` (`400` se nunca teve — `existeMensagemNaThread`).
5. A sessão Baileys do número resolvido está `'conectado'` em memória
   (`409` se não estiver).
6. `sock.onWhatsApp(telefone do contato)` confirma uma conta ativa (`500`
   se não confirmar ou lançar erro — é um erro operacional, não uma
   validação de input do usuário).
7. `sock.sendMessage(jid, { text: corpo })` tem sucesso (`500` se lançar
   erro).

#### Resposta de sucesso — `201 Created`
```json
{
  "id": 10,
  "remetente": "colaboradora",
  "corpo": "Oi Maria, tudo bem?",
  "criado_em": "2026-08-25T12:05:00.000Z"
}
```

#### Erros
- `400`: `{ "error": "Campo \"corpo\" é obrigatório." }`
- `400`: `{ "error": "Parâmetros \"contatoId\" e \"numeroRemetenteId\" devem ser números inteiros positivos." }`
- `400`: `{ "error": "Não é possível responder um contato sem histórico de conversa." }`
- `404`: `{ "error": "Contato não encontrado." }`
- `409`: `{ "error": "Número não está conectado." }`
- `500`: `{ "error": "Número não possui WhatsApp ativo ou não pôde ser verificado." }` (ou a mensagem do erro de verificação)
- `500`: `{ "error": "Falha ao enviar mensagem." }` (ou a mensagem do erro de envio)
- `500`: `{ "error": "Erro interno ao responder contato." }`

### 4. `GET /api/controle-ligacoes/conversas/stream` (SSE)

Push em tempo real de "chegou mensagem nova" para a tela de Conversas, para
não depender só do botão "Atualizar"/polling manual. Reaproveita exatamente
o mesmo padrão de headers/escrita do stream de Conexão Baileys (ver
`numerosRemetentes.controller.js: conexaoStream`, seção "Conexão Baileys
(v5)"), com uma diferença deliberada: **este stream não se encerra
sozinho** — fica aberto indefinidamente até o cliente desconectar, porque a
tela de Conversas permanece aberta enquanto o operador estiver nela (o
stream de Conexão Baileys, por comparação, encerra a si mesmo logo após
"conectado"/"erro"). Protegida por `authMiddleware` +
`operadorCobrancaMiddleware` (herdado do mount do módulo, nenhuma checagem
própria na rota).

Assim como o `EventSource` nativo do browser não permite enviar o header
`Authorization` que a API exige, o consumo no frontend deve seguir o mesmo
padrão já usado para o stream de Conexão Baileys (`fetch` +
`response.body.getReader()`/`TextDecoder`, parsing manual do formato SSE —
ver `controleLigacoesConfigApi.js: abrirStreamConexao`), não
`new EventSource(...)`.

#### Headers de resposta
```
Content-Type: text/event-stream
Cache-Control: no-store
Connection: keep-alive
```

#### Evento emitido (único tipo, pode ocorrer 0..N vezes por conexão)
```
event: nova-mensagem
data: {"contatoId":42,"numeroRemetenteId":17}
```
Só esses 2 campos — **sem** o corpo da mensagem nem qualquer outro dado; o
cliente decide se recarrega a lista de conversas e/ou a conversa aberta
(quando `contatoId` bate com a que está na tela) a partir desse sinal.

#### Contexto e decisões de design
- **Canal**: `backend/src/services/mensagensEvents.service.js` — um único
  `EventEmitter` (módulo nativo `events`) compartilhado por todo o
  processo, não um por número remetente/contato. Produtor:
  `baileysSession.service.js: handleMessagesUpsert`, que emite
  `'mensagem-recebida'` (`{ contatoId, numeroRemetenteId }`) sempre que uma
  mensagem de cliente é **efetivamente gravada** em `Mensagens` — nunca
  quando a gravação é descartada por dedup de evento duplicado do Baileys
  (`mensagens.model.js: inserirMensagemRecebida` retornando `null` nesse
  caso). Consumidor: esta rota, que registra um listener por conexão SSE.
- **Broadcast para múltiplos clientes**: cada `GET .../conversas/stream`
  aberto registra seu próprio listener no `EventEmitter` compartilhado —
  N abas/operadores conectados ao mesmo tempo recebem o mesmo evento,
  cada um pela sua própria conexão.
- **Encerramento só pelo cliente**: ao contrário do stream de Conexão
  Baileys (que dispara `res.end()` sozinho após "conectado"/"erro"), aqui
  o servidor só remove o listener e chama `res.end()` quando `req.on('close',
  ...)` dispara (cliente desconectou — aba fechada, navegação para outra
  tela, etc.) — nunca por iniciativa própria.
- **Sem histórico/replay**: o canal não guarda eventos passados; um
  cliente que conecta depois de um evento emitido simplesmente não o
  recebe. A tela consumidora deve sempre fazer um `GET /conversas` normal
  ao montar, usando este stream só como sinal incremental de "algo mudou,
  talvez valha a pena atualizar".

#### Erros
Nenhum — a rota não valida nenhum parâmetro de entrada (sem path/query
params) e não faz nenhuma chamada assíncrona antes de abrir o stream, então
não há caminho de erro `4xx`/`5xx` específico desta rota (fora dos `401`/
`403` já cobertos pelos middlewares do mount, iguais ao resto do módulo).

### 5. `GET /api/controle-ligacoes/notificacoes`

Contagem de notificações não vistas do sino de notificações do frontend,
mais a lista dos itens mais recentes para alimentar o dropdown do sino —
ver "Sino de notificações" acima. Não é uma rota `/conversas/*`, mas
documentada nesta seção por ser a mesma tabela/feature. Protegida por
`authMiddleware` + `operadorCobrancaMiddleware` (herdado do mount, nenhuma
checagem própria na rota).

#### Parâmetros
Nenhum.

#### Resposta de sucesso — `200 OK`
```json
{
  "naoVistas": 1,
  "itens": [
    {
      "contatoId": 603,
      "numeroRemetenteId": 7,
      "nomeContato": "Natanael Soares Lima Junior",
      "telefone": "5585982336124",
      "preview": "ola",
      "criado_em": "2026-08-25T14:58:00.000Z"
    }
  ]
}
```
`naoVistas` = `COUNT(*)` de `Mensagens` com `e_primeira_resposta_cliente = 1
AND lida = 0` no momento da chamada — cai automaticamente quando o operador
abre a conversa daquele contato (`GET .../:contatoId/mensagens` marca
`lida = 1`), sem precisar de nenhuma rota/flag dedicada de "marcar
notificação como vista".

`itens` (campo novo — **aditivo**, não é uma mudança breaking; quem já lê só
`naoVistas` continua funcionando sem alteração) é a lista das notificações
pendentes de fato, mesmo filtro (`e_primeira_resposta_cliente = 1 AND lida =
0`) só que devolvendo linhas em vez de `COUNT(*)`, ordenadas por
`criado_em DESC` (mais recente primeiro), limitada às **10 mais recentes**
(`mensagens.model.js: listNotificacoesPendentes`, `TOP (@limite)`
parametrizado, `limite` fixo em 10 — sem paginação/parâmetro de query para
alterar esse limite nesta versão, "limite razoável" para o dropdown do
sino). `naoVistas` pode ser **maior** que `itens.length` quando houver mais
de 10 pendentes ao mesmo tempo — isso é esperado, o dropdown do sino mostra
só as mais recentes, `naoVistas` continua sendo a contagem exata para o
badge numérico. Cada item: `contatoId` (int), `numeroRemetenteId` (int —
campo novo, adicionado junto com a mudança de rota da seção 2/3 para
`.../:contatoId/:numeroRemetenteId/mensagens`; é o `numero_remetente_id` da
própria mensagem que gerou a notificação, necessário para o frontend poder
navegar direto para a thread certa a partir do dropdown do sino, sem
depender da lista de `GET /conversas` já estar carregada), `nomeContato`/
`telefone` do contato, `preview` (o `corpo` da própria mensagem que gerou a
notificação, truncado no backend para no máximo **80 caracteres**, com "…"
acrescentado no final quando de fato corta — corpo com 80 caracteres ou
menos vem inalterado, sem reticências) e `criado_em` (timestamp da
mensagem, em snake_case — mesmo padrão de
`GET /conversas/:contatoId/:numeroRemetenteId/mensagens`, não é
inconsistência com o resto da API em camelCase).

#### Erros
- `500`: `{ "error": "Erro interno ao contar notificações não vistas." }`

---

## Fora de escopo deste v2 (registrado, não implementar agora)

- ~~Central de Mensagens (Baileys) + conexão real via QR Code (`numero` e
  `status_conexao` de verdade nascem aqui).~~ **A conexão (QR/sessão/status)
  saiu de escopo — ver "Conexão Baileys (v5)" mais acima.** ~~O envio de
  mensagem de fato (worker de fila, disparo real via Baileys a partir de
  `Disparos`/`DisparoContatos`).~~ **O envio de mensagem também saiu de
  escopo — ver "Envio de Disparos (v6)" mais acima.** ~~Captura de mensagens
  recebidas + acompanhamento de conversa (histórico, resposta manual).~~
  **A captura (listener `messages.upsert`), o registro das mensagens
  enviadas pelo worker, e as 3 rotas de leitura/resposta também saíram de
  escopo — ver "Central de Mensagens (v7)" mais acima.** Continuam fora de
  escopo: CRUD de `MensagensTemplates`/`nome_colaboradora` (ver "Lacuna
  conhecida" na seção v6), retry automático de falha de envio, suporte a
  mídia de verdade (download/armazenamento — mensagens de mídia recebidas
  viram um texto placeholder fixo, ver seção v7), paginação do histórico de
  conversa, indicador de "digitando", handoff automático IA→Lívia, e a
  **tela de inbox** (as rotas da v7 existem para o frontend consumir numa
  fase posterior, mas nenhuma tela própria foi implementada nesta tarefa).
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