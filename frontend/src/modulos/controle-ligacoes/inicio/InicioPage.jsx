// style-system: Tailwind
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchDashboard, fetchAguardandoAcao } from './dashboardApi.js';
import { fetchEstados } from '../configuracoes/controleLigacoesConfigApi.js';
import DateRangeFilter from '../components/DateRangeFilter.jsx';
import { MOTIVOS_PERDIDO } from '../components/ModalMotivoPerdido.jsx';

const btn = "bg-[var(--pd-accent)] text-white border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const selectCls = "w-full sm:w-[240px] rounded-lg border border-[var(--pd-border)] bg-[var(--pd-surface-alt)] px-2.5 py-2.5 sm:py-2 text-sm text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]";
const card = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)]/60 rounded-2xl px-4 pt-5 pb-[22px] sm:px-5 flex flex-col";
const cardCompacto = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)]/60 rounded-xl px-3 py-3 flex flex-col gap-1";

const STATUS_LABELS = {
  atendeu: 'Atendeu',
  agendou: 'Agendou',
  nao_atendeu: 'Não atendeu',
  venda: 'Venda',
  perdido: 'Perdido',
};

const STATUS_HEX = {
  atendeu: '#4fd1c5',
  agendou: '#a78bfa',
  nao_atendeu: '#e3b341',
  venda: '#34d399',
  perdido: '#e0645a',
};

const STATUS_INVERTIDO = new Set(['nao_atendeu', 'perdido']);

const MOTIVO_PERDIDO_LABELS = Object.fromEntries(MOTIVOS_PERDIDO.map((m) => [m.value, m.label]));

function corComparativo(status, diff) {
  if (diff === 0) return 'var(--pd-text-secondary)';
  const subiuEBom = diff > 0 && !STATUS_INVERTIDO.has(status);
  const desceuEBom = diff < 0 && STATUS_INVERTIDO.has(status);
  return (subiuEBom || desceuEBom) ? 'var(--pd-success)' : 'var(--pd-warning)';
}

function formatComparativo(diff) {
  const arredondado = Math.round(diff * 10) / 10;
  const seta = arredondado > 0 ? '↑' : arredondado < 0 ? '↓' : '—';
  const valorAbsoluto = Math.abs(arredondado).toFixed(1);
  return `${seta} ${valorAbsoluto}pp`;
}

