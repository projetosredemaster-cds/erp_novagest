# Contrato da API — Módulo Ranking (erp_Novagest) — v2

> **BREAKING CHANGE de arquitetura.** Este documento substitui a versão
> anterior de `CONTRATO-RANKING-API.md`. A hierarquia de dados mudou de
> 2 para 3 níveis:
>
> | Antes | Agora | O que é de verdade |
> |---|---|---|
> | `Redes` ("Rede V. Hugo", "Rede Emerson", "Rede Pedro") | **`Diretores`** | A pessoa que comanda várias redes de franquia |
> | `Lojas` (Delta, Lendários, Ouro, Magnata...) | **`Redes`** | Uma rede de franquia de verdade, com uma gerente/coordenadora responsável |
> | *(não existia)* | **`Lojas`** | A unidade física real (ex: SLZ 01, MCZ PÁTIO) — usada pelo módulo Margens, não pelo Ranking |
>
> O Ranking **continua operando no nível Diretor → Rede** — ele nunca lança
> valor por loja física, só por Rede (Delta, Lendários...). A tabela `Lojas`
> física existe no banco (ver `MIGRATION-DIRETOR-REDE-LOJA.sql`), mas o
> Ranking não a consome.
>
> Todas as rotas abaixo trocam `/redes` por `/diretores` e `/lojas` por
> `/redes` em relação ao contrato antigo. `lojaId` em `POST /entradas` virou
> `redeId`. Nenhum outro comportamento (validações, mensagens de erro,
> convenções de status code) muda de espírito — só os nomes.

## Informações gerais

- **Base URL**: `http://localhost:3000` (porta via `PORT` no `.env`)
- **Prefixo do módulo**: `/api/ranking`
- **Auth**: todas as rotas exigem `authMiddleware` (header `Authorization: Bearer <token>`), aplicado no mount em `app.js` — ver `CONTRATO-AUTH-API.md`. Sem mudança nisso.
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/ranking/diretores`

Retorna todos os diretores, cada um com suas redes aninhadas.

### Query real (equivalente à antiga `GET /redes`, adaptada)
```sql
SELECT id, nome, criado_em FROM Diretores ORDER BY nome;

SELECT r.id, r.diretor_id, r.nome, r.emoji, r.ativo, r.visivel, r.criado_em,
       resp.id AS responsavel_id, resp.nome AS responsavel_nome
FROM Redes r
LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
ORDER BY r.nome;
```
Agrupa as redes por `diretor_id` e anexa em `redes[]` de cada diretor.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 1,
    "nome": "Victor Hugo",
    "criado_em": "2024-01-10T12:00:00.000Z",
    "redes": [
      {
        "id": 5,
        "diretor_id": 1,
        "nome": "Delta",
        "emoji": "🔺",
        "ativo": true,
        "visivel": true,
        "responsavel": { "id": 3, "nome": "Grazy" },
        "criado_em": "2024-01-12T09:30:00.000Z"
      },
      {
        "id": 6,
        "diretor_id": 1,
        "nome": "Lendários",
        "emoji": "⚔️",
        "ativo": true,
        "visivel": true,
        "responsavel": { "id": 4, "nome": "Maria Caroline" },
        "criado_em": "2024-01-15T09:30:00.000Z"
      }
    ]
  }
]
```

### Campos

| Campo (diretor) | Tipo | Origem |
|---|---|---|
| `id` | number | `Diretores.id` |
| `nome` | string | `Diretores.nome` |
| `criado_em` | string (ISO datetime) | `Diretores.criado_em` |
| `redes` | array | montado em memória (join lógico por `diretor_id`) |

| Campo (rede dentro de `redes[]`) | Tipo | Origem |
|---|---|---|
| `id` | number | `Redes.id` |
| `diretor_id` | number | `Redes.diretor_id` |
| `nome` | string | `Redes.nome` |
| `emoji` | string | `Redes.emoji` |
| `ativo` | boolean | `Redes.ativo` |
| `visivel` | boolean | `Redes.visivel` |
| `responsavel` | objeto `{ id, nome }` ou `null` | `Redes.responsavel_id` via `LEFT JOIN Responsaveis` |
| `criado_em` | string (ISO datetime) | `Redes.criado_em` |

### Erros
- `500 Internal Server Error`: `{ "error": "Erro interno ao listar diretores." }`

---

## 2. `POST /api/ranking/diretores`

Cria um novo diretor.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `nome` | string | sim | não pode ser vazio/só espaços |

### Validações — `400 Bad Request`
```json
{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }
```

### Duplicidade — `409 Conflict`
Comparação case-insensitive + trim (mesmo padrão do resto da API):
```json
{ "error": "Já existe um diretor com esse nome." }
```

