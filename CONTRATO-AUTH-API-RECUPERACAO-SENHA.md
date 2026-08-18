# Contrato da API — Recuperação de Senha (erp_Novagest) — adendo ao CONTRATO-AUTH-API.md

> Este documento complementa `CONTRATO-AUTH-API.md` (v1) — não repete o que
> já está lá (hash com bcrypt, JWT, tabela `Usuarios`). Cobre só o fluxo
> novo: usuário esqueceu a senha, recebe um link por e-mail, redefine.
>
> **Fora de escopo deste adendo, por decisão do usuário**: "alterar senha"
> pra quem já está logado (ex.: tela de perfil, pedindo senha atual) não
> entra agora — só recuperação por esquecimento.
>
> **Amendment ao `CONTRATO-AUTH-API.md` v1**: por decisão do usuário, a
> mesma regra de complexidade de senha (ver abaixo) passa a valer também
> em `POST /api/admin/usuarios` (criação de usuário pelo admin), não só
> na redefinição. Isso muda o contrato original: a validação 2 daquela
> rota (`senha` ausente/vazio) ganha uma validação 3 nova, na mesma
> ordem/formato desta rota. Ver seção "Amendment" no final deste
> documento para o texto exato a aplicar lá.
>
> **Reaproveita `brevoEmail.service.js`** (já usado pelo Ranking pra
> enviar relatório) — precisa de uma função nova nesse arquivo pra montar
> um e-mail com assunto/corpo diferentes, mas é a mesma camada de acesso
> ao Brevo, não um serviço novo. **Não mexa na função que o Ranking já
> usa** — só adicione uma nova ao lado dela.

## Schema novo

### `PasswordResetTokens`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | int, PK | — |
| `usuario_id` | int, FK `Usuarios` | — |
| `token_hash` | varchar(64) | **hash SHA-256 do token**, nunca o token em texto puro — mesmo princípio de nunca guardar segredo em claro que já vale pra `senha_hash` |
| `expira_em` | datetime2 | criado_em + 1 hora (decisão registrada abaixo) |
| `usado` | bit, default 0 | marca `1` depois de uma redefinição bem-sucedida — token é de uso único |
| `criado_em` | datetime2 | `SYSUTCDATETIME()` |

Sem `UNIQUE` em `usuario_id` — um usuário pode gerar vários pedidos de
recuperação (ex.: o e-mail anterior "sumiu"); todos os tokens antigos
não usados desse usuário são invalidados quando um novo token é
efetivamente usado com sucesso (ver rota 2, comportamento no banco).

## Informações gerais

- **Prefixo**: mesmo `/api/auth` do contrato original.
- **Auth**: as duas rotas abaixo são **públicas** (sem token — faz parte
  do propósito: o usuário não consegue logar, é assim que chegou aqui).
- **Formato de erro padrão**: `{ "error": "mensagem" }`

---

## 1. `POST /api/auth/esqueci-senha`

### Corpo da requisição
```json
{ "email": "usuario@novagest.com" }
```

### Comportamento — decisão de segurança registrada
A resposta é **sempre a mesma**, exista ou não o e-mail na base — pra não
revelar quais e-mails têm conta no sistema (mesmo princípio de
"E-mail ou senha inválidos" no login, que não diz qual dos dois errou):

```json
200 OK
{ "message": "Se o e-mail informado estiver cadastrado, você receberá um link de recuperação em instantes." }
```

Internamente, se o e-mail **existir**:
1. Gera um token aleatório (`crypto.randomBytes(32).toString('hex')`).
2. Grava só o **hash SHA-256** do token em `PasswordResetTokens`, com
   `expira_em = agora + 1 hora`.
3. Envia e-mail via Brevo com o link:
   `${FRONTEND_URL}/redefinir-senha?token=<token-em-texto-puro>`
   (o token em claro só existe nesse e-mail — nunca é persistido nem
   logado em texto puro em lugar nenhum).

Se o e-mail **não existir**, não faz nada internamente (não gera token,
não envia e-mail) — só devolve a mesma resposta genérica acima.

### Rate limit
Mesma ideia do `loginLimiter` do contrato original — nova instância de
`express-rate-limit`, aplicada só nesta rota (`5` tentativas por IP a
cada 15 minutos; número menor que o limite de login porque aqui cada
tentativa pode disparar um e-mail real, é mais caro que uma checagem de
senha). `429` ao estourar, mesmo formato de erro:
```json
{ "error": "Muitas tentativas. Tente novamente em alguns minutos." }
```

