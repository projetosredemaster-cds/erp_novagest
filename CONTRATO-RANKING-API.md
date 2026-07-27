# Contrato da API — Módulo Ranking (erp_Novagest) — v3

> **Mudança de arquitetura**: CRUD de Diretor/Rede e de Responsaveis (GG)
> saiu deste módulo e foi pra `CONTRATO-CADASTROS-API.md`, sob
> `/api/cadastros/*` — esses dados são compartilhados com o módulo Margens
> (e módulos futuros), não são específicos do Ranking. O Ranking continua
> **consumindo** esse cadastro (via `GET /api/cadastros/diretores`), só não
> é mais dono das rotas de escrita dele.
>
> O que continua aqui, genuinamente do Ranking: `Categorias` e `Entradas`
> (lançamento diário por Rede) e o envio de relatório por e-mail.

## Informações gerais

- **Prefixo do módulo**: `/api/ranking`
- **Auth**: `authMiddleware` no mount — igual ao resto do sistema.
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/ranking/categorias`

Sem mudança em relação às versões anteriores.

---

## 2. `GET /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X`

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

## 3. `POST /api/ranking/entradas`

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

## 4. `DELETE /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X&redeId=Y`

Remove a entrada correspondente, se existir. **Idempotente**: `204` tanto
se a linha existia quanto se não existia — usada pelo frontend quando o
usuário zera/apaga um campo que já tinha valor salvo (`POST /entradas`
nunca persiste valor zero, então zerar de propósito precisa desta rota
pra apagar o valor real anterior).

`DELETE FROM Entradas WHERE data_ref = @data AND categoria_id = @categoriaId AND rede_id = @redeId`

### Erros
`400` (parâmetros ausentes/inválidos), `500`: `{ "error": "Erro interno ao excluir entrada." }`

---

## 5. `POST /api/ranking/relatorio/email`

Sem mudança — recebe `texto` pronto e repassa ao Brevo.

---

## Resumo rápido

| Método | Rota | Observação |
|---|---|---|
| GET | `/api/ranking/categorias` | sem mudança |
| GET | `/api/ranking/entradas` | `rede_id`/`rede_nome`/`rede_emoji`/`diretor_id` |
| POST | `/api/ranking/entradas` | upsert, nunca persiste valor 0 |
| DELETE | `/api/ranking/entradas` | idempotente, apaga entrada real quando zerada de propósito |
| POST | `/api/ranking/relatorio/email` | sem mudança |

Diretor/Rede (CRUD) e Responsaveis (GG) → ver `CONTRATO-CADASTROS-API.md`.
Todos os erros seguem `{ "error": "mensagem" }`.