### Resposta de sucesso — `201 Created`
```json
{ "id": 4, "nome": "Novo Diretor", "criado_em": "2026-07-27T14:00:00.000Z", "redes": [] }
```

### Erros
- `400` — nome vazio · `409` — nome duplicado · `500`: `{ "error": "Erro interno ao criar diretor." }`

---

## 3. `PUT /api/ranking/diretores/:id`

Atualiza o nome de um diretor. Atualização parcial (só `nome` existe neste nível).

### Validações
- `:id` não inteiro positivo → `400`: `{ "error": "Parâmetro \"id\" deve ser um número inteiro positivo." }`
- `nome` ausente/vazio → `400`: `{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }`
- `:id` não encontrado → `404`: `{ "error": "Diretor não encontrado." }`
- nome duplicado (outro diretor, `id <> :id`) → `409`: `{ "error": "Já existe um diretor com esse nome." }`

### Resposta de sucesso — `200 OK`
Mesmo shape da seção 1 (com `redes[]` aninhado).

### Erros
`400`, `404`, `409`, `500`: `{ "error": "Erro interno ao atualizar diretor." }`

---

## 4. `DELETE /api/ranking/diretores/:id`

### Bloqueio — `409 Conflict`
Se houver qualquer Rede vinculada (`diretor_id = :id`), independente de `ativo`/`visivel`:
```json
{ "error": "Não é possível excluir este diretor pois existem redes vinculadas a ele. Remova as redes primeiro." }
```

### Resposta de sucesso — `204 No Content`

### Erros
`400` (`:id`), `404` (não encontrado), `409` (redes vinculadas), `500`: `{ "error": "Erro interno ao excluir diretor." }`

---

## 5. `POST /api/ranking/redes`

Cria uma nova rede (Delta, Lendários...), vinculada a um diretor existente.

> Substitui a antiga `POST /lojas`. Não aceita `responsavelId` na criação —
> mesma lógica de antes: toda rede nasce sem responsável, atribuído depois
> via `PUT`.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `diretorId` | number | sim | inteiro positivo, deve referenciar um `Diretores.id` existente |
| `nome` | string | sim | não pode ser vazio/só espaços |
| `emoji` | string | não | opcional |

### Validações — `400 Bad Request`
1. `diretorId` ausente/inválido: `{ "error": "Campo \"diretorId\" é obrigatório e deve ser um número inteiro positivo." }`
2. `nome` ausente/vazio: `{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }`
3. `diretorId` não existe: `{ "error": "Diretor informado não existe." }`

### Duplicidade — `409 Conflict`
Nome duplicado **dentro do mesmo diretor** (case-insensitive + trim):
```json
{ "error": "Já existe uma rede com esse nome neste diretor." }
```

### Comportamento no banco
`INSERT INTO Redes (diretor_id, nome, emoji, ativo, visivel, responsavel_id, criado_em) VALUES (@diretorId, @nome, @emoji, 1, 1, NULL, SYSUTCDATETIME())`

### Resposta de sucesso — `201 Created`
```json
{
  "id": 12, "diretor_id": 1, "nome": "Nova Rede", "emoji": "🆕",
  "ativo": true, "visivel": true, "responsavel": null,
  "criado_em": "2026-07-27T14:10:00.000Z"
}
```

### Erros
`400`, `409`, `500`: `{ "error": "Erro interno ao criar rede." }`

---

## 6. `PUT /api/ranking/redes/:id`

Atualização parcial: `nome` / `emoji` / `responsavelId` / `ativo` / `visivel` — ao menos um.
Mesma lógica de antes (antiga `PUT /lojas/:id` + a parte de `responsavelId`/`visivel` que já existia em `PUT /redes/:id` antigo):

- `responsavelId: null` remove a atribuição; ausência do campo preserva o valor atual.
- `responsavelId` deve referenciar um `Responsaveis.id` existente, senão `400`: `{ "error": "Responsável informado não existe." }`
- `visivel`/`ativo` exigem booleano estrito, senão `400`.
- Nome duplicado dentro do mesmo diretor (excluindo a própria rede) → `409`: `{ "error": "Já existe uma rede com esse nome neste diretor." }`
- `:id` não encontrado → `404`: `{ "error": "Rede não encontrada." }`

### Resposta de sucesso — `200 OK`
Mesmo shape do objeto rede da seção 5.

---

## 7. `DELETE /api/ranking/redes/:id`

### Bloqueio — `409 Conflict`
Se houver qualquer `Entradas` vinculada a esta rede (`Entradas.rede_id = :id` — ver nota sobre renomeação de coluna abaixo):
```json
{ "error": "Não é possível excluir esta rede pois existem lançamentos vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico." }
```
Sem entradas vinculadas, delete físico normal.

### Resposta de sucesso — `204 No Content`

