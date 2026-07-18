import RankingPage from '../modulos/ranking/RankingPage.jsx';
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
    id: 'usuarios',
    label: 'Usuários',
    path: '/admin/usuarios',
    icon: '👤',
    element: UsuariosPage,
    adminOnly: true,
  },
];