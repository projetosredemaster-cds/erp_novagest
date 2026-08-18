# Contrato da API — Módulo Marketing (erp_Novagest) — v1 (DRAFT)

> **Origem**: este contrato nasceu de uma planilha manual (`MARKETING_GERAL.xlsx`)
> mantida pelo Caio, com faturamento geral × faturamento vindo de marketing por
> Loja física, mês a mês, com uma coluna de observação digitada à mão tipo
> `"CAIU FATURAMENTO E SUBIU RENDIMENTO"`. O objetivo deste módulo é eliminar
> a digitação manual dessa comparação (fonte de erro relatada na reunião com
> Natanael de 13/08/2026 — valores invertidos, linhas não contabilizadas) e
> deixar geral/marketing/comparação como entrada simples + cálculo automático.
>
> **v1 = escopo reduzido, por decisão do usuário**: fica de fora do v1 o
> detalhamento por canal (TV, Instagram/Netplace, OLX, Facebook, Rádio — que
> existe nas abas `TOTAL`/`REDE 1`/`REDE 2`/`REDE 3` da planilha original).
> Isso pode virar v2 depois que o v1 estiver validado em produção — **não**
> projete o schema do v1 de um jeito que dificulte adicionar isso depois (ver
> nota no final).
>
> **Cliente Retorno/Indicação entra no v1** (aba `PVH2 - JANFEV` da planilha
> original): mesma lógica de "parte específica ÷ faturamento geral +
> comparação automática" que já vale pra marketing, só que aplicada ao
> faturamento vindo de cliente retorno/indicação. Como os dois indicadores
> (marketing e retorno/indicação) compartilham o mesmo `faturamento_geral` da
> loja no mês e são preenchidos juntos na mesma tela, viram **colunas na
> mesma tabela/lançamento**, não uma tabela `tipo`-genérica separada — evita
> uma segunda chamada de API pra salvar o mesmo mês da mesma loja.
>
> **Granularidade**: mensal, por **Loja física** (não por Rede) — os nomes na
> planilha original (`THE1`, `SLZ1`, `DIRCEU`...) são lojas, já cadastradas em
> `Lojas` via `/api/cadastros/*`. Este módulo **não duplica** CRUD de
> Loja/Rede/Diretor — só lê (mesmo princípio de `margens.model.js` e
> `residuo.model.js`: JOIN de leitura direto contra `Lojas`/`Redes`/`Diretores`,
> sem chamar `cadastros.model.js`).
>
> **`ativo` impacta este módulo, `visivel` não** (v1 revisado — comportamento
> corrigido, não estava assim antes): `GET /api/marketing/entradas` só
> retorna Redes com `ativo = 1` **e** Lojas com `ativo = 1` — mesmo
> princípio que Margens já aplica nos próprios seletores (rede/loja
> desativada não pode receber novo lançamento em nenhum módulo). `visivel`
> é um conceito só do grid do Ranking e não se aplica aqui. Diretor
> removido some naturalmente da árvore (a query começa em `Diretores` e
> segue pra `Redes`/`Lojas` — sem necessidade de tratamento especial, já
> que `DELETE /api/cadastros/diretores/:id` só é permitido sem nenhuma
> rede vinculada).

## Informações gerais

- **Prefixo do módulo**: `/api/marketing`
- **Auth**: `authMiddleware` no mount — qualquer usuário autenticado (mesmo
  padrão de Ranking/Cadastros/Margens/Resíduo; não há ação neste módulo
  restrita a admin no v1).
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## Schema novo

### `MarketingEntradas`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `data_ref` | date | sempre o **dia 1** do mês/ano do lançamento (ex.: `2026-08-01`) — mesma convenção de "mês como data" já usada, evita criar colunas `ano`/`mes` separadas |
| `loja_id` | int, FK `Lojas` | — |
| `faturamento_geral` | decimal | `>= 0` |
| `faturamento_marketing` | decimal | `>= 0` — parte do faturamento geral atribuída a marketing |
| `faturamento_retorno_indicacao` | decimal | `>= 0` — parte do faturamento geral vinda de cliente retorno/indicação |
| `atualizado_em` | datetime | `SYSUTCDATETIME()` no upsert |

**UNIQUE** em `(data_ref, loja_id)` — um lançamento por loja por mês, mesmo
padrão de `MargensEntradas` (`data_ref + loja_id`).

Percentuais (`faturamento_marketing / faturamento_geral` e
`faturamento_retorno_indicacao / faturamento_geral`) e as comparações
subiu/caiu **não são colunas** — são sempre calculados na leitura (mesmo
princípio de `percentualMargem` em Margens: nunca persista o que dá pra
derivar dos números crus). Isso também significa que corrigir um
lançamento antigo recalcula automaticamente a comparação do mês seguinte,
sem precisar reprocessar nada.

---

## 1. `GET /api/marketing/entradas?ano=YYYY&mes=MM`

