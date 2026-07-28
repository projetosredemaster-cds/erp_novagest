# Contrato da API — Módulo Ranking (erp_Novagest) — v4

> **Mudança de arquitetura**: CRUD de Diretor/Rede e de Responsaveis (GG)
> saiu deste módulo e foi pra `CONTRATO-CADASTROS-API.md`, sob
> `/api/cadastros/*`. O que continua aqui, genuinamente do Ranking:
> `Categorias` (agora com CRUD real — deixou de ser 100% em memória) e
> `Entradas` (lançamento diário por Rede) e o envio de relatório por
> e-mail.
>
> **Categorias deixam de ser 100% em memória** (era assim antes por não
> existir endpoint de escrita). Agora existem 3 categorias **padrão**
> (Receita Bruta, Correção, Acessórios — semeadas no banco, `padrao = 1`)
> que **nunca podem ser excluídas**, só ocultadas (`visivel = 0`).
> Categorias novas, criadas pela tela, nascem com `padrao = 0` e podem ser
> excluídas de verdade se não tiverem nenhum lançamento vinculado.
>
> **Migration necessária** (ver `MIGRATION-CATEGORIAS-PADRAO.sql`):
> adiciona `padrao BIT NOT NULL DEFAULT 0` e `visivel BIT NOT NULL
> DEFAULT 1` à tabela `Categorias`, e marca as 3 seeds como `padrao = 1`.

## Informações gerais

