import RankingPage from '../modulos/ranking/RankingPage.jsx';
import MargensPage from '../modulos/margens/MargensPage.jsx';
import MarketingPage from '../modulos/marketing/MarketingPage.jsx';
import UsuariosPage from '../modulos/admin/UsuariosPage.jsx';
export const moduleRegistry = [
  {
    id: 'ranking',
    label: 'Ranking',
    path: '/ranking',
    icon: '🏆',
    element: RankingPage,
  },
  {
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
    id: 'marketing',
    label: 'Marketing',
    path: '/marketing',
    icon: '📣',
    element: MarketingPage,
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