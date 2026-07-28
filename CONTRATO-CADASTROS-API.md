# Contrato da API — Cadastros compartilhados (erp_Novagest)

> Este módulo existe pra evitar que `Diretores`/`Redes`/`Lojas`/`Responsaveis`
> pertençam a um módulo de negócio específico — eles são consumidos hoje
> pelo Ranking e pelo Margens, e por qualquer módulo futuro que precise da
> mesma hierarquia. Nenhum desses módulos deve reimplementar CRUD de
> Diretor/Rede/Loja/Responsavel — todos apontam pra cá.
>
> **Migrado de `/api/ranking/*`**: as rotas de Diretor/Rede que antes viviam
> em `CONTRATO-RANKING-API.md` (seções 1–7 da v2) foram movidas pra cá, sem
> mudança de comportamento — só o prefixo da rota muda, de `/api/ranking`
> pra `/api/cadastros`. `Responsaveis` (seções 12–14 da v2 do Ranking)
> também migrou pra cá pelo mesmo motivo.
>
> **`ativo` vs `visivel` — são conceitos diferentes, cada um com seu
> alcance**:
> - `ativo = false` = **desativado pro sistema inteiro**: some das opções
>   selecionáveis em Margens (e qualquer módulo futuro), não pode receber
>   novo lançamento em lugar nenhum. É o "isto existe e funciona?".
> - `visivel = false` = só esconde da grade/placar do Ranking (uma
>   preferência de exibição daquele módulo específico); não afeta Margens
>   nem nenhum outro módulo.
> - As rotas `GET` deste módulo (`/diretores`, `/redes`) **retornam tudo**,
>   ativo ou não, visível ou não — cada módulo consumidor decide o que
>   filtrar (Margens filtra por `ativo`; a grade do Ranking filtra por
>   `visivel`; a tela de configuração mostra tudo, pra poder reativar).
> - **Loja nunca é excluída de verdade** — só `PUT` com `ativo:false`. Não
>   existe rota `DELETE` de Loja (ver seção 11).

## Informações gerais

- **Prefixo do módulo**: `/api/cadastros`
- **Auth**: `authMiddleware` no mount (qualquer usuário autenticado) —
  igual ao resto do sistema. `POST`/`DELETE /responsaveis` continuam
  exigindo `adminMiddleware` adicional, mesma regra de antes.
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/cadastros/diretores`

Retorna todos os diretores, cada um com suas redes aninhadas (sem lojas —
ver seção 5 pra isso).

Idêntico em comportamento à antiga `GET /api/ranking/diretores` (ver
histórico em `CONTRATO-RANKING-API.md` se precisar da query SQL exata) —
só a rota muda de prefixo.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 1, "nome": "Victor Hugo", "criado_em": "2024-01-10T12:00:00.000Z",
    "redes": [
      { "id": 5, "diretor_id": 1, "nome": "Delta", "emoji": "🔺", "ativo": true, "visivel": true, "responsavel": { "id": 3, "nome": "Grazy" }, "criado_em": "2024-01-12T09:30:00.000Z" }
    ]
  }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar diretores." }`

---

## 2. `POST /api/cadastros/diretores`

Idêntico à antiga `POST /api/ranking/diretores`.

- `400`: `{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }`
- `409`: `{ "error": "Já existe um diretor com esse nome." }`
- `201`: `{ "id": 4, "nome": "Novo Diretor", "criado_em": "...", "redes": [] }`
- `500`: `{ "error": "Erro interno ao criar diretor." }`

---

## 3. `PUT /api/cadastros/diretores/:id`

Idêntico à antiga `PUT /api/ranking/diretores/:id`. `400`/`404`/`409`/`500`
com as mesmas mensagens (troque só "diretor" por "diretor" — sem mudança).

---

## 4. `DELETE /api/cadastros/diretores/:id`

Idêntico à antiga `DELETE /api/ranking/diretores/:id` — bloqueia com `409`
se houver Redes vinculadas.

---

## 5. `GET /api/cadastros/redes`

Retorna **todas** as redes (ativas/inativas, visíveis/ocultas — sem
filtro no servidor, ver nota sobre `ativo`/`visivel` no topo do
documento), cada uma com diretor + responsável (GG) + **lojas físicas
aninhadas** (também todas, inclusive inativas) — combina o que antes era
`GET /api/ranking/diretores` (nível rede) com o que era
`GET /api/margens/redes` (lojas aninhadas), num único endpoint
reaproveitável por Ranking, Margens e módulos futuros.

> Quem consome esta rota filtra o que precisa: Margens ignora tudo com
> `ativo: false` (rede ou loja) antes de montar seus seletores; o
> Ranking ignora `visivel: false` na grade; a tela de configuração
> mostra tudo, com controles pra reativar/mostrar de novo.

