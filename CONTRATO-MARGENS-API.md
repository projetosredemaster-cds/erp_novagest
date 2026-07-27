# Contrato da API — Módulo Margens (erp_Novagest) — v2

> **Mudança de arquitetura**: o cadastro de Diretor/Rede/Loja inteiro
> (inclusive Lojas físicas, que antes viviam aqui) migrou pra
> `CONTRATO-CADASTROS-API.md`, sob `/api/cadastros/*` — é dado
> compartilhado, não pertence ao Margens nem ao Ranking. O Margens só
> **consome** `GET /api/cadastros/redes` (que já vem com diretor +
> responsável + lojas[] aninhado — ver seção 5 daquele contrato) e mantém
> só o que é genuinamente dele: os **lançamentos diários de margem** e o
> **relatório de período**.

## Informações gerais

- **Prefixo do módulo**: `/api/margens`
- **Auth**: `authMiddleware` no mount, igual ao Ranking — qualquer usuário
  autenticado pode preencher/ler qualquer rede ou loja (sem restrição de
  admin nesta v1).
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/margens/entradas?data=YYYY-MM-DD`

Lançamento diário — todas as lojas que já têm valor lançado nessa data.

### Parâmetro
| Parâmetro | Obrigatório | Validação |
|---|---|---|
| `data` | sim | `^\d{4}-\d{2}-\d{2}$`, senão `400`: `{ "error": "Parâmetro \"data\" é obrigatório e deve estar no formato YYYY-MM-DD." }` |

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 900, "data_ref": "2026-07-27T00:00:00.000Z", "loja_id": 40,
    "faturamento": 12000.00, "franquia": 0, "custos": 5400.00,
    "cartoes": 320.00, "despesas": 1800.00, "atualizado_em": "2026-07-27T18:00:00.000Z"
  }
]
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao listar entradas de margem." }`

---

## 2. `POST /api/margens/entradas`

Upsert por `(data, lojaId)` — igual em espírito ao `POST /api/ranking/entradas` (MERGE, `200 OK` mesmo em criação).

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `data` | string | sim | `^\d{4}-\d{2}-\d{2}$` |
| `lojaId` | number | sim | inteiro positivo, deve existir em `Lojas` |
| `faturamento` | number | sim | `>= 0` |
| `franquia` | number | não | `>= 0`, default `0` |
| `custos` | number | sim | `>= 0` |
| `cartoes` | number | sim | `>= 0` |
| `despesas` | number | não | `>= 0`, default `0` |

### Validações — `400 Bad Request` (nesta ordem)
1. `data` inválida
2. `lojaId` ausente/inválido, ou não referencia loja existente: `{ "error": "Loja informada não existe." }`
3. `faturamento`/`custos`/`cartoes` ausentes ou negativos
4. `franquia`/`despesas`, se enviados, não podem ser negativos

### Resposta de sucesso — `200 OK`
```json
{
  "acao": "INSERT", "id": 900, "data_ref": "2026-07-27T00:00:00.000Z", "loja_id": 40,
  "faturamento": 12000.00, "franquia": 0, "custos": 5400.00, "cartoes": 320.00,
  "despesas": 1800.00, "atualizado_em": "2026-07-27T18:00:00.000Z"
}
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao salvar entrada de margem." }`

---

## 3. `GET /api/margens/relatorio?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD`

Soma os lançamentos diários do período por loja, calcula a margem e devolve
já pronto para montar o relatório (agrupado por Diretor → Rede → Loja).

### Cálculo (por loja, somando o período)
```
fatSemFranquia = SUM(faturamento) - SUM(franquia)
lucroBruto     = fatSemFranquia - SUM(custos) - SUM(cartoes)
lucroLiquido   = lucroBruto - SUM(despesas)
percentualLucroBruto   = lucroBruto / fatSemFranquia * 100
percentualLucroLiquido = lucroLiquido / fatSemFranquia * 100
cor: percentualLucroBruto >= 41 ? "verde" : (percentualLucroBruto >= 40 ? "amarelo" : "vermelho")
```
Se `fatSemFranquia` for `0` para uma loja (sem lançamento no período), ela é
omitida do resultado.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "diretor": { "id": 1, "nome": "Victor Hugo" },
    "rede": { "id": 5, "nome": "Delta", "responsavel": { "id": 3, "nome": "Grazy" } },
    "lojas": [
      {
        "id": 40, "nome": "SLZ 01",
        "faturamento": 335328.34, "fatSemFranquia": 335328.34,
        "lucroBruto": 161203.54, "lucroLiquido": 149011.08,
        "percentualLucroBruto": 48.07, "percentualLucroLiquido": 44.44,
        "cor": "verde"
      }
    ]
  }
]
```

### Erros
`400` (parâmetros de data ausentes/inválidos): `{ "error": "Parâmetros \"dataInicio\" e \"dataFim\" são obrigatórios e devem estar no formato YYYY-MM-DD." }`
`500`: `{ "error": "Erro interno ao gerar relatório de margens." }`

---

## Resumo rápido

| Método | Rota | Body/Query | Sucesso | Principais erros |
|---|---|---|---|---|
| GET | `/api/margens/entradas` | query `data` | `200` array de entradas do dia | `400`, `500` |
| POST | `/api/margens/entradas` | `data`, `lojaId`, valores | `200` entrada com `acao` | `400`, `500` |
| GET | `/api/margens/relatorio` | query `dataInicio`, `dataFim` | `200` margem calculada por loja/rede/diretor | `400`, `500` |

Todos os erros seguem `{ "error": "mensagem" }`. Cadastro de
Diretor/Rede/Loja/Responsável (GG) → ver `CONTRATO-CADASTROS-API.md`.