### Validações — `400 Bad Request`
`email` ausente/vazio:
```json
{ "error": "Campo \"email\" é obrigatório." }
```

### Erros
`500`: `{ "error": "Erro interno ao processar solicitação." }`

---

## 2. `POST /api/auth/redefinir-senha`

### Corpo da requisição
```json
{ "token": "a1b2c3...", "novaSenha": "minhaSenhaNova123" }
```

### Validações — `400 Bad Request` (nesta ordem)
1. `token` ausente/vazio: `{ "error": "Campo \"token\" é obrigatório." }`
2. `novaSenha` ausente/vazio: `{ "error": "Campo \"novaSenha\" é obrigatório." }`
3. `novaSenha` não atende aos critérios mínimos de complexidade (checagem
   nova, decisão registrada — ver abaixo):
   ```json
   { "error": "A senha deve ter no mínimo 6 caracteres e incluir ao menos uma letra maiúscula, um número e um caractere especial." }
   ```
4. Hash do `token` recebido não bate com nenhum `token_hash` em
   `PasswordResetTokens`, **ou** bate mas `usado = 1`, **ou** bate mas
   `expira_em < agora`:
   ```json
   { "error": "Link de recuperação inválido ou expirado." }
   ```
   (mensagem **idêntica** nos 3 casos — não revelar qual dos três
   motivos foi, mesmo princípio de segurança já usado no login)

### Regra de complexidade da senha (decisão registrada)
`novaSenha` precisa satisfazer, todos ao mesmo tempo:
- mínimo **6 caracteres**;
- pelo menos **1 letra maiúscula** (`A-Z`);
- pelo menos **1 número** (`0-9`);
- pelo menos **1 caractere especial** (qualquer coisa fora de
  `A-Za-z0-9`, ex.: `!@#$%^&*()-_=+...`).

Validação simples com regex, sem lib nova (ex.: `express-validator` já
cobre isso com `.matches(...)` encadeado, ou uma função pura só com
regex — a implementação decide, o resultado tem que ser exatamente essa
regra). A checagem roda **antes** de consultar o token no banco (ordem 3
antes de 4 acima) — não faz sentido gastar uma query pra depois rejeitar
por senha fraca.

> **Alteração ao contrato original (`CONTRATO-AUTH-API.md`)**: a mesma
> regra de complexidade de senha passa a valer também em
> `POST /api/admin/usuarios` (criação de usuário pelo admin) — decisão
> tomada aqui, nesta v2, pra não ter dois padrões de senha convivendo no
> sistema. A validação de `senha` nessa rota ganha um passo novo, na
> mesma ordem relativa que já existia (depois de checar que o campo não
> está vazio, antes da checagem de duplicidade de e-mail):
> 1. `email` ausente/vazio → `400` (mensagem original, inalterada)
> 2. `senha` ausente/vazio → `400` (mensagem original, inalterada)
> 3. **Novo**: `senha` não atende à complexidade mínima → `400`, mesma
>    mensagem e mesma regra descritas abaixo pra `novaSenha`
> 4. E-mail duplicado → `409` (mensagem original, inalterada)
>
> Nenhuma outra parte de `POST /api/admin/usuarios` muda — mesmo shape de
> sucesso (`201`), mesmo comportamento de nunca gerar admin por essa rota.

### Comportamento no banco (sucesso)
Dentro de uma transação:
1. `UPDATE Usuarios SET senha_hash = @novoHash WHERE id = @usuarioId`
   (`bcrypt.hash(novaSenha, 10)`, mesmo padrão do resto do sistema).
2. `UPDATE PasswordResetTokens SET usado = 1 WHERE id = @tokenId`.
3. Invalida qualquer outro token não usado e não expirado do mesmo
   `usuario_id` (`UPDATE PasswordResetTokens SET usado = 1 WHERE
   usuario_id = @usuarioId AND usado = 0`) — evita um link antigo, ainda
   dentro da janela de 1h, continuar valendo depois que a senha já foi
   trocada por outro link mais recente.

### Resposta de sucesso — `200 OK`
```json
{ "message": "Senha redefinida com sucesso." }
```

### Erros
`400`, `500`: `{ "error": "Erro interno ao redefinir senha." }`

---

## Frontend — telas novas (públicas, sem `RequireAuth`)

