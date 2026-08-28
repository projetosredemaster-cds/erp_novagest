# Contrato da API — Autenticação e Administração (erp_Novagest)

> Este documento é o contrato a ser seguido por quem for implementar as rotas
> de autenticação e administração de usuários — escrito **antes** do código,
> junto com `CONTRATO-RANKING-API.md` (que documenta o módulo Ranking).
> Nenhuma destas rotas existe ainda no código atual.

## Contexto e decisões de design

- A tabela `Usuarios` **já existe** no Azure SQL, com colunas `id`,
  `email`, `senha_hash`, `is_admin`, `role`, `criado_em` (`role` foi
  adicionada depois, pela migration documentada em
  `CONTRATO-CONTROLE-LIGACOES-API.md` — `'admin' | 'usuario' |
  'operador_cobranca'`, convive com `is_admin` sem substituí-lo).
  **Não recrie a tabela nem insira nenhum usuário admin novo** — já existe
  um usuário com `is_admin = 1` cadastrado manualmente, com `senha_hash` em
  bcrypt. O código deve apenas ler/gravar nessa tabela como está.
- **Hash de senha**: sempre `bcrypt`, `bcrypt.hash(senha, 10)` na gravação e
  `bcrypt.compare(senha, senha_hash)` na checagem de login. Nunca comparar
  senha em texto puro.
- **Token**: JWT (`jsonwebtoken`), assinado com `HS256`, segredo lido de
  `process.env.JWT_SECRET` (nova variável de ambiente — ver seção
  "Variáveis de ambiente novas" abaixo). Payload:
  ```json
  { "id": 7, "email": "admin@novagest.com", "isAdmin": true, "role": "admin" }
  ```
  (mais os claims automáticos `iat`/`exp` do `jsonwebtoken`). Expira em
  **12 horas** (`expiresIn: '12h'`) — decisão registrada aqui porque não é
  um requisito explícito do pedido original; 12h cobre um turno de trabalho
  sem exigir refresh token, que está fora do escopo desta implementação.
  `role` (`'admin' | 'usuario' | 'operador_cobranca'`) foi adicionado ao
  payload junto com o papel novo `operador_cobranca` do Controle de
  Ligações — ver `CONTRATO-CONTROLE-LIGACOES-API.md` para o contrato
  completo desse módulo (schema da coluna, rota de login alternativa,
  middleware novo).
- **Nomenclatura de campo**: por consistência com o resto deste contrato
  (e com o payload do JWT), toda resposta que carrega o status de
  administrador usa a chave `isAdmin` (camelCase, booleano), mesmo que a
  coluna no banco seja `is_admin`. Os demais campos seguem a mesma
  convenção já usada em `CONTRATO-RANKING-API.md`: nomes de coluna crus em
  snake_case para timestamps (`criado_em`), sem aninhamento desnecessário.
- **Formato de erro padrão**: igual ao resto da API —
  `{ "error": "mensagem" }`.
- **Nunca** incluir `senha_hash` em nenhuma resposta, em nenhuma rota,
  nunca.
- **Unicidade de e-mail**: decisão registrada (não é um requisito explícito
  do pedido original, mas é necessária para o login funcionar sem
  ambiguidade): `POST /api/admin/usuarios` bloqueia com `409 Conflict` se o
  `email` já existir (comparação case-insensitive, mesma lógica de
  duplicidade já usada para nomes de Redes/Lojas — `LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))`,
  em query parametrizada).
- **Auto-exclusão bloqueada**: decisão registrada — `DELETE
  /api/admin/usuarios/:id` bloqueia com `409 Conflict` se `:id` for igual ao
  id do usuário autenticado (extraído do token), para evitar que um admin
  se auto-exclua e fique bloqueado do sistema. Não é um requisito explícito
  do pedido original, mas é uma salvaguarda mínima razoável para uma área
  administrativa.

## Variáveis de ambiente novas

Adicionar a `backend/.env.example` (com valor vazio) e a `backend/.env`
(com um valor real gerado, nunca versionado):

```
JWT_SECRET=
```

## Middlewares novos

### `authMiddleware` (autenticação)
Aplicado a toda rota protegida. Lê o header `Authorization: Bearer <token>`.