Retorna **todas as lojas ativas**, agrupadas Diretor → Rede → Loja (mesmo
formato aninhado de `GET /api/cadastros/redes`), cada uma com o lançamento
do mês pedido (se existir) e a comparação já calculada contra o mês
anterior. Lojas sem lançamento no mês aparecem com os campos de valor como
`null` — é assim que o frontend sabe quais inputs ainced estão vazios.

### Lógica de comparação (calculada, nunca digitada)
Para cada loja, busca também o lançamento de `data_ref` = mês anterior.
- Se não existir lançamento no mês anterior: `comparacao: null` (equivalente
  ao `"-"` que a planilha usava quando não tinha mês anterior pra comparar).
- Se existir: compara `faturamento_geral`, `faturamento_marketing` e
  `faturamento_retorno_indicacao` **independentemente**, cada um vira
  `"subiu"` / `"caiu"` / `"igual"` (`igual` quando o valor não mudou — a
  planilha original não tinha esse terceiro estado e forçava subiu/caiu
  mesmo em empate, o que é uma fonte de erro; **decisão nova, a confirmar
  com o Caio**: tratar valor igual como `"igual"` em vez de forçar
  caiu/subiu).

### Resposta de sucesso — `200 OK`
```json
[
  {
    "diretor": { "id": 1, "nome": "Victor Hugo" },
    "rede": { "id": 5, "nome": "Delta" },
    "lojas": [
      {
        "id": 40, "nome": "SLZ 01",
        "faturamentoGeral": 261451.99,
        "faturamentoMarketing": 104294.00,
        "faturamentoRetornoIndicacao": 31200.00,
        "percentualMarketing": 39.89,
        "percentualRetornoIndicacao": 11.93,
        "comparacao": {
          "faturamentoGeral": "subiu",
          "faturamentoMarketing": "subiu",
          "faturamentoRetornoIndicacao": "caiu"
        },
        "atualizadoEm": "2026-08-05T14:00:00.000Z"
      },
      {
        "id": 41, "nome": "SLZ 02",
        "faturamentoGeral": null,
        "faturamentoMarketing": null,
        "faturamentoRetornoIndicacao": null,
        "percentualMarketing": null,
        "percentualRetornoIndicacao": null,
        "comparacao": null,
        "atualizadoEm": null
      }
    ]
  }
]
```

### Validações — `400 Bad Request`
`ano`/`mes` ausentes ou fora de formato válido:
```json
{ "error": "Parâmetros \"ano\" e \"mes\" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12)." }
```

### Totais por Diretor (adição — replica a linha "TOTAL GERAL:" da planilha original)
Cada grupo de Diretor no array de resposta ganha um campo `totais`, irmão de
`rede`/`lojas`, calculado somando **todas as lojas daquele diretor** (em
todas as suas redes) que têm lançamento no mês — lojas sem lançamento
(`null`) são ignoradas na soma, não tratadas como zero.

- `totalAtual` = soma de cada campo (`faturamento_geral`,
  `faturamento_marketing`, `faturamento_retorno_indicacao`) das lojas com
  lançamento no mês pedido.
- `totalAnterior` = mesma soma, para o mês anterior.
- `comparacao` do total usa a mesma função de comparação
  (subiu/caiu/igual) já usada por loja, aplicada em `totalAtual` vs
  `totalAnterior` — **não** é a maioria/soma das comparações individuais
  das lojas, é uma comparação nova, direto nos totais somados.
- Se nenhuma loja do diretor tiver lançamento no mês, `totais` vem com
  todos os campos `null` (mesmo padrão de loja sem lançamento).

### Resposta de sucesso — `200 OK` (com totais)
```json
[
  {
    "diretor": { "id": 1, "nome": "Pedro" },
    "totais": {
      "faturamentoGeral": 2422570.79,
      "faturamentoMarketing": 587442.03,
      "faturamentoRetornoIndicacao": 198340.00,
      "percentualMarketing": 24.25,
      "percentualRetornoIndicacao": 8.19,
      "comparacao": {
        "faturamentoGeral": "subiu",
        "faturamentoMarketing": "subiu",
        "faturamentoRetornoIndicacao": "caiu"
      }
    },
    "redes": [
      {
        "rede": { "id": 5, "nome": "Delta" },
        "lojas": [ { "...": "mesmo formato de antes" } ]
      }
    ]
  }
]
```

> **Nota de estrutura**: a resposta anterior tinha `rede`/`lojas` soltos por
> item do array (um item por Rede). Pra caber `totais` uma vez por Diretor
> sem repetir em cada Rede, o array agora agrupa por Diretor no nível
> superior, com `redes[]` aninhado dentro — ajuste o `GROUP BY`/agregação
> no `marketing.service.js` de acordo. Isso muda a forma do JSON (nível
> novo `redes[]`), avise o frontend-developer antes de ele continuar
> consumindo a resposta antiga.