- **Tela de Login existente**: ganha um link **"Esqueci minha senha"**,
  visível abaixo do botão "Entrar" — ponto de entrada único do fluxo,
  navega pra `/esqueci-senha`.
- **`/esqueci-senha`**: formulário com campo `email`, chama a rota 1,
  mostra a mensagem genérica de sucesso (nunca revela se o e-mail
  existe) — usuário é instruído a checar o e-mail cadastrado.
- **`/redefinir-senha?token=...`**: lê `token` da URL, formulário com
  `novaSenha` + confirmação (validação de "as duas senhas são iguais" é
  só client-side, o backend não recebe/valida confirmação). Chama a
  rota 2. Em caso de erro (link inválido/expirado), orienta a solicitar
  um novo link — com um atalho de volta pra `/esqueci-senha`.

### Hint visual do padrão de senha (novo, decisão do usuário)
Tanto em `/redefinir-senha` quanto em `POST /api/admin/usuarios`
(formulário de criação de usuário na `UsuariosPage`), o campo de senha
mostra, sempre visível abaixo do input (não só depois de errar — o
usuário deve saber a regra ANTES de tentar), um texto de ajuda fixo:

> "Mínimo de 6 caracteres, com pelo menos 1 letra maiúscula, 1 número e
> 1 caractere especial."

Se a lib de formulário em uso suportar (ex.: indicador de força), um
checklist com ✓/✗ por critério conforme o usuário digita é um extra
bem-vindo, mas o texto fixo acima é o requisito mínimo — não deixe só
pro erro `400` explicar a regra depois que a pessoa já errou.

## Frontend — exibir o padrão de senha (novo, nas duas telas que pedem senha)

Tanto `/redefinir-senha` quanto a tela existente de criar usuário (a
`ConfigView`/tela de usuários admin que já chama `POST
/api/admin/usuarios`) precisam **mostrar visivelmente** o padrão exigido
perto do campo de senha — não deixar o usuário descobrir a regra só
depois de errar e receber o `400`. Sugestão de implementação (a
implementação final decide o componente exato, mas o conteúdo é este):

- Um texto de ajuda fixo abaixo do campo, sempre visível (não só ao
  focar): *"Mínimo de 6 caracteres, incluindo 1 letra maiúscula, 1
  número e 1 caractere especial."*
- Opcional, mas recomendado: indicador dinâmico por critério (ex.: 3-4
  checkmarks que ficam verdes conforme o usuário digita e cada critério
  passa a ser satisfeito) — dá feedback imediato em vez de só validar no
  submit. Se implementar isso, é 100% client-side/cosmético, não
  substitui a validação real do backend (a regra de verdade continua
  sendo aplicada na API, o frontend só ajuda o usuário a acertar de
  primeira).
- O erro `400` retornado pela API (mensagem completa da regra, ver rota 2
  acima) continua sendo exibido normalmente em caso de falha — o
  indicador visual é um complemento, não substitui o tratamento de erro.

## Resumo rápido

| Método | Rota | Auth | Observação |
|---|---|---|---|
| POST | `/api/auth/esqueci-senha` | pública | resposta sempre genérica; rate limit próprio |
| POST | `/api/auth/redefinir-senha` | pública | token de uso único, expira em 1h; senha com checagem de complexidade |

Todos os erros seguem `{ "error": "mensagem" }`.

---

## Amendment ao `CONTRATO-AUTH-API.md` v1 — `POST /api/admin/usuarios`

Aplique esta mudança **no arquivo `CONTRATO-AUTH-API.md` original**
(seção 4), não neste adendo — está registrada aqui só porque foi essa
conversa que motivou a mudança.

A lista de validações `400 Bad Request` daquela rota, hoje:
1. `email` ausente/vazio
2. `senha` ausente/vazio

Passa a ser:
1. `email` ausente/vazio (sem mudança)
2. `senha` ausente/vazio (sem mudança)
3. **Novo**: `senha` não atende aos critérios mínimos de complexidade —
   mesma regra e mesma mensagem de erro desta rota de redefinição:
   ```json
   { "error": "A senha deve ter no mínimo 6 caracteres e incluir ao menos uma letra maiúscula, um número e um caractere especial." }
   ```

Nenhuma outra parte da seção 4 do contrato original muda (continua
`is_admin = 0` sempre, continua bloqueio de e-mail duplicado por `409`,
etc.) — é só essa validação adicional, na mesma ordem (depois de `email`
e `senha` vazios, antes de checar duplicidade de e-mail).