function formatDiaCurto(dia) {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

function formatRatio(numerador, denominador) {
  if (!denominador) return '-';
  return `${((numerador / denominador) * 100).toFixed(1)}%`;
}

function formatHorasMedias(horas) {
  if (horas === null || horas === undefined) return null;
  if (horas >= 24) {
    const dias = Math.floor(horas / 24);
    const resto = (horas % 24).toFixed(1);
    return `${dias}d ${resto}h`;
  }
  return `${horas.toFixed(1)}h`;
}

const AGUARDANDO_ACAO_LABELS = {
  sem_resposta: (tempoRelativo) => `Sem resposta há ${tempoRelativo}`,
  agendado_parado: (tempoRelativo) => `Agendado há ${tempoRelativo} sem fechar`,
};

function formatRelativoNotificacao(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const diffMs = Date.now() - data.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

function InfoTooltip({ texto }) {
  return (
    <span title={texto} aria-label={texto} className="inline-flex shrink-0 cursor-help text-[var(--pd-text-secondary)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </span>
  );
}

export default function InicioPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [estados, setEstados] = useState([]);
  const [estadoSelecionado, setEstadoSelecionado] = useState('');
  const [dataInicio, setDataInicio] = useState(null);
  const [dataFim, setDataFim] = useState(null);

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [aguardandoAcao, setAguardandoAcao] = useState(null);
  const [loadingAguardandoAcao, setLoadingAguardandoAcao] = useState(true);
  const [erroAguardandoAcao, setErroAguardandoAcao] = useState(null);

  useEffect(() => {
    fetchEstados(token)
      .then((lista) => setEstados(lista || []))
      .catch(() => setEstados([]));
  }, [token]);

  useEffect(() => {
    fetchAguardandoAcao(token)
      .then((lista) => {
        setAguardandoAcao(lista || []);
        setErroAguardandoAcao(null);
      })
      .catch((err) => setErroAguardandoAcao(err.message || 'Erro ao carregar pendências.'))
      .finally(() => setLoadingAguardandoAcao(false));
  }, [token]);

  function irParaConversa(item) {
    navigate('/controle-ligacoes/conversas', {
      state: {
        contatoId: item.contatoId,
        numeroRemetenteId: item.numeroRemetenteId,
        nome: item.nome,
        telefone: item.telefone,
      },
    });
  }

  const carregarDashboard = useCallback(() => {
    fetchDashboard(token, { estadoId: estadoSelecionado || null, dataInicio, dataFim })
      .then((resultado) => {
        setDashboard(resultado || null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar dashboard.'))
      .finally(() => setLoading(false));
  }, [token, estadoSelecionado, dataInicio, dataFim]);

  useEffect(() => {
    carregarDashboard();
  }, [carregarDashboard]);

  function handleEstadoChange(valor) {
    setLoading(true);
    setLoadError(null);
    setEstadoSelecionado(valor);
  }

  function aplicarPeriodo(inicio, fim) {
    setLoading(true);
    setLoadError(null);
    setDataInicio(inicio);
    setDataFim(fim);
  }

  function limparFiltros() {
    setLoading(true);
    setLoadError(null);
    setEstadoSelecionado('');
    setDataInicio(null);
    setDataFim(null);
    fetchDashboard(token, { estadoId: null, dataInicio: null, dataFim: null })
      .then((resultado) => {
        setDashboard(resultado || null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar dashboard.'))
      .finally(() => setLoading(false));
  }

  function retryDashboard() {
    setLoading(true);
    setLoadError(null);
    carregarDashboard();
  }

  const disparosPorRegiao = dashboard?.disparosPorRegiao || [];
  const statusGeral = (dashboard?.statusGeral || []).map((s) => ({
    ...s,
    label: STATUS_LABELS[s.status] ?? s.status,
  }));
  const rankingAtendentes = dashboard?.rankingAtendentes || [];

  const valoresAbsolutos = Object.keys(STATUS_LABELS).map((status) => ({
    status,
    total: statusGeral.find((s) => s.status === status)?.total ?? 0,
  }));

  const tendenciaDiaria = dashboard?.tendenciaDiaria || [];
  const comparativoAtual = dashboard?.comparativoSemanal?.atual || {};
  const comparativoAnterior = dashboard?.comparativoSemanal?.anterior || {};

  const contagem = (status) => statusGeral.find((s) => s.status === status)?.total ?? 0;
  const atendeuCount = contagem('atendeu');
  const agendouCount = contagem('agendou');
  const naoAtendeuCount = contagem('nao_atendeu');
  const vendaCount = contagem('venda');
  const perdidoCount = contagem('perdido');
  const totalDisparos = dashboard?.totalDisparos ?? 0;
  const baseEngajados = atendeuCount + agendouCount + vendaCount + perdidoCount;

  const kpis = [
    {
      key: 'atendimento',
      label: 'Taxa de Atendimento',
      valor: formatRatio(atendeuCount, totalDisparos),
      contagemAbsoluta: atendeuCount,
      cor: STATUS_HEX.atendeu,
      comparativo: true,
      info: '% de disparos cujo cliente respondeu pelo menos uma vez.',
    },
    {
      key: 'agendamento',
      label: 'Taxa de Agendamento',
      valor: formatRatio(agendouCount + vendaCount, baseEngajados),
      contagemAbsoluta: agendouCount + vendaCount,
      cor: STATUS_HEX.agendou,
      comparativo: false,
      info: '% de quem respondeu que chegou a agendar uma visita.',
    },
    {
      key: 'conversao-agendados',
      label: 'Conversão dos Agendados',
      valor: formatRatio(vendaCount, agendouCount),
      contagemAbsoluta: vendaCount,
      cor: STATUS_HEX.venda,
      comparativo: false,
      info: '% de quem agendou que efetivamente comprou.',
    },
    {
      key: 'conversao-engajados',
      label: 'Conversão dos Engajados',
      valor: formatRatio(vendaCount, baseEngajados),
      contagemAbsoluta: vendaCount,
      cor: STATUS_HEX.venda,
      comparativo: false,
      info: '% de quem respondeu que comprou, considerando toda a base de quem teve retorno.',
    },
    {
      key: 'perda',
      label: 'Taxa de Perda',
      valor: formatRatio(perdidoCount, baseEngajados),
      contagemAbsoluta: perdidoCount,
      cor: STATUS_HEX.perdido,
      comparativo: false,
      info: '% de quem respondeu e não converteu em venda.',
    },
  ];

  const diffAtendeuBruto = (comparativoAtual.atendeu ?? 0) - (comparativoAnterior.atendeu ?? 0);
  const diffAtendeu = Math.round(diffAtendeuBruto * 10) / 10;

  const funilEtapas = [
    { name: 'Disparados', value: totalDisparos, fill: 'var(--pd-accent)' },
    { name: 'Atendeu', value: atendeuCount + agendouCount + vendaCount + perdidoCount, fill: STATUS_HEX.atendeu },
    { name: 'Agendou', value: agendouCount + vendaCount, fill: STATUS_HEX.agendou },
    { name: 'Venda', value: vendaCount, fill: STATUS_HEX.venda },
  ];

  const dadosSaida = [
    { status: 'nao_atendeu', label: STATUS_LABELS.nao_atendeu, value: naoAtendeuCount },
    { status: 'perdido', label: STATUS_LABELS.perdido, value: perdidoCount },
  ];

  const tempoMedioPorEtapa = dashboard?.tempoMedioPorEtapa || [];
  const tempoMedioConversao = dashboard?.tempoMedioConversao ?? { horasMedias: null };
  const velocidadeRespostaAtendente = dashboard?.velocidadeRespostaAtendente || [];
  const taxaRecuo = dashboard?.taxaRecuo ?? { taxaPct: null };
  const caminhosComuns = dashboard?.caminhosComuns || [];
  const statusPuladosTotal = dashboard?.statusPulados?.total ?? 0;
  const origemPorDia = dashboard?.origemPorDia || [];
  const motivosPerdido = (dashboard?.motivosPerdido || []).map((m) => ({
    ...m,
    label: MOTIVO_PERDIDO_LABELS[m.motivo] ?? m.motivo,
  }));

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-[22px] flex flex-col gap-3 border-b border-[var(--pd-border)]/60 pb-[18px] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de Ligações</div>
            <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Início</h1>
            <h3 className="pd-font-serif mt-0.5 text-[18px] font-extrabold leading-tight sm:text-[18px] sm:leading-none">Visão Geral</h3>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
            <div className="w-full sm:w-auto">
              <label htmlFor="dashboard-estado" className="mb-1 block text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">
                Filtrar por estado
              </label>
              <select
                id="dashboard-estado"
                className={selectCls}
                aria-label="Filtrar dashboard por estado"
                value={estadoSelecionado}
                onChange={(e) => handleEstadoChange(e.target.value)}
              >
                <option value="">Geral</option>
                {estados.map((estado) => (
                  <option key={estado.id} value={estado.id}>
                    {estado.nome} ({estado.uf})
                  </option>
                ))}
              </select>
            </div>

            <DateRangeFilter dataInicio={dataInicio} dataFim={dataFim} onAplicar={aplicarPeriodo} />

            <button type="button" onClick={limparFiltros} className={btnGhost}>
              Limpar
            </button>
          </div>
        </div>

        <div className={`${card} mb-4`}>
          <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
            Aguardando Ação
            <InfoTooltip texto="Conversas que precisam de atenção agora: sem resposta há mais de 24h, ou agendadas há mais de 3 dias sem fechar." />
          </h2>
          {loadingAguardandoAcao ? (
            <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Carregando...</div>
          ) : erroAguardandoAcao ? (
            <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-danger)]">
              Não foi possível carregar as pendências: {erroAguardandoAcao}
            </div>
          ) : !aguardandoAcao || aguardandoAcao.length === 0 ? (
            <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhuma pendência no momento.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[var(--pd-card-bg)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Nome</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Telefone</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Atendente</th>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--pd-border)]">
                    {aguardandoAcao.map((item, index) => {
                      const tempoRelativo = formatRelativoNotificacao(item.referencia);
                      const situacao = AGUARDANDO_ACAO_LABELS[item.tipo]?.(tempoRelativo) ?? item.tipo;
                      const intensidade = Math.max(0, 1 - index / aguardandoAcao.length);
                      const corFundo = `rgba(224, 100, 90, ${intensidade * 0.15})`;
                      return (
                        <tr
                          key={`${item.contatoId}-${item.tipo}`}
                          onClick={() => irParaConversa(item)}
                          style={{ backgroundColor: corFundo }}
                          className="cursor-pointer hover:brightness-95"
                        >
                          <td className="px-3 py-2 font-semibold text-[var(--pd-text-primary)]">{item.nome}</td>
                          <td className="px-3 py-2 text-[var(--pd-text-primary)]">{item.telefone}</td>
                          <td className="px-3 py-2 text-[var(--pd-text-primary)]">{item.apelido || '—'}</td>
                          <td className="px-3 py-2 text-[var(--pd-text-secondary)]">{situacao}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
        ) : loadError ? (
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-5 py-4 text-sm text-[var(--pd-danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="break-words">Não foi possível carregar o dashboard: {loadError}</span>
            <button className={`${btn} w-full sm:w-auto`} onClick={retryDashboard}>Tentar novamente</button>
          </div>
        ) : !dashboard ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Nenhum dado ainda.</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              <div className={cardCompacto} style={{ borderLeftColor: 'var(--pd-border)', borderLeftWidth: 4 }}>
                <span className="flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                  Total de Disparos
                  <InfoTooltip texto="Quantidade de contatos que receberam a mensagem inicial." />
                </span>
                <span className="pd-font-serif mt-1 text-[26px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                  {totalDisparos}
                </span>
              </div>
              {kpis.map((kpi) => (
                <div
                  key={kpi.key}
                  className={cardCompacto}
                  style={{ borderLeftColor: kpi.cor, borderLeftWidth: 4 }}
                >
                  <span className="flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                    {kpi.label}
                    <InfoTooltip texto={kpi.info} />
                  </span>
                  <span
                    className="pd-font-serif mt-1 text-[26px] font-extrabold leading-none"
                    style={{ color: kpi.cor }}
                  >
                    {kpi.contagemAbsoluta} <span className="text-xs text-[var(--pd-text-secondary)]">({kpi.valor} )</span>
                  </span>
                  {kpi.comparativo && (
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: corComparativo('atendeu', diffAtendeu) }}
                    >
                      {formatComparativo(diffAtendeu)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Valores Absolutos</h2>
                <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
                  <table className="w-full min-w-[280px] border-collapse text-[13px]">
                    <thead className="bg-[var(--pd-surface-alt)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Status</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Quantidade</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--pd-border)]">
                      {valoresAbsolutos.map((item) => (
                        <tr key={item.status}>
                          <td className="px-3 py-2 text-[var(--pd-text-primary)]">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ background: STATUS_HEX[item.status] }}
                              />
                              {STATUS_LABELS[item.status]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-[var(--pd-text-primary)]">{item.total}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-secondary)]">{formatRatio(item.total, totalDisparos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={card}>
                <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                  Status Geral
                  <InfoTooltip texto="Quantidade de conversas em cada status atual." />
                </h2>
                {statusGeral.length === 0 ? (
                  <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum status registrado.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={statusGeral}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                        {statusGeral.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_HEX[entry.status] ?? 'var(--pd-accent)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className={card}>
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Tendência Diária (últimos 30 dias)
                <InfoTooltip texto="Quantidade de disparos feitos por dia, últimos 30 dias." />
              </h2>
              {tendenciaDiaria.length === 0 ? (
                <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum disparo registrado.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={tendenciaDiaria}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                    <XAxis
                      dataKey="dia"
                      tickFormatter={formatDiaCurto}
                      tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }}
                    />
                    <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(dia) => formatDiaCurto(dia)}
                    />
                    <Line type="monotone" dataKey="total" stroke="var(--pd-accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                  Disparos por Região (gráfico)
                  <InfoTooltip texto="Quantidade de disparos feitos, agrupados por Estado." />
                </h2>
                {disparosPorRegiao.length === 0 ? (
                  <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum disparo registrado.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={disparosPorRegiao}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                      <XAxis dataKey="uf" tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(uf) => disparosPorRegiao.find((r) => r.uf === uf)?.nome ?? uf}
                      />
                      <Bar dataKey="total" fill="var(--pd-accent)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={card}>
                <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                  Disparos por Região (tabela)
                  <InfoTooltip texto="Quantidade de disparos feitos, agrupados por Estado." />
                </h2>
                {disparosPorRegiao.length === 0 ? (
                  <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto rounded-lg border border-[var(--pd-border)]">
                    <table className="w-full border-collapse text-[13px]">
                      <thead className="sticky top-0 bg-[var(--pd-surface-alt)]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Estado</th>
                          <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--pd-border)]">
                        {disparosPorRegiao.map((regiao) => (
                          <tr key={regiao.estadoId}>
                            <td className="px-3 py-2 text-[var(--pd-text-primary)]">{regiao.nome}</td>
                            <td className="px-3 py-2 text-right font-semibold text-[var(--pd-text-primary)]">{regiao.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                  Etapas do Funil
                  <InfoTooltip texto="Cada barra soma quem está naquela etapa ou já avançou além dela, não implica que passou por todas em ordem." />
                </h2>
                {totalDisparos === 0 ? (
                  <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum disparo registrado.</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <FunnelChart>
                        <Tooltip
                          contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                        />
                        <Funnel dataKey="value" data={funilEtapas} isAnimationActive={false}>
                          <LabelList position="right" fill="var(--pd-text-primary)" stroke="none" dataKey="name" fontSize={12} />
                        </Funnel>
                      </FunnelChart>
                    </ResponsiveContainer>
                    <span className="mt-2 block text-[11px] text-[var(--pd-text-secondary)]">
                      Cada etapa soma quem está nela ou já avançou, não significa que passou necessariamente por todas.
                    </span>
                  </>
                )}
              </div>

              <div className={card}>
                <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                  Motivos de Saída
                  <InfoTooltip texto="Distribuição entre quem não teve interesse e quem foi à loja mas não comprou." />
                </h2>
                {naoAtendeuCount === 0 && perdidoCount === 0 ? (
                  <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Tooltip
                        contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Pie data={dadosSaida} dataKey="value" nameKey="label" innerRadius={60} outerRadius={100} paddingAngle={2}>
                        {dadosSaida.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_HEX[entry.status]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className={card}>
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Motivos de Perda
                <InfoTooltip texto="Distribuição dos motivos registrados ao marcar uma conversa como Perdido." />
              </h2>
              {motivosPerdido.length === 0 ? (
                <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={motivosPerdido}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--pd-text-secondary)', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="total" fill={STATUS_HEX.perdido} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className={card}>
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Ranking de Atendentes
                <InfoTooltip texto="Quantidade de cada status por atendente/número usado." />
              </h2>
              {rankingAtendentes.length === 0 ? (
                <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum atendimento registrado.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
                  <table className="w-full min-w-[560px] border-collapse text-[13px]">
                    <thead className="bg-[var(--pd-surface-alt)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Colaboradora</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Atendeu</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Agendou</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Não atendeu</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Venda</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Perdido</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--pd-border)]">
                      {rankingAtendentes.map((atendente) => (
                        <tr key={atendente.numeroRemetenteId}>
                          <td className="px-3 py-2 font-semibold text-[var(--pd-text-primary)]">{atendente.apelido}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{atendente.atendeu}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{atendente.agendou}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{atendente.nao_atendeu}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{atendente.venda}</td>
                          <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{atendente.perdido}</td>
                          <td className="px-3 py-2 text-right font-bold text-[var(--pd-text-primary)]">{atendente.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-[var(--pd-card-bg)] rounded-xl p-4 border border-[var(--pd-border)]/60">
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Tempo por Etapa
                <InfoTooltip texto="Tempo médio que uma thread fica em cada status antes de mudar para o próximo." />
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  {tempoMedioPorEtapa.length === 0 ? (
                    <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={tempoMedioPorEtapa}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                        <XAxis
                          dataKey="status"
                          tickFormatter={(status) => STATUS_LABELS[status] ?? status}
                          tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }}
                        />
                        <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                          labelFormatter={(status) => STATUS_LABELS[status] ?? status}
                          formatter={(value) => [formatHorasMedias(value), 'Tempo médio']}
                        />
                        <Bar dataKey="horasMedias" radius={[4, 4, 0, 0]}>
                          {tempoMedioPorEtapa.map((entry) => (
                            <Cell key={entry.status} fill={STATUS_HEX[entry.status] ?? 'var(--pd-accent)'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className={cardCompacto}>
                    <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                      Tempo médio até a venda
                    </span>
                    <span className="pd-font-serif mt-1 text-[22px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                      {formatHorasMedias(tempoMedioConversao.horasMedias) ?? 'Sem conversões ainda'}
                    </span>
                  </div>

                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold text-[var(--pd-text-secondary)]">Velocidade de Resposta por Atendente</h3>
                    {velocidadeRespostaAtendente.length === 0 ? (
                      <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum atendimento registrado.</div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
                        <table className="w-full min-w-[280px] border-collapse text-[13px]">
                          <thead className="bg-[var(--pd-surface-alt)]">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Colaboradora</th>
                              <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Tempo médio</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--pd-border)]">
                            {velocidadeRespostaAtendente.map((atendente) => (
                              <tr key={atendente.apelido}>
                                <td className="px-3 py-2 font-semibold text-[var(--pd-text-primary)]">{atendente.apelido}</td>
                                <td className="px-3 py-2 text-right text-[var(--pd-text-primary)]">{formatHorasMedias(atendente.horasMedias)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[var(--pd-card-bg)] rounded-xl p-4 border border-[var(--pd-border)]/60">
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Padrões de Comportamento
                <InfoTooltip texto="Indicadores de threads que avançaram no funil mas não converteram." />
              </h2>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={cardCompacto}>
                  <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                    Taxa de Recuo
                  </span>
                  <span className="pd-font-serif mt-1 text-[22px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                    {taxaRecuo.taxaPct === null ? '—' : `${taxaRecuo.taxaPct}%`}
                  </span>
                </div>
                <div className={cardCompacto}>
                  <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                    Vendas sem Agendamento
                  </span>
                  <span className="pd-font-serif mt-1 text-[22px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                    {statusPuladosTotal}
                  </span>
                </div>
              </div>

              <h3 className="mb-2 text-[13px] font-semibold text-[var(--pd-text-secondary)]">Caminhos Mais Comuns</h3>
              {caminhosComuns.length === 0 ? (
                <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
                  <table className="w-full min-w-[280px] border-collapse text-[13px]">
                    <thead className="bg-[var(--pd-surface-alt)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Caminho</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Quantidade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--pd-border)]">
                      {caminhosComuns.map((item) => (
                        <tr key={item.caminho}>
                          <td className="px-3 py-2 text-[var(--pd-text-primary)]">{item.caminho}</td>
                          <td className="px-3 py-2 text-right font-semibold text-[var(--pd-text-primary)]">{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-[var(--pd-card-bg)] rounded-xl p-4 border border-[var(--pd-border)]/60">
              <h2 className="pd-font-serif mb-3 flex items-center gap-1 text-[16px] font-bold leading-tight">
                Atividade por Origem
                <InfoTooltip texto="Quantidade de mudanças de status feitas pelo sistema (automático) vs. manualmente pelo atendente, por dia, últimos 30 dias." />
              </h2>
              {origemPorDia.length === 0 ? (
                <div className="px-1 py-8 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={origemPorDia}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pd-border)" />
                    <XAxis
                      dataKey="dia"
                      tickFormatter={formatDiaCurto}
                      tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }}
                    />
                    <YAxis allowDecimals={false} tick={{ fill: 'var(--pd-text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--pd-card-bg)', border: '1px solid var(--pd-border)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(dia) => formatDiaCurto(dia)}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="sistema" name="Sistema" stroke="var(--pd-accent)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="atendente" name="Atendente" stroke="var(--pd-warning)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