### Query real
```sql
SELECT r.id, r.diretor_id, d.nome AS diretor_nome, r.nome, r.emoji,
       r.ativo, r.visivel, resp.id AS responsavel_id, resp.nome AS responsavel_nome,
       r.criado_em
FROM Redes r
JOIN Diretores d ON d.id = r.diretor_id
LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
ORDER BY r.nome;

SELECT id, rede_id, nome, ativo, criado_em FROM Lojas ORDER BY nome;
```
Agrupa lojas por `rede_id` e anexa em `lojas[]`.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 5, "nome": "Delta", "emoji": "🔺", "ativo": true, "visivel": true,
    "diretor": { "id": 1, "nome": "Victor Hugo" },
    "responsavel": { "id": 3, "nome": "Grazy" },
    "criado_em": "2024-01-12T09:30:00.000Z",
    "lojas": [
      { "id": 40, "rede_id": 5, "nome": "SLZ 01", "ativo": true, "criado_em": "2026-07-20T12:00:00.000Z" }
    ]
  }
]
```

### Erros
`500`: `{ "error": "Erro interno ao listar redes." }`

---

## 6. `POST /api/cadastros/redes`

Idêntico à antiga `POST /api/ranking/redes` — body `diretorId`, `nome`,
`emoji?`. `400`/`409`/`500` com as mesmas mensagens (ver histórico).

---

## 7. `PUT /api/cadastros/redes/:id`

Body parcial: `nome`/`emoji`/`responsavelId`/`ativo`/`visivel`/**`diretorId`**
(novo — permite mover a rede pra outro diretor depois de criada, não só
na criação). Se `diretorId` for enviado, deve referenciar um
`Diretores.id` existente, senão `400`:
`{ "error": "Diretor informado não existe." }`. Ao trocar de diretor,
reaplique a checagem de nome duplicado considerando o **novo** diretor
(nome único por diretor, não globalmente).

---

## 8. `DELETE /api/cadastros/redes/:id`

Bloqueia com `409 Conflict` se houver **qualquer uma** das duas coisas
vinculadas à rede (checagem cobre ambos, não só o que valia antes da
migração pra este módulo):

- **Lojas físicas** vinculadas (`Lojas.rede_id = :id`, independente de
  `ativo`):
  ```json
  { "error": "Não é possível excluir esta rede pois existem lojas vinculadas a ela. Remova as lojas primeiro." }
  ```
- **Entradas** (Ranking) vinculadas (`Entradas.rede_id = :id`):
  ```json
  { "error": "Não é possível excluir esta rede pois existem lançamentos vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico." }
  ```

Se houver ambos os vínculos, retorne o erro de Lojas primeiro (checagem
nessa ordem). Sem nenhum dos dois vínculos, delete físico normal —
`204 No Content`.

---

## 9. `POST /api/cadastros/lojas`

Cria uma loja física, vinculada a uma rede existente. Migrado do antigo
`CONTRATO-MARGENS-API.md` (seção 2) — comportamento idêntico.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `redeId` | number | sim | inteiro positivo, deve referenciar `Redes.id` existente |
| `nome` | string | sim | não pode ser vazio/só espaços |

- `400`: `{ "error": "Campo \"redeId\" é obrigatório e deve ser um número inteiro positivo." }` / `{ "error": "Campo \"nome\" é obrigatório e não pode ser vazio." }` / `{ "error": "Rede informada não existe." }`
- `409`: `{ "error": "Já existe uma loja com esse nome nesta rede." }`
- `201`: `{ "id": 42, "rede_id": 5, "nome": "SLZ 03", "ativo": true, "criado_em": "..." }`
- `500`: `{ "error": "Erro interno ao criar loja." }`

---

## 10. `PUT /api/cadastros/lojas/:id`

Atualização parcial: `nome`/`ativo`/**`redeId`** (novo — permite mover a
loja pra outra rede depois de criada). Se `redeId` for enviado, deve
referenciar uma `Redes.id` existente, senão `400`:
`{ "error": "Rede informada não existe." }`. Ao trocar de rede, reaplique
a checagem de nome duplicado considerando a **nova** rede (nome único por
rede, não globalmente).

`ativo: false` é a única forma de "remover" uma loja — ver seção 11.

---

## 11. Não existe `DELETE /api/cadastros/lojas/:id`

**Decisão de produto**: Loja nunca é excluída fisicamente, nem sem
nenhum lançamento vinculado — só desativada. Não implemente rota
`DELETE` pra Loja. Pra "remover" uma loja da operação, use
`PUT /api/cadastros/lojas/:id` com `{ "ativo": false }` (seção 10) — ela
some de qualquer seletor do Margens/módulos futuros, mas o histórico de
`MargensEntradas` continua íntegro e ela pode ser reativada depois com
`{ "ativo": true }`.

---

## 12. `GET /api/cadastros/responsaveis`

Idêntico à antiga `GET /api/ranking/responsaveis` — lista todos os GGs.
Qualquer usuário autenticado pode chamar.

---

## 13. `POST /api/cadastros/responsaveis`

Idêntico à antiga `POST /api/ranking/responsaveis` — restrito a admin
(`adminMiddleware`).

---

## 14. `DELETE /api/cadastros/responsaveis/:id`

Idêntico à antiga `DELETE /api/ranking/responsaveis/:id` — restrito a
admin, bloqueia com `409` se houver Redes vinculadas.

---

## Resumo rápido

| Método | Rota | Observação |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/cadastros/diretores` | — |
| GET/POST/PUT/DELETE | `/api/cadastros/redes` | `PUT` aceita `diretorId` (reatribuir); `GET` retorna tudo, sem filtro de `ativo`/`visivel` |
| POST/PUT | `/api/cadastros/lojas` | `PUT` aceita `redeId` (reatribuir); **sem rota DELETE** — só `ativo:false` |
| GET/POST/DELETE | `/api/cadastros/responsaveis` | — |

Todos os erros seguem `{ "error": "mensagem" }`.