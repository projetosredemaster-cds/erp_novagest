# Contrato da API — Módulo Margens (erp_Novagest) — v4

> **Modelo de dados corrigido**: `Faturamento` e `Custo geral de produtos`
> são valores **consolidados da franquia inteira** (o mesmo número vale
> pra todas as lojas num dado dia) — não são específicos de loja/rede. O
> único valor que realmente varia de loja pra loja é o **Total Tar**
> (tarifas de cartão de crédito/débito daquela unidade), e é isso que faz
> a margem de cada loja ser diferente.
>
> Ao confirmar o lançamento de uma loja, o backend grava o `totalTar`
> daquela loja **junto com uma cópia (snapshot) do Faturamento e Custo
> geral usados naquele momento** — histórico intencional, já que os
> valores consolidados podem ser alterados depois sem que isso reescreva
> o cálculo de lançamentos já confirmados.
>
> Isso reaproveita as 5 colunas que `MargensEntradas` já tem no banco,
> sem exigir alteração de schema: `faturamento` = snapshot do Faturamento
> consolidado; `custos` = snapshot do Custo geral de produtos; `cartoes` =
> Total Tar da loja; `franquia` e `despesas` sempre `0` (não usadas nesta
> versão).
>
> Cadastro de Diretor/Rede/Loja/Responsavel continua em
> `CONTRATO-CADASTROS-API.md` — não mudou.

## Informações gerais

- **Prefixo do módulo**: `/api/margens`
- **Auth**: `authMiddleware` no mount — qualquer usuário autenticado.
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `GET /api/margens/entradas?data=YYYY-MM-DD`

Lançamentos já confirmados numa data específica — usado pelo frontend pra
saber quais lojas já estão "Confirmadas" (trava os campos) e quais ainda
estão em aberto, além de pré-preencher os campos Faturamento/Custo geral
com o último snapshot usado naquele dia (se já houver algum).

### Resposta de sucesso — `200 OK`
```json
[
  {
    "id": 900, "data_ref": "2026-07-27T00:00:00.000Z", "loja_id": 40,
    "faturamento": 335328.34, "custoProduto": 168124.80, "totalTar": 6000.00,
    "lucro": 161203.54, "percentualMargem": 48.07,
    "atualizado_em": "2026-07-27T18:00:00.000Z"
  }
]
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao listar entradas de margem." }`

---

## 2. `POST /api/margens/entradas`

Upsert por `(data, lojaId)` — MERGE, `200 OK` mesmo em criação. Usado
tanto no "Confirmar" (primeira vez) quanto no "Editar → salvar de novo"
(sobrescreve o registro existente).

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `data` | string | sim | `^\d{4}-\d{2}-\d{2}$` |
| `lojaId` | number | sim | inteiro positivo, deve existir em `Lojas` |
| `faturamento` | number | sim | `>= 0` — o valor consolidado da franquia usado neste momento |
| `custoProduto` | number | sim | `>= 0` — o custo geral de produtos consolidado usado neste momento |
| `totalTar` | number | sim | `>= 0` — a taxa de cartão específica desta loja |

### Validações — `400 Bad Request` (nesta ordem)
1. `data` inválida
2. `lojaId` ausente/inválido, ou não existe: `{ "error": "Loja informada não existe." }`
3. `faturamento` ausente ou negativo
4. `custoProduto` ausente ou negativo
5. `totalTar` ausente ou negativo

### Comportamento no banco
`MERGE` gravando `faturamento=@faturamento`, `custos=@custoProduto`,
`cartoes=@totalTar`, `franquia=0`, `despesas=0`.

### Resposta de sucesso — `200 OK`
```json
{
  "acao": "INSERT", "id": 900, "data_ref": "2026-07-27T00:00:00.000Z", "loja_id": 40,
  "faturamento": 335328.34, "custoProduto": 168124.80, "totalTar": 6000.00,
  "atualizado_em": "2026-07-27T18:00:00.000Z"
}
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao salvar entrada de margem." }`

---

## 3. `GET /api/margens/relatorio?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD`

Soma os lançamentos do período por loja (cada dia com seu próprio
snapshot de Faturamento/Custo geral + o Total Tar daquele dia) e calcula:
```
lucro            = SUM(faturamento) - SUM(custoProduto) - SUM(totalTar)
percentualMargem = lucro / SUM(faturamento) * 100
cor: percentualMargem >= 41 ? "verde" : (>= 40 ? "amarelo" : "vermelho")
```
Omite lojas sem nenhum lançamento confirmado no período. Retorna tudo do
período de uma vez, agrupado por diretor → rede → lojas — os filtros de
Rede/Cor/Loja na tela de relatório são aplicados no FRONTEND sobre esse
resultado, sem parâmetro de query pra isso.

### Resposta de sucesso — `200 OK`
```json
[
  {
    "diretor": { "id": 1, "nome": "Victor Hugo" },
    "rede": { "id": 5, "nome": "Delta", "responsavel": { "id": 3, "nome": "Grazy" } },
    "lojas": [
      { "id": 40, "nome": "SLZ 01", "faturamento": 335328.34, "custoProduto": 168124.80,
        "totalTar": 6000.00, "lucro": 161203.54, "percentualMargem": 48.07, "cor": "verde" }
    ]
  }
]
```

### Erros
`400`: `{ "error": "Parâmetros \"dataInicio\" e \"dataFim\" são obrigatórios e devem estar no formato YYYY-MM-DD." }`
`500`: `{ "error": "Erro interno ao gerar relatório de margens." }`

---

## Resumo rápido

| Método | Rota | Body/Query | Sucesso |
|---|---|---|---|
| GET | `/api/margens/entradas` | query `data` | `200` array do dia (com snapshot faturamento/custoProduto + totalTar por loja) |
| POST | `/api/margens/entradas` | `data`, `lojaId`, `faturamento`, `custoProduto`, `totalTar` | `200` com `acao` |
| GET | `/api/margens/relatorio` | query `dataInicio`, `dataFim` | `200` agrupado, sem filtro server-side |

Todos os erros seguem `{ "error": "mensagem" }`.