- Se o header estiver ausente ou não seguir o formato `Bearer <token>`:
  ```json
  401 Unauthorized
  { "error": "Token de autenticação não informado." }
  ```
- Se o token for inválido ou expirado (`jwt.verify` lança erro):
  ```json
  401 Unauthorized
  { "error": "Token de autenticação inválido ou expirado." }
  ```
- Se válido, popula `req.usuario = { id, email, isAdmin, role }` (payload
  decodificado do token) e chama `next()`.

### `adminMiddleware` (autorização)
Aplicado **depois** de `authMiddleware`, só nas rotas de
`/api/admin/*`. Assume que `req.usuario` já existe.

- Se `req.usuario.isAdmin !== true`:
  ```json
  403 Forbidden
  { "error": "Acesso restrito a administradores." }
  ```
- Se `isAdmin === true`, chama `next()`.

Existe também `operadorCobrancaMiddleware`, análogo ao `adminMiddleware`
mas checando `req.usuario.role === 'operador_cobranca'` em vez de
`isAdmin` — contrato completo em `CONTRATO-CONTROLE-LIGACOES-API.md`.

## Rotas protegidas do resto do sistema

Todas as rotas já existentes de `/api/ranking/*` passam a exigir
`authMiddleware` (qualquer usuário autenticado, admin ou não — o Ranking em
si não é uma área restrita a admin, só a tela de configuração de
redes/lojas é, e essa restrição é 100% de UI no frontend, não uma rota
backend separada, já que o CRUD de redes/lojas já é usado por qualquer
usuário autenticado que tenha acesso à tela). Isso não muda nenhum
contrato de request/response já documentado em `CONTRATO-RANKING-API.md`
— só adiciona a exigência do header `Authorization` e a possibilidade de
`401` se ele faltar/for inválido, igual ao comportamento de
`authMiddleware` acima.

---

## 1. `POST /api/auth/login`

Autentica um usuário existente e retorna um token JWT.

### Corpo da requisição
| Campo   | Tipo   | Obrigatório | Validação |
|---------|--------|-------------|-----------|
| `email` | string | sim | não pode ser vazio/só espaços |
| `senha` | string | sim | não pode ser vazio |

```json
{ "email": "admin@novagest.com", "senha": "minhasenha123" }
```

### Validações — `400 Bad Request`
1. `email` ausente/vazio:
   ```json
   { "error": "Campo \"email\" é obrigatório." }
   ```
2. `senha` ausente/vazio:
   ```json
   { "error": "Campo \"senha\" é obrigatório." }
   ```

### Autenticação — `401 Unauthorized`
Se o `email` não existir na tabela `Usuarios`, **ou** existir mas
`bcrypt.compare(senha, senha_hash)` retornar `false`, a resposta é
**idêntica nos dois casos** (nunca revelar qual dos dois estava errado):
```json
{ "error": "E-mail ou senha inválidos." }
```

### Papel incompatível — `403 Forbidden`
Se `email`/`senha` estão corretos mas `role === 'operador_cobranca'`
(usuário do Controle de Ligações tentando entrar pelo login normal do
ERP — ver `CONTRATO-CONTROLE-LIGACOES-API.md`, seção 2, para o contexto
completo dessa decisão de isolamento):
```json
{ "error": "Este usuário deve acessar pelo login do Controle de Ligações." }
```

