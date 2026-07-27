---
name: testing-conventions
description: Convenções de teste automatizado e checklist de pré-produção para o erp_Novagest (backend Node/Express + frontend React). Use sempre que estiver escrevendo, revisando ou executando testes — inclusive fora do subagente qa-tester, em qualquer validação direta de código antes de um deploy.
---

# Convenções de Testes

## Stack de testes do projeto

- **Vitest** — test runner padrão, tanto backend quanto frontend (mais rápido e com config mais simples que Jest para projetos Vite; funciona igual de bem em backend puro Node).
- **Supertest** — testa rotas Express fazendo requisição HTTP simulada, sem precisar subir um servidor real numa porta.
- **React Testing Library** — testa componentes pelo que o usuário vê/faz (texto na tela, clique, submit), não pela árvore de implementação interna.
- **Playwright** — reservado para testes end-to-end reais (navegador de verdade, fluxo completo); não é o padrão para toda feature nova, só quando pedido explicitamente.

Não introduza uma ferramenta de teste diferente dessas sem necessidade clara — mantenha consistência entre features.

## Onde ficam os arquivos de teste

- Backend: arquivo de teste ao lado do arquivo testado, mesmo nome + `.test.js` (ex: `ranking.controller.js` → `ranking.controller.test.js`), na mesma pasta (`controllers/`, `services/`, etc.) — segue a estrutura plana já usada no projeto.
- Frontend: mesmo padrão, ao lado do componente (`RankingPage.jsx` → `RankingPage.test.jsx`).

## Regra inegociável: nunca tocar serviço externo real em teste automatizado

- **Nunca** deixe um teste chamar a API do Brevo de verdade, gravar no Azure SQL de produção, ou fazer qualquer chamada de rede real a um serviço de terceiros.
- Mock a camada que fala com o serviço externo (`brevoEmail.service.js`, `models/*.model.js`) usando `vi.mock(...)` do Vitest — teste que a camada de cima (controller/service) chama e trata a resposta certo, não o serviço externo em si.
- Se for necessário validar a integração real com o Brevo ou o Azure SQL, isso é um teste manual pontual (ou um script separado, tipo o já existente `scripts/testConnection.js`), nunca parte da suíte automatizada que roda a cada push.

## O que testar, em ordem de prioridade

1. **Caminho de sucesso** — a rota/função faz o que devia no caso normal.
2. **Validação de entrada** — cada checagem que o controller já faz (campo obrigatório, tipo errado, formato errado) deve ter um teste correspondente rejeitando com o status certo.
3. **Autenticação/autorização** — rota protegida por `authMiddleware` rejeita sem token (401); rota admin rejeita usuário não-admin (403).
4. **Conflitos de negócio** — qualquer `409` documentado (nome duplicado, exclusão bloqueada por vínculo) precisa de um teste que prova o bloqueio.
5. **Erros de dependência externa (mockada)** — serviço externo fora do ar ou recusando (ex: Brevo retornando erro) deve resultar no status certo (ex: 502), nunca vazar stack trace pro cliente.

## Frontend — o que sempre testar num componente com dados de API

- Estado de carregamento renderiza algo (nunca tela em branco silenciosa).
- Estado de erro renderiza a mensagem/ação esperada (ex: botão "Tentar novamente").
- Estado vazio (sem dados) renderiza o texto vazio esperado, não quebra.
- Ação do usuário (clique, digitação, blur) dispara a chamada de API certa, com os argumentos certos (API mockada).
- Feedback visual de sucesso/erro (`flash()`) aparece nos dois casos.

## Checklist de pré-produção (sempre rodar antes de um deploy, mesmo sem teste novo)

- [ ] `.env.example` (backend e frontend) documenta toda variável de ambiente nova, sem valores reais.
- [ ] Nenhum segredo (chave de API, senha, connection string, token) hardcoded ou commitado no código — busque literal por padrões suspeitos (`xkeysib-`, `Bearer `, senhas de banco) antes de aprovar.
- [ ] `npm run build` do frontend conclui sem erro.
- [ ] `npm run lint` do frontend roda limpo (ou os únicos avisos são pré-existentes e já conhecidos).
- [ ] Suíte de testes automatizados passa (`npm test` no backend e no frontend, quando existir).
- [ ] Nenhuma chamada de teste/debug esquecida apontando para serviço real (e-mail de teste indo pro Brevo de produção, log verboso demais, endpoint de debug exposto).

## Antes de escrever testes

1. Leia o `CLAUDE.md` e os arquivos reais da feature testada — nunca assuma nome de rota, campo ou formato de resposta.
2. Confirme se a infraestrutura de teste (Vitest configurado, scripts no `package.json`) já existe; se não, monte o mínimo necessário e documente isso como mudança de infraestrutura, separada da escrita dos testes em si.
3. Escreva os testes na ordem de prioridade listada acima — não pule direto para os casos de borda sem cobrir o caminho de sucesso primeiro.
