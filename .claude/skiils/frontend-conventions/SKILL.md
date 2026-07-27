---
name: frontend-conventions
description: Convenções de código e estilo para componentes React deste projeto. Use sempre que estiver criando, revisando ou editando componentes, telas, formulários ou layouts de frontend — inclusive fora do subagente frontend-developer, em qualquer edição direta de arquivo .jsx/.tsx.
---

# Convenções de Frontend

## Sistema de estilo padrão do projeto: Tailwind CSS

Este projeto usa **Tailwind CSS como padrão para todo o frontend**, incluindo telas com visual replicado de protótipos existentes (nesses casos, reproduza o visual usando classes Tailwind — inclusive valores arbitrários referenciando variáveis CSS quando necessário — em vez de criar um arquivo `.css` customizado à parte).

**Material UI é reservado para casos específicos** onde o componente pronto agrega valor real e seria caro recriar (ex: `DataGrid`, `DatePicker`, `Autocomplete`, `Dialog` complexo). Fora desses casos, prefira Tailwind.

## Regra crítica: nunca misturar Material UI e Tailwind CSS no mesmo componente

- Mesmo com Tailwind como padrão, se um componente específico usar MUI (por ser um dos casos acima), esse componente deve ser 100% MUI por dentro — nunca aplique classes Tailwind diretamente em elementos MUI (`<Box>`, `<Button>`, `<Paper>`, `<Grid>`, etc.), nem misture a prop `sx` com `className` no mesmo elemento.
- Cada arquivo tem um único dono de estilo: **ou** é MUI (via `sx`/`styled()`/tema), **ou** é Tailwind — nunca os dois na mesma árvore imediata de componente.
- Declare a decisão em comentário no topo do arquivo: `// style-system: MUI` ou `// style-system: Tailwind`.
- Um componente MUI pode existir **dentro** de uma página majoritariamente Tailwind — a regra é sobre não misturar os dois sistemas de estilo *no mesmo elemento/componente*, não sobre proibir MUI no projeto.

## Stack recomendada (tecnologias de referência)

Ao iniciar algo novo ou sugerir uma dependência, prefira este conjunto — são as opções mais maduras e bem mantidas da categoria hoje:

- **Build tool**: Vite (dev server rápido, HMR, build otimizado) em vez de Create React App (descontinuado).
- **Estilo**: Tailwind CSS v4 (configuração via `@theme` no CSS, plugin `@tailwindcss/vite` — não usa mais `tailwind.config.js`/`init -p`).
- **Roteamento**: React Router.
- **Estado de servidor/cache de API**: TanStack Query (React Query) para dados vindos de API — evita reinventar loading/erro/cache manualmente.
- **Estado global de cliente** (quando Context não for suficiente): Zustand (simples) ou Redux Toolkit (projetos grandes/times maiores).
- **Formulários**: React Hook Form + Zod para validação de schema.
- **Ícones**: lucide-react (leve, tree-shakeable) como padrão, salvo se o projeto já usar outro.
- **Testes**: Vitest + React Testing Library para componentes; Playwright para E2E.
- **Lint/format**: ESLint + Prettier configurados no projeto — siga a config existente em vez de introduzir regras próprias.

Antes de adotar qualquer biblioteca nova, verifique se o projeto já resolve aquilo com algo já instalado — não adicione dependência redundante.

## Estrutura e organização

- Componentes funcionais com Hooks — sem class components.
- Um componente, uma responsabilidade. Extraia subcomponentes quando um arquivo passar de ~150–200 linhas ou um bloco JSX se repetir.
- Nomeie por função, não por implementação (`UserAvatarMenu`, não `Div1`).
- Separe UI de lógica de negócio: componentes visuais recebem dados/callbacks via props; busca de dados fica em hooks (`useX`) ou camada de serviço.

## Qualidade obrigatória

- Trate estados de carregamento, erro e vazio explicitamente — nunca deixe uma tela quebrar silenciosamente por falta de dado.
- Acessibilidade: labels em inputs, `aria-*` quando fizer sentido, foco visível, contraste adequado.
- Responsividade via breakpoints do sistema de design em uso (MUI `theme.breakpoints` ou Tailwind `sm:`/`md:`/`lg:`) — nunca media queries manuais soltas.
- Nunca use `localStorage`/`sessionStorage` em ambientes de preview/artifact — use estado em memória ou a API definida pelo projeto.

## Antes de codar

1. Leia os arquivos existentes do módulo/projeto para manter consistência de nomes, tema e estrutura.
2. Decida e declare o sistema de estilo (MUI ou Tailwind) antes de escrever qualquer JSX, a menos que o prompt já defina outra coisa (ex: réplica de visual existente).