### Resposta de sucesso — `200 OK`
Passa a incluir `role` (`'admin' | 'usuario' | 'operador_cobranca'`),
junto de `isAdmin` — nenhum dos dois campos foi removido. Na prática,
`role` nunca é `'operador_cobranca'` numa resposta de sucesso desta rota,
por causa do `403` acima:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "usuario": {
    "id": 7,
    "email": "admin@novagest.com",
    "isAdmin": true,
    "role": "admin"
  }
}
```

O payload do JWT ganha o mesmo campo `role`, mesma expiração de 12h.

Existe também `POST /api/auth/reativacao/login`, rota pública separada
para o papel `operador_cobranca` (mesmo corpo/validações, checagem de
papel invertida) — contrato completo em
`CONTRATO-CONTROLE-LIGACOES-API.md`, seção 1.

### Erros
- `400 Bad Request` — campos ausentes (mensagens acima).
- `401 Unauthorized` — credenciais inválidas (mensagem acima).
- `403 Forbidden` — papel incompatível (mensagem acima).
- `500 Internal Server Error`:
  ```json
  { "error": "Erro interno ao autenticar." }
  ```

---

## 2. `GET /api/auth/me`

Retorna os dados do usuário autenticado, a partir do token — usado pelo
frontend para validar uma sessão persistida (ex.: ao recarregar a página)
sem precisar guardar o payload decodificado manualmente. Protegida por
`authMiddleware`.

### Requisição
Sem body. Header `Authorization: Bearer <token>` obrigatório.

### Resposta de sucesso — `200 OK`
Passa a incluir `role`, junto de `isAdmin`:
```json
{ "id": 7, "email": "admin@novagest.com", "isAdmin": true, "role": "admin" }
```

### Erros
- `401 Unauthorized` — token ausente/inválido/expirado (mensagens da
  seção `authMiddleware`).
- `500 Internal Server Error`:
  ```json
  { "error": "Erro interno ao buscar usuário autenticado." }
  ```

---

## 3. `GET /api/admin/usuarios`

Lista todos os usuários cadastrados. Protegida por `authMiddleware` +
`adminMiddleware`.

### Requisição
Sem parâmetros de query nem body.

### Resposta de sucesso — `200 OK`
Array plano, ordenado por `email`, **sem** `senha_hash`. Cada item passa a
incluir também `role` (`'admin'`, `'usuario'` ou `'operador_cobranca'`),
junto de `isAdmin` — nenhum dos dois campos foi removido:
```json
[
  {
    "id": 7,
    "email": "admin@novagest.com",
    "isAdmin": true,
    "role": "admin",
    "criado_em": "2026-01-10T12:00:00.000Z"
  },
  {
    "id": 12,
    "email": "vendedor@novagest.com",
    "isAdmin": false,
    "role": "usuario",
    "criado_em": "2026-07-17T14:00:00.000Z"
  },
  {
    "id": 15,
    "email": "cobranca@novagest.com",
    "isAdmin": false,
    "role": "operador_cobranca",
    "criado_em": "2026-08-21T09:00:00.000Z"
  }
]
```

### Erros
- `401 Unauthorized` — não autenticado.
- `403 Forbidden` — autenticado mas não é admin.
- `500 Internal Server Error`:
  ```json
  { "error": "Erro interno ao listar usuários." }
  ```

---

## 4. `POST /api/admin/usuarios`

Cria um novo usuário **comum** (nunca admin — não existe forma de criar um
admin por essa rota; qualquer usuário criado aqui é sempre gravado com
`is_admin = 0`). Protegida por `authMiddleware` + `adminMiddleware`.

### Corpo da requisição
| Campo               | Tipo    | Obrigatório | Validação |
|---------------------|---------|-------------|-----------|
| `email`             | string  | sim | não pode ser vazio/só espaços |
| `senha`             | string  | sim | não pode ser vazio |
| `operadorCobranca`  | boolean | não | truthy exato `true` (não string `"true"`); qualquer outro valor, incluindo ausente, equivale a `false` |

`operadorCobranca` controla o `role` gravado: `true` grava
`role = 'operador_cobranca'`; ausente, `false`, ou qualquer outro valor
grava `role = 'usuario'` (comportamento atual, sem mudança visível quando o
campo não é enviado). **Não existe** opção para criar `role = 'admin'` por
essa rota — admin continua sendo só cadastro manual direto no banco.

```json
{ "email": "vendedor@novagest.com", "senha": "senha123" }
```

Exemplo criando um operador de cobrança:
```json
{ "email": "cobranca@novagest.com", "senha": "senha123", "operadorCobranca": true }
```

### Validações — `400 Bad Request`
Validado nesta ordem:
1. `email` ausente/vazio:
   ```json
   { "error": "Campo \"email\" é obrigatório." }
   ```
2. `senha` ausente/vazio — **NUNCA gerar/preencher uma senha padrão como
   fallback; se vazio, bloquear e não cadastrar nada**:
   ```json
   { "error": "Campo \"senha\" é obrigatório." }
   ```

### Duplicidade — `409 Conflict`
Se já existir um usuário com o mesmo `email` (case-insensitive, trim —
ver decisão registrada no topo do documento):
```json
{ "error": "Já existe um usuário com esse e-mail." }
```

### Comportamento no banco
- Gera o hash: `bcrypt.hash(senha, 10)`.
- Calcula `role`: `operadorCobranca === true ? 'operador_cobranca' : 'usuario'`.
- `INSERT INTO Usuarios (email, senha_hash, is_admin, role, criado_em) VALUES (@email, @senhaHash, 0, @role, SYSUTCDATETIME())`.

### Resposta de sucesso — `201 Created`
Passa a incluir `role`, junto de `isAdmin`:
```json
{
  "id": 12,
  "email": "vendedor@novagest.com",
  "isAdmin": false,
  "role": "usuario",
  "criado_em": "2026-07-17T14:00:00.000Z"
}
```

Ou, com `operadorCobranca: true`:
```json
{
  "id": 15,
  "email": "cobranca@novagest.com",
  "isAdmin": false,
  "role": "operador_cobranca",
  "criado_em": "2026-08-21T09:00:00.000Z"
}
```

### Erros
- `400 Bad Request` — `email`/`senha` ausentes (mensagens acima).
- `401 Unauthorized` — não autenticado.
- `403 Forbidden` — autenticado mas não é admin.
- `409 Conflict` — e-mail já cadastrado (mensagem acima).
- `500 Internal Server Error`:
  ```json
  { "error": "Erro interno ao criar usuário." }
  ```

---

## 5. `DELETE /api/admin/usuarios/:id`

Remove um usuário. Protegida por `authMiddleware` + `adminMiddleware`.

### Parâmetro de rota
| Parâmetro | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `id` | number (rota) | sim | inteiro positivo, senão `400` |

```json
400 Bad Request
{ "error": "Parâmetro \"id\" deve ser um número inteiro positivo." }
```

### `404 Not Found`
Se `:id` não corresponder a nenhum usuário:
```json
{ "error": "Usuário não encontrado." }
```

### Auto-exclusão — `409 Conflict`
Se `:id` for igual ao id do usuário autenticado (`req.usuario.id`, extraído
do token — ver decisão registrada no topo do documento):
```json
{ "error": "Não é possível excluir seu próprio usuário enquanto estiver autenticado com ele." }
```

### Comportamento no banco
`DELETE FROM Usuarios WHERE id = @id` (exclusão física — não existe
conceito de soft-delete de usuário neste contrato).

### Resposta de sucesso — `204 No Content`
Sem corpo, mesma convenção usada em `DELETE /api/ranking/redes/:id` e
`/lojas/:id`.

### Erros
- `400 Bad Request` — `:id` não é inteiro positivo.
- `401 Unauthorized` — não autenticado.
- `403 Forbidden` — autenticado mas não é admin.
- `404 Not Found` — usuário não encontrado.
- `409 Conflict` — tentativa de auto-exclusão (mensagem acima).
- `500 Internal Server Error`:
  ```json
  { "error": "Erro interno ao excluir usuário." }
  ```

---

## Resumo rápido

| Método | Rota | Auth | Body/Params | Sucesso | Principais erros |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | pública | body `email`, `senha` | `200` `{ token, usuario }` | `400`, `401`, `500` |
| GET | `/api/auth/me` | logado | — | `200` `{ id, email, isAdmin, role }` | `401`, `500` |
| GET | `/api/admin/usuarios` | admin | — | `200` array de usuários (sem hash) | `401`, `403`, `500` |
| POST | `/api/admin/usuarios` | admin | body `email`, `senha` | `201` usuário criado (`isAdmin: false`) | `400`, `401`, `403`, `409`, `500` |
| DELETE | `/api/admin/usuarios/:id` | admin | — | `204` | `400`, `401`, `403`, `404`, `409`, `500` |

Todos os erros seguem `{ "error": "mensagem" }`. Rotas "admin" exigem os
dois middlewares em sequência (`authMiddleware`, depois
`adminMiddleware`); rotas "logado" exigem só `authMiddleware`. A partir
desta implementação, todas as rotas de `/api/ranking/*` também passam a
exigir `authMiddleware` (ver seção "Rotas protegidas do resto do
sistema").