- **Prefixo do módulo**: `/api/ranking`
- **Auth**: `authMiddleware` no mount — igual ao resto do sistema.
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/ranking/categorias`

Retorna **todas** as categorias (inclusive as ocultas — `visivel: false`)
— o frontend decide o que mostrar em cada tela: as abas do placar do dia
filtram só `visivel: true`; a tela de configuração mostra todas, pra dar
a opção de "Mostrar" de novo uma categoria oculta.

### Resposta de sucesso — `200 OK`
```json
[
  { "id": 1, "nome": "Receita Bruta", "principal": true, "padrao": true, "visivel": true, "criado_em": "..." },
  { "id": 2, "nome": "Correção", "principal": false, "padrao": true, "visivel": true, "criado_em": "..." },
  { "id": 3, "nome": "Acessórios", "principal": false, "padrao": true, "visivel": true, "criado_em": "..." }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar categorias." }`

---

## 2. `POST /api/ranking/categorias`

Cria uma categoria nova. Sempre `padrao = false`, `principal = false`,
`visivel = true` — não existe forma de criar uma categoria já como
padrão ou principal por essa rota.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `nome` | string | sim | não pode ser vazio/só espaços |

### Validações — `400 Bad Request`
`{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }`

### Duplicidade — `409 Conflict`
Case-insensitive + trim:
`{ "error": "Já existe uma categoria com esse nome." }`

### Resposta de sucesso — `201 Created`
```json
{ "id": 4, "nome": "Nova Categoria", "principal": false, "padrao": false, "visivel": true, "criado_em": "..." }
```

### Erros
`400`, `409`, `500`: `{ "error": "Erro interno ao criar categoria." }`

---

## 3. `PUT /api/ranking/categorias/:id`

Atualização parcial: `nome` / `visivel` — ao menos um. **Não aceita**
`padrao` nem `principal` (esses nunca mudam via API).

### Validações
- `:id` inválido → `400`
- `nome`, se enviado, não pode ser vazio nem duplicado (case-insensitive,
  excluindo a própria categoria) → `400` / `409`
- `:id` não encontrado → `404`: `{ "error": "Categoria não encontrada." }`

### Resposta de sucesso — `200 OK`
Mesmo shape da seção 2.

### Erros
`400`, `404`, `409`, `500`: `{ "error": "Erro interno ao atualizar categoria." }`

---

## 4. `DELETE /api/ranking/categorias/:id`

### Bloqueio — `409 Conflict` (nesta ordem de checagem)
1. Se `padrao = true`:
   ```json
   { "error": "Não é possível excluir uma categoria padrão do sistema. Utilize a opção de ocultar." }
   ```
2. Se houver qualquer `Entradas.categoria_id = :id` (qualquer rede com
   valor lançado nessa categoria, em qualquer data):
   ```json
   { "error": "Não é possível excluir esta categoria pois existem lançamentos vinculados a ela." }
   ```

Sem nenhum dos dois bloqueios (categoria não-padrão e sem nenhum
lançamento), delete físico normal — `204 No Content`.

### Erros
`400` (`:id`), `404` (não encontrada), `409` (bloqueios acima), `500`:
`{ "error": "Erro interno ao excluir categoria." }`

---

## 5. `GET /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X`

```sql
SELECT e.id, e.data_ref, e.categoria_id, e.rede_id, e.valor, e.atualizado_em,
       r.nome  AS rede_nome,
       r.emoji AS rede_emoji,
       r.diretor_id
FROM Entradas e
INNER JOIN Redes r ON r.id = e.rede_id
WHERE e.data_ref = @data AND e.categoria_id = @categoriaId
ORDER BY e.valor DESC;
```

### Resposta de sucesso — `200 OK`
```json
[
  { "id": 101, "data_ref": "2026-07-17T00:00:00.000Z", "categoria_id": 1,
    "rede_id": 5, "valor": 15230.50, "atualizado_em": "2026-07-17T14:22:01.000Z",
    "rede_nome": "Delta", "rede_emoji": "🔺", "diretor_id": 1 }
]
```

### Erros
`400` (parâmetros), `500`: `{ "error": "Erro interno ao listar entradas." }`

---

## 6. `POST /api/ranking/entradas`

Upsert por `(data, categoriaId, redeId)`, `200 OK` mesmo em criação.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `data` | string | sim | `^\d{4}-\d{2}-\d{2}$` |
| `categoriaId` | number | sim | inteiro positivo |
| `redeId` | number | sim | inteiro positivo |
| `valor` | number | sim | `>= 0` |

### Resposta de sucesso — `200 OK`
```json
{ "acao": "INSERT", "id": 101, "data_ref": "2026-07-17T00:00:00.000Z",
  "categoria_id": 1, "rede_id": 5, "valor": 15230.50,
  "atualizado_em": "2026-07-17T14:22:01.000Z" }
```

---

## 7. `DELETE /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X&redeId=Y`

Remove a entrada correspondente, se existir. **Idempotente**: `204` tanto
se a linha existia quanto se não existia.

`DELETE FROM Entradas WHERE data_ref = @data AND categoria_id = @categoriaId AND rede_id = @redeId`

### Erros
`400` (parâmetros ausentes/inválidos), `500`: `{ "error": "Erro interno ao excluir entrada." }`

---

## 8. `POST /api/ranking/relatorio/email`

Sem mudança — recebe `texto` pronto e repassa ao Brevo.

---

## Resumo rápido

| Método | Rota | Observação |
|---|---|---|
| GET | `/api/ranking/categorias` | retorna todas, inclusive ocultas |
| POST | `/api/ranking/categorias` | cria nova, sempre padrao=false |
| PUT | `/api/ranking/categorias/:id` | nome/visivel, nunca padrao/principal |
| DELETE | `/api/ranking/categorias/:id` | 409 se padrao, 409 se tem lançamento |
| GET | `/api/ranking/entradas` | `rede_id`/`rede_nome`/`rede_emoji`/`diretor_id` |
| POST | `/api/ranking/entradas` | upsert, nunca persiste valor 0 |
| DELETE | `/api/ranking/entradas` | idempotente |
| POST | `/api/ranking/relatorio/email` | sem mudança |

Diretor/Rede/Loja (CRUD) e Responsaveis (GG) → ver `CONTRATO-CADASTROS-API.md`.
Todos os erros seguem `{ "error": "mensagem" }`.