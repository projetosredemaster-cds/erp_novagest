---
name: backend-conventions
description: Convenções de código e segurança para backend Node.js/Express com banco de dados SQL. Use sempre que estiver criando, revisando ou editando rotas, controllers, services, models ou conexões de banco — inclusive fora do subagente backend-architect, em qualquer edição direta de arquivo de backend.
---

# Convenções de Backend

## Arquitetura em camadas (obrigatória)

`routes` (define endpoint e método HTTP) → `controller` (recebe request/response, valida input, chama service) → `service` (regra de negócio) → `model`/acesso a dados (query SQL).

Nunca coloque lógica de negócio dentro de `controller` ou `route` — isso deixa o código difícil de testar e reutilizar.

## Segurança — regras inegociáveis

- Toda query SQL deve ser **parametrizada** (bind parameters do driver/ORM em uso) — nunca concatene string de SQL com valor vindo do usuário. Isso é prevenção de SQL Injection e não é opcional.
- Nunca hardcode credenciais, strings de conexão ou segredos no código — sempre via variáveis de ambiente (`.env`, nunca commitado; mantenha um `.env.example` sem valores reais).
- Valide toda entrada antes de chegar no service (ex: `express-validator`, `zod`, ou checagem manual explícita) — nunca confie em dado vindo do cliente sem validar.

## Padrão de API REST

- `GET /recurso` — listar
- `GET /recurso/:id` — detalhe
- `POST /recurso` — criar
- `PUT /recurso/:id` — atualizar
- `DELETE /recurso/:id` — remover
- Status HTTP correto: 200/201 sucesso, 400 validação, 404 não encontrado, 409 conflito, 500 erro interno.
- Corpo de erro consistente, ex: `{ "error": "mensagem" }`.

## Organização de pastas (por módulo/domínio)

```
backend/
├── src/
│   ├── modulos/
│   │   └── <dominio>/
│   │       ├── <dominio>.controller.js
│   │       ├── <dominio>.routes.js
│   │       ├── <dominio>.service.js
│   │       └── <dominio>.model.js
│   ├── config/
│   │   └── database.js
│   ├── middlewares/
│   ├── app.js
│   └── server.js
├── .env
└── package.json
```

Nomes de tabelas, rotas e arquivos sempre organizados por módulo/domínio, para não colidir quando o sistema crescer com múltiplos módulos lado a lado.

## Antes de codar

1. Leia a estrutura de pastas e arquivos existentes do backend antes de criar algo novo, para manter consistência.
2. Confirme (ou assuma de forma explícita, documentando a suposição) qual biblioteca de acesso a dados está em uso antes de escrever código de conexão novo — não troque de driver/ORM sem necessidade.
3. Trate erros de banco/rede explicitamente (banco fora do ar, timeout, registro não encontrado) — nunca deixe uma exceção estourar sem tratamento até o cliente.
