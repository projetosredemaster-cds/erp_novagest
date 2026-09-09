// style-system: Tailwind
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../app/useAuth.js';
import { fetchFalhasEnvio, reenviarDisparoContato, ignorarDisparoContato } from './falhasEnvioApi.js';

const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const btn = "bg-[var(--pd-accent)] text-[#0b1010] border-none rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const card = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5";

function formatDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FalhasEnvioPage() {
  const { token } = useAuth();
  // `zerarFalhasNaoVistas` é opcional: só existe quando esta página é renderizada
  // dentro de ControleLigacoesShell (sempre o caso em produção, via rota), mas o
  // optional chaining evita quebrar caso o contexto não esteja disponível.
  const { zerarFalhasNaoVistas } = useOutletContext() ?? {};

  const [falhas, setFalhas] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reenviandoId, setReenviandoId] = useState(null);
  const [erroReenvioPorId, setErroReenvioPorId] = useState({});
  const [ignorandoId, setIgnorandoId] = useState(null);
  const [erroIgnorarPorId, setErroIgnorarPorId] = useState({});

  useEffect(() => {
    zerarFalhasNaoVistas?.();
  }, [zerarFalhasNaoVistas]);

  function carregarFalhas() {
    fetchFalhasEnvio(token)
      .then((lista) => {
        setFalhas(lista || []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar as falhas de envio.'));
  }

  useEffect(() => {
    carregarFalhas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function retry() {
    setFalhas(null);
    setLoadError(null);
    carregarFalhas();
  }

  function handleReenviar(disparoContatoId) {
    setReenviandoId(disparoContatoId);
    setErroReenvioPorId((atual) => {
      if (!(disparoContatoId in atual)) return atual;
      const copia = { ...atual };
      delete copia[disparoContatoId];
      return copia;
    });

    reenviarDisparoContato(token, disparoContatoId)
      .then((resultado) => {
        if (resultado?.status === 'enviado') {
          setFalhas((atual) => (atual || []).filter((f) => f.disparoContatoId !== disparoContatoId));
          return;
        }
        // status === 'falha': o reenvio rodou de verdade, mas falhou de novo — atualiza a
        // linha com o novo erro em vez de tratar como exceção de requisição.
        setFalhas((atual) =>
          (atual || []).map((f) =>
            f.disparoContatoId === disparoContatoId ? { ...f, erro: resultado?.erro || f.erro } : f
          )
        );
      })
      .catch((err) => {
        setErroReenvioPorId((atual) => ({
          ...atual,
          [disparoContatoId]: err.message || 'Erro ao reenviar.',
        }));
      })
      .finally(() => {
        setReenviandoId(null);
      });
  }

  function handleIgnorar(disparoContatoId) {
    setIgnorandoId(disparoContatoId);
    setErroIgnorarPorId((atual) => {
      if (!(disparoContatoId in atual)) return atual;
      const copia = { ...atual };
      delete copia[disparoContatoId];
      return copia;
    });

    ignorarDisparoContato(token, disparoContatoId)
      .then(() => {
        setFalhas((atual) => (atual || []).filter((f) => f.disparoContatoId !== disparoContatoId));
      })
      .catch((err) => {
        setErroIgnorarPorId((atual) => ({
          ...atual,
          [disparoContatoId]: err.message || 'Erro ao ignorar.',
        }));
      })
      .finally(() => {
        setIgnorandoId(null);
      });
  }

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-[22px] border-b border-[var(--pd-border)]/60 pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de Ligações</div>
          <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Falhas de Envio</h1>
        </div>

        <div className={card}>
          {falhas === null && !loadError ? (
            <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
          ) : loadError ? (
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-5 py-4 text-sm text-[var(--pd-danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <span className="break-words">Não foi possível carregar as falhas de envio: {loadError}</span>
              <button type="button" onClick={retry} className={`${btn} w-full sm:w-auto`}>
                Tentar novamente
              </button>
            </div>
          ) : falhas.length === 0 ? (
            <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">
              Nenhuma falha de envio no momento.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-x-auto overflow-y-auto rounded-lg border border-[var(--pd-border)]">
              {/* max-h-[420px] ~ 8-9 linhas visíveis (linha ~46-48px com py-2/text-[13px] + cabeçalho).
                  overflow-x-auto e overflow-y-auto convivem no MESMO container de propósito: o sticky
                  do <thead> é relativo a esse container, que já é o único com scroll (nunca precisou de
                  dois containers aninhados aqui, diferente do caso do tooltip em ControleLigacoesShell,
                  porque ali o objetivo era manter overflow-x visível/sem scroll — aqui scroll horizontal
                  é desejado, então não há conflito de spec do CSS a contornar). */}
              <table className="w-full min-w-[820px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-[var(--pd-surface-alt)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Nome</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Telefone</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Estado</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Remetente</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Erro</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]">Disparo criado em</th>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--pd-text-secondary)]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--pd-border)]">
                  {falhas.map((item) => {
                    const emProgresso =
                      reenviandoId === item.disparoContatoId || ignorandoId === item.disparoContatoId;
                    return (
                      <tr key={item.disparoContatoId}>
                        <td className="px-3 py-2 font-semibold text-[var(--pd-text-primary)]">{item.nome}</td>
                        <td className="px-3 py-2 text-[var(--pd-text-primary)]">{item.telefone}</td>
                        <td className="px-3 py-2 text-[var(--pd-text-primary)]">
                          {item.estado ? `${item.estado.nome} (${item.estado.uf})` : '—'}
                        </td>
                        <td className="px-3 py-2 text-[var(--pd-text-primary)]">{item.numeroRemetente?.apelido || '—'}</td>
                        <td className="px-3 py-2 text-[var(--pd-warning)] break-words max-w-[260px]">{item.erro || '—'}</td>
                        <td className="px-3 py-2 text-[var(--pd-text-secondary)] whitespace-nowrap">{formatDataHora(item.criadoEm)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleReenviar(item.disparoContatoId)}
                              disabled={emProgresso}
                              className={btnGhost}
                            >
                              {reenviandoId === item.disparoContatoId ? 'Reenviando...' : 'Reenviar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleIgnorar(item.disparoContatoId)}
                              disabled={emProgresso}
                              className={btnGhost}
                            >
                              {ignorandoId === item.disparoContatoId ? 'Ignorando...' : 'Ignorar'}
                            </button>
                          </div>
                          {erroReenvioPorId[item.disparoContatoId] ? (
                            <div className="mt-1 max-w-[220px] text-right text-[11.5px] text-[var(--pd-danger)] break-words">
                              {erroReenvioPorId[item.disparoContatoId]}
                            </div>
                          ) : null}
                          {erroIgnorarPorId[item.disparoContatoId] ? (
                            <div className="mt-1 max-w-[220px] text-right text-[11.5px] text-[var(--pd-danger)] break-words">
                              {erroIgnorarPorId[item.disparoContatoId]}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