---

## 2. `POST /api/marketing/entradas`

Upsert por `(data_ref, lojaId)` — mesmo padrão `MERGE` de
`margens.model.js: upsertEntrada` — `200 OK` mesmo em criação.

### Corpo da requisição
| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `lojaId` | number | sim | inteiro positivo, deve existir em `Lojas` |
| `ano` | number | sim | inteiro, 4 dígitos |
| `mes` | number | sim | inteiro, `1`–`12` |
| `faturamentoGeral` | number | sim | `>= 0` |
| `faturamentoMarketing` | number | sim | `>= 0` — **não há validação cruzada** que bloqueie `faturamentoMarketing > faturamentoGeral` (pode acontecer na planilha original em cenários atípicos; decisão: só alertar no frontend, nunca bloquear no backend — a confirmar) |
| `faturamentoRetornoIndicacao` | number | sim | `>= 0` — mesma observação acima: sem validação cruzada contra `faturamentoGeral` no backend |

### Validações — `400 Bad Request` (nesta ordem)
1. `lojaId` ausente/inválido, ou não existe: `{ "error": "Loja informada não existe." }`
2. `ano`/`mes` ausentes ou inválidos: `{ "error": "Campos \"ano\" e \"mes\" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12)." }`
3. `faturamentoGeral` ausente ou negativo: `{ "error": "Campo \"faturamentoGeral\" é obrigatório e deve ser maior ou igual a zero." }`
4. `faturamentoMarketing` ausente ou negativo: `{ "error": "Campo \"faturamentoMarketing\" é obrigatório e deve ser maior ou igual a zero." }`
5. `faturamentoRetornoIndicacao` ausente ou negativo: `{ "error": "Campo \"faturamentoRetornoIndicacao\" é obrigatório e deve ser maior ou igual a zero." }`

### Resposta de sucesso — `200 OK`
```json
{
  "acao": "INSERT",
  "id": 900,
  "lojaId": 40,
  "dataRef": "2026-08-01T00:00:00.000Z",
  "faturamentoGeral": 261451.99,
  "faturamentoMarketing": 104294.00,
  "faturamentoRetornoIndicacao": 31200.00,
  "atualizadoEm": "2026-08-05T14:00:00.000Z"
}
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao salvar entrada de marketing." }`

---

## 3. `DELETE /api/marketing/entradas?ano=YYYY&mes=MM&lojaId=X`

Remove o lançamento correspondente, se existir. **Idempotente**: `204`
tanto se a linha existia quanto se não existia — mesmo padrão de
`DELETE /api/ranking/entradas`.

**Quando o frontend deve chamar isto em vez de `POST`**: quando, depois da
edição, os 3 campos (`faturamentoGeral`, `faturamentoMarketing`,
`faturamentoRetornoIndicacao`) ficam **todos** zero/vazios — nesse caso a
linha inteira é excluída em vez de persistida zerada (equivalente ao
"campo zerado apaga a entrada" que o Ranking já faz, adaptado pra um
lançamento com 3 campos em vez de 1). Se só um dos três for zero mas os
outros tiverem valor, isso **não** é motivo pra `DELETE` — é um `POST`
normal, zero pode ser um dado real (ex.: nenhum retorno/indicação naquele
mês).

`DELETE FROM MarketingEntradas WHERE data_ref = @dataRef AND loja_id = @lojaId`

### Validações — `400 Bad Request`
`ano`/`mes`/`lojaId` ausentes ou inválidos:
```json
{ "error": "Parâmetros \"ano\", \"mes\" e \"lojaId\" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12)." }
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao excluir entrada de marketing." }`

---

## Fora de escopo do v1 (registrado, não implementar agora)

- **Detalhamento por canal** (TV, Netplace/Instagram, OLX, Facebook, Rádio):
  viraria uma tabela `MarketingCanaisEntradas` (`data_ref`, `loja_id`,
  `canal`, `valor`), separada de `MarketingEntradas` — não amarre isso na
  tabela do v1 quando for implementar, pra não forçar todo lançamento a
  ter canal.

---

## Resumo rápido

| Método | Rota | Observação |
|---|---|---|
| GET | `/api/marketing/entradas` | query `ano`, `mes` — agrupado Diretor→Rede→Loja (só Redes/Lojas com `ativo=1`), com % e comparação (marketing **e** retorno/indicação) já calculados |
| POST | `/api/marketing/entradas` | upsert por `(ano, mes, lojaId)` — `faturamentoGeral`, `faturamentoMarketing` e `faturamentoRetornoIndicacao` salvos juntos, num único lançamento |
| DELETE | `/api/marketing/entradas` | query `ano`, `mes`, `lojaId` — idempotente; usar quando os 3 campos ficam zerados, em vez de persistir zerado |

Todos os erros seguem `{ "error": "mensagem" }`.
