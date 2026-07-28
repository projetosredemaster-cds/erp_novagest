import RankingPage from '../modulos/ranking/RankingPage.jsx';
import MargensPage from '../modulos/margens/MargensPage.jsx';
import UsuariosPage from '../modulos/admin/UsuariosPage.jsx';

// Lista central de módulos do ERP. Cada item vira uma rota + um botão no
// sidebar automaticamente. Para adicionar um novo módulo no futuro, basta
// importar o componente da página e acrescentar uma entrada aqui — nada
// mais precisa ser tocado (Sidebar e AppRoutes leem esta lista).
// `adminOnly: true` faz Sidebar.jsx nunca renderizar o link (não é só CSS
// escondido) e AppRoutes.jsx envolver a rota com <RequireAdmin/>.
export const moduleRegistry = [
  {
    id: 'ranking',
    label: 'Ranking',
    path: '/ranking',
    icon: '🏆',
    element: RankingPage,
  },
  {
    // rota real (não mais um estado interno de RankingPage) para a ConfigView — mesmo
    // componente `RankingPage`, que decide internamente qual sub-tela mostrar a partir do
    // pathname atual (ver comentário em RankingPage.jsx). adminOnly:true faz Sidebar.jsx
    // nunca renderizar o link fora do menu "Configurações" e AppRoutes.jsx envolver a
    // rota com <RequireAdmin/> — antes desta mudança, "Diretores e redes" não tinha
    // nenhuma trava real de acesso, só o botão escondido na UI.
    id: 'ranking-configuracoes',
    label: 'Diretores e redes',
    path: '/ranking/configuracoes',
    icon: '🏢',
    element: RankingPage,
    adminOnly: true,
  },
  {
    id: 'margens',
    label: 'Margens',
    path: '/margens',
    icon: '📊',
    element: MargensPage,
  },
  {
    id: 'usuarios',
    label: 'Usuários',
    path: '/admin/usuarios',
    icon: '👤',
    element: UsuariosPage,
    adminOnly: true,
  },
];