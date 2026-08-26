// style-system: Tailwind
import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchDashboard } from './dashboardApi.js';
import { fetchEstados } from '../configuracoes/controleLigacoesConfigApi.js';

const btn = "bg-[var(--pd-accent)] text-white border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
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

// Mesmos hex literais usados em ConversasPage.jsx (tema escuro) — identidade de cor
// por status mantida em toda a aplicação, independente do tema claro/escuro da tela.
const STATUS_HEX = {
  atendeu: '#4fd1c5',
  agendou: '#a78bfa',
  nao_atendeu: '#e3b341',
  venda: '#34d399',
  perdido: '#e0645a',
};

const STATUS_INVERTIDO = new Set(['nao_atendeu', 'perdido']);

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

export default function InicioPage() {
  const { token } = useAuth();

  const [estados, setEstados] = useState([]);
  const [estadoSelecionado, setEstadoSelecionado] = useState('');

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    fetchEstados(token)
      .then((lista) => setEstados(lista || []))
      .catch(() => setEstados([]));
  }, [token]);

  const carregarDashboard = useCallback(() => {
    fetchDashboard(token, estadoSelecionado || null)
      .then((resultado) => {
        setDashboard(resultado || null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar dashboard.'))
      .finally(() => setLoading(false));
  }, [token, estadoSelecionado]);

  useEffect(() => {
    carregarDashboard();
  }, [carregarDashboard]);

  function handleEstadoChange(valor) {
    setLoading(true);
    setLoadError(null);
    setEstadoSelecionado(valor);
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
  const taxaConversaoEngajados = dashboard?.funilConversao?.taxaConversaoEngajados ?? 0;
  const comparativoAtual = dashboard?.comparativoSemanal?.atual || {};
  const comparativoAnterior = dashboard?.comparativoSemanal?.anterior || {};

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-[22px] flex flex-col gap-3 border-b border-[var(--pd-border)]/60 pb-[18px] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de Ligações</div>
            <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Início</h1>
          </div>
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className={cardCompacto} style={{ borderLeftColor: 'var(--pd-border)', borderLeftWidth: 4 }}>
                <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                  Total de Disparos
                </span>
                <span className="pd-font-serif mt-1 text-[26px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                  {dashboard.totalDisparos ?? 0}
                </span>
              </div>
              {Object.keys(STATUS_LABELS).map((status) => {
                const diffBruto = (comparativoAtual[status] ?? 0) - (comparativoAnterior[status] ?? 0);
                const diff = Math.round(diffBruto * 10) / 10;
                return (
                  <div
                    key={status}
                    className={cardCompacto}
                    style={{ borderLeftColor: STATUS_HEX[status], borderLeftWidth: 4 }}
                  >
                    <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                      {STATUS_LABELS[status]}
                    </span>
                    <span
                      className="pd-font-serif mt-1 text-[26px] font-extrabold leading-none"
                      style={{ color: STATUS_HEX[status] }}
                    >
                      {(dashboard.taxas?.[status] ?? 0)}%
                    </span>
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: corComparativo(status, diff) }}
                    >
                      {formatComparativo(diff)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={card}>
              <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Valores Absolutos</h2>
              <div className="overflow-x-auto rounded-lg border border-[var(--pd-border)]">
                <table className="w-full min-w-[280px] border-collapse text-[13px]">
                  <thead className="bg-[var(--pd-surface-alt)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Status</th>
                      <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Quantidade</th>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className={`${card} lg:col-span-1`}>
                <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Funil de Conversão</h2>
                <span className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                  Taxa de Conversão (engajados)
                </span>
                <span className="pd-font-serif mt-2 text-[36px] font-extrabold leading-none text-[var(--pd-text-primary)]">
                  {taxaConversaoEngajados}%
                </span>
                <span className="mt-3 text-[11px] text-[var(--pd-text-secondary)]">
                  Venda ÷ (Atendeu + Agendou + Venda + Perdido) — exclui quem nunca respondeu
                </span>
              </div>

              <div className={`${card} lg:col-span-2`}>
                <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Tendência Diária (últimos 30 dias)</h2>
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
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Disparos por Região (gráfico)</h2>
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
                <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Status Geral</h2>
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
              <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Disparos por Região (tabela)</h2>
              {disparosPorRegiao.length === 0 ? (
                <div className="px-1 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Nenhum registro.</div>
              ) : (
                <div className="max-h-[320px] overflow-y-auto rounded-lg border border-[var(--pd-border)]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="sticky top-0 bg-[var(--pd-surface-alt)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Estado</th>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">UF</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--pd-text-secondary)]">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--pd-border)]">
                      {disparosPorRegiao.map((regiao) => (
                        <tr key={regiao.estadoId}>
                          <td className="px-3 py-2 text-[var(--pd-text-primary)]">{regiao.nome}</td>
                          <td className="px-3 py-2 text-[var(--pd-text-secondary)]">{regiao.uf}</td>
                          <td className="px-3 py-2 text-right font-semibold text-[var(--pd-text-primary)]">{regiao.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={card}>
              <h2 className="pd-font-serif mb-3 text-[16px] font-bold leading-tight">Ranking de Atendentes</h2>
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
          </div>
        )}
      </div>
    </div>
  );
}