---

## 8. `GET /api/ranking/categorias`

**Sem mudança** em relação ao contrato anterior.

---

## 9. `GET /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X`

Igual ao contrato anterior, exceto que o JOIN agora é com `Redes` em vez de
`Lojas`, e os campos de contexto mudam de nome:

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

> **Nota de implementação**: se a migration (ver
> `MIGRATION-DIRETOR-REDE-LOJA.sql`, Seção 5) não renomear fisicamente a
> coluna `Entradas.loja_id` para `rede_id`, o model deve simplesmente usar
> `e.loja_id AS rede_id` no `SELECT` para manter este contrato de resposta
> sem depender de uma migration de coluna adicional.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 101, "data_ref": "2026-07-17T00:00:00.000Z", "categoria_id": 1,
    "rede_id": 5, "valor": 15230.50, "atualizado_em": "2026-07-17T14:22:01.000Z",
    "rede_nome": "Delta", "rede_emoji": "🔺", "diretor_id": 1
  }
]
```

### Erros
`400` (parâmetros), `500`: `{ "error": "Erro interno ao listar entradas." }`

---

## 10. `POST /api/ranking/entradas`

Upsert por `(data, categoriaId, redeId)` — **campo renomeado de `lojaId` para `redeId`**. Todo o resto do comportamento (MERGE, transação, `200 OK` mesmo em criação, validações) é idêntico ao contrato anterior.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `data` | string | sim | `^\d{4}-\d{2}-\d{2}$` |
| `categoriaId` | number | sim | inteiro positivo |
| `redeId` | number | sim | inteiro positivo |
| `valor` | number | sim | `>= 0` |

### Erros de validação (na ordem)
1. `data` inválida: `{ "error": "Campo \"data\" é obrigatório e deve estar no formato YYYY-MM-DD." }`
2. `categoriaId` inválido: `{ "error": "Campo \"categoriaId\" é obrigatório e deve ser um número inteiro positivo." }`
3. `redeId` inválido: `{ "error": "Campo \"redeId\" é obrigatório e deve ser um número inteiro positivo." }`
4. `valor` inválido: `{ "error": "Campo \"valor\" é obrigatório e deve ser um número maior ou igual a zero." }`

### Resposta de sucesso — `200 OK`
```json
{
  "acao": "INSERT", "id": 101, "data_ref": "2026-07-17T00:00:00.000Z",
  "categoria_id": 1, "rede_id": 5, "valor": 15230.50,
  "atualizado_em": "2026-07-17T14:22:01.000Z"
}
```

---

## 11. `POST /api/ranking/relatorio/email`

**Sem mudança** em relação ao contrato anterior (continua recebendo `texto` pronto e repassando ao Brevo).

---

## 12–14. `GET/POST/DELETE /api/ranking/responsaveis`

**Sem mudança de rota ou payload**, mas mudança de significado: agora um
`Responsavel` é atribuído a uma **Rede** (Delta, Lendários...), não mais a
um Diretor. As mesmas regras de admin (`POST`/`DELETE` restritos a
`adminMiddleware`) e bloqueio de exclusão com vínculo continuam valendo,
só que a checagem de vínculo passa a ser contra `Redes.responsavel_id` em
vez de `Diretores.responsavel_id` (que nem existe mais).

---

## Resumo rápido

| Método | Rota | Equivale à rota antiga | Principais mudanças |
|---|---|---|---|
| GET | `/api/ranking/diretores` | `GET /redes` | nome + nested `redes[]` em vez de `lojas[]` |
| POST | `/api/ranking/diretores` | `POST /redes` | sem campo `responsavel` (nunca teve) |
| PUT | `/api/ranking/diretores/:id` | `PUT /redes/:id` | perde `responsavelId`/`visivel` (migraram pra Rede) |
| DELETE | `/api/ranking/diretores/:id` | `DELETE /redes/:id` | bloqueio agora é por Redes vinculadas |
| POST | `/api/ranking/redes` | `POST /lojas` | `redeId`→`diretorId`; ganha `visivel` |
| PUT | `/api/ranking/redes/:id` | `PUT /lojas/:id` | ganha `responsavelId`/`visivel` |
| DELETE | `/api/ranking/redes/:id` | `DELETE /lojas/:id` | bloqueio agora é por Entradas vinculadas |
| GET/POST | `/api/ranking/entradas` | igual | `lojaId`/`loja_*` → `redeId`/`rede_*` |
| GET/POST/DELETE | `/api/ranking/responsaveis` | igual | vínculo agora é com Rede, não Diretor |
| POST | `/api/ranking/relatorio/email` | igual | sem mudança |
| GET | `/api/ranking/categorias` | igual | sem mudança |

Todos os erros seguem `{ "error": "mensagem" }`.