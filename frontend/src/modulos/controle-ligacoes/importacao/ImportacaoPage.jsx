import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../app/AuthContext.jsx';
import { importarContatos, fetchHistoricoImportacoes, fetchDetalheImportacao } from './importacaoApi.js';

const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-3 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5";

function formatDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatResumoLinha({ totalImportados, totalLinhas, totalSemEstado, totalDuplicado, totalErro }) {
  const partes = [`${totalImportados} importados de ${totalLinhas}`];
  if (totalDuplicado > 0) partes.push(`${totalDuplicado} duplicado(s)`);
  if (totalSemEstado > 0) partes.push(`${totalSemEstado} sem estado`);
  if (totalErro > 0) partes.push(`${totalErro} erro(s)`);
  return partes.join(' · ');
}

const STAT_VARIANTS = {
  danger: { border: 'border-[var(--danger)]/50', bg: 'bg-[var(--danger-bg)]', value: 'text-[var(--danger)]' },
  warning: { border: 'border-[var(--warning)]/50', bg: 'bg-[var(--warning-bg)]', value: 'text-[var(--warning)]' },
};

function Stat({ label, value, variant }) {
  const v = variant ? STAT_VARIANTS[variant] : null;
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-center ${v ? `${v.border} ${v.bg}` : 'border-[var(--border)] bg-[var(--panel-alt)]'}`}>
      <div className={`font-display text-[20px] font-extrabold leading-none ${v ? v.value : 'text-[var(--text)]'}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[.06em] text-[var(--muted)]">{label}</div>
    </div>
  );
}

function ResumoStats({ resumo }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Stat label="Linhas" value={resumo.totalLinhas} />
      <Stat label="Importados" value={resumo.totalImportados} />
      <Stat label="Sem estado" value={resumo.totalSemEstado} />
      <Stat label="Duplicados" value={resumo.totalDuplicado} variant={resumo.totalDuplicado > 0 ? 'warning' : undefined} />
      <Stat label="Erros" value={resumo.totalErro} variant={resumo.totalErro > 0 ? 'danger' : undefined} />
    </div>
  );
}

function TipoErroBadge({ tipo }) {
  const isDuplicado = tipo === 'duplicado';
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
        isDuplicado ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : 'bg-[var(--danger-bg)] text-[var(--danger)]'
      }`}
    >
      {isDuplicado ? 'Duplicado' : 'Erro'}
    </span>
  );
}

function DetalheImportacao({ loteId, token, onVoltar }) {
  const [detalhe, setDetalhe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const carregar = useCallback(() => {
    fetchDetalheImportacao(token, loteId)
      .then((dados) => { setDetalhe(dados); setError(null); })
      .catch((err) => setError(err.message || 'Erro ao carregar detalhe da importação.'))
      .finally(() => setLoading(false));
  }, [token, loteId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function retry() {
    setLoading(true);
    setError(null);
    carregar();
  }

  return (
    <div className={card}>
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="font-display text-[19px] font-bold">Detalhe da importação</h2>
        <button type="button" className={btnGhost} onClick={onVoltar}>Voltar ao histórico</button>
      </div>

      {loading ? (
        <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Carregando...</div>
      ) : error ? (
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <span className="break-words">{error}</span>
          {error === 'Importação não encontrada.' ? (
            <button className={`${btn} w-full sm:w-auto`} onClick={onVoltar}>Voltar ao histórico</button>
          ) : (
            <button className={`${btn} w-full sm:w-auto`} onClick={retry}>Tentar novamente</button>
          )}
        </div>
      ) : detalhe ? (
        <>
          <div className="mb-4 text-sm text-[var(--muted)]">
            <div className="text-[15px] font-semibold text-[var(--text)]">{detalhe.nomeArquivo}</div>
            <div>
              {detalhe.usuarioEmail || 'usuário removido'} · {formatDataHora(detalhe.criado_em)}
            </div>
          </div>

          <ResumoStats resumo={detalhe} />

          <h3 className="font-display mt-5 mb-2.5 text-[15px] font-bold">Por estado</h3>
          {(detalhe.porEstado || []).length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 text-[13px] text-[var(--muted)]">
              Nenhum contato com estado reconhecido nesta importação.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {detalhe.porEstado.map((item) => (
                <div
                  key={item.estado.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 text-sm"
                >
                  <span className="font-semibold text-[var(--text)]">{item.estado.nome} ({item.estado.uf})</span>
                  <span className="text-[var(--muted)]">{item.totalContatos} contato(s)</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="font-display mt-5 mb-2.5 text-[15px] font-bold">Linhas rejeitadas</h3>
          {(detalhe.erros || []).length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 text-[13px] text-[var(--muted)]">
              Nenhum erro nesta importação.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="bg-[var(--panel-alt)] text-[11px] uppercase tracking-[.06em] text-[var(--muted)]">
                    <th className="px-3 py-2 font-semibold">Linha</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Nome</th>
                    <th className="px-3 py-2 font-semibold">Contato</th>
                    <th className="px-3 py-2 font-semibold">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {detalhe.erros.map((erro, idx) => (
                    <tr key={`${erro.linha}-${idx}`}>
                      <td className="px-3 py-2 text-[var(--text)]">{erro.linha}</td>
                      <td className="px-3 py-2">
                        <TipoErroBadge tipo={erro.tipo} />
                      </td>
                      <td className="px-3 py-2 text-[var(--text)]">{erro.nomePlanilha || '—'}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{erro.contatoPlanilha || '—'}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{erro.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function ImportacaoPage() {
  const { token } = useAuth();

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }

  const [view, setView] = useState('lista');
  const [detalheLoteId, setDetalheLoteId] = useState(null);

  function abrirDetalhe(loteImportacaoId) {
    setDetalheLoteId(loteImportacaoId);
    setView('detalhe');
  }

  function voltarParaLista() {
    setView('lista');
    setDetalheLoteId(null);
  }

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [resultadoUpload, setResultadoUpload] = useState(null);
  const fileInputRef = useRef(null);

  const [historico, setHistorico] = useState([]);
  const [loadingHistorico, setLoadingHistorico] = useState(true);
  const [historicoError, setHistoricoError] = useState(null);

  const carregarHistorico = useCallback(() => {
    fetchHistoricoImportacoes(token)
      .then((lista) => { setHistorico(lista || []); setHistoricoError(null); })
      .catch((err) => setHistoricoError(err.message || 'Erro ao carregar histórico de importações.'))
      .finally(() => setLoadingHistorico(false));
  }, [token]);

  useEffect(() => {
    carregarHistorico();
  }, [carregarHistorico]);

  function retryHistorico() {
    setLoadingHistorico(true);
    setHistoricoError(null);
    carregarHistorico();
  }

  function handleUpload(e) {
    e.preventDefault();
    setUploadError(null);

    if (!selectedFile) {
      setUploadError('Selecione um arquivo .xlsx ou .csv.');
      return;
    }

    setUploading(true);
    importarContatos(token, selectedFile)
      .then((resultado) => {
        setResultadoUpload(resultado);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        flash('Importação concluída.');
        retryHistorico();
      })
      .catch((err) => setUploadError(err.message || 'Erro ao importar contatos.'))
      .finally(() => setUploading(false));
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 sm:p-6 text-[var(--text)]">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-[22px] border-b border-[var(--border)] pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
          <h1 className="font-display mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Importação de contatos</h1>
        </div>

        {view === 'detalhe' ? (
          <DetalheImportacao loteId={detalheLoteId} token={token} onVoltar={voltarParaLista} />
        ) : (
          <>
            <div className={`${card} mb-[18px]`}>
              <h2 className="font-display mb-3 text-[19px] font-bold">Enviar planilha</h2>
              <p className="mb-3.5 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 text-[12.5px] text-[var(--muted)]">
                A planilha deve conter as colunas <strong className="text-[var(--text)]">NOME</strong> e{' '}
                <strong className="text-[var(--text)]">CONTATO</strong> (com DDI, ex: 5598999999999).
              </p>

              <form onSubmit={handleUpload} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  aria-label="Arquivo de contatos"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className={`${inputCls} sm:flex-1`}
                />
                <button type="submit" className={`${btn} w-full sm:w-auto`} disabled={uploading}>
                  {uploading ? 'Enviando...' : 'Importar'}
                </button>
              </form>
              {uploadError ? (
                <div className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)] break-words">
                  {uploadError}
                </div>
              ) : null}

              {resultadoUpload ? (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-[15px] font-bold">Resumo da importação</h3>
                    <button type="button" className={btnGhost} onClick={() => setResultadoUpload(null)}>Fechar</button>
                  </div>
                  <p className="mb-3.5 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 text-[12.5px] text-[var(--muted)]">
                    Importação concluída — os contatos já estão disponíveis no Painel de Disparo.
                  </p>
                  <ResumoStats resumo={resultadoUpload} />
                  {(resultadoUpload.porEstado || []).length > 0 ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {resultadoUpload.porEstado.map((item) => (
                        <div
                          key={item.estado.id}
                          className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 text-sm"
                        >
                          <span className="font-semibold text-[var(--text)]">{item.estado.nome} ({item.estado.uf})</span>
                          <span className="text-[var(--muted)]">{item.totalContatos} contato(s)</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className={card}>
              <h2 className="font-display mb-3.5 text-[19px] font-bold">Histórico de importações</h2>
              {loadingHistorico ? (
                <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Carregando...</div>
              ) : historicoError ? (
                <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                  <span className="break-words">Não foi possível carregar o histórico de importações: {historicoError}</span>
                  <button className={`${btn} w-full sm:w-auto`} onClick={retryHistorico}>Tentar novamente</button>
                </div>
              ) : historico.length === 0 ? (
                <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Nenhuma importação realizada ainda.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {historico.map((item) => (
                    <button
                      key={item.loteImportacaoId}
                      type="button"
                      onClick={() => abrirDetalhe(item.loteImportacaoId)}
                      className="flex w-full flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--violet)]"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="truncate text-sm font-semibold text-[var(--text)]">{item.nomeArquivo}</span>
                        <span className="text-[12px] text-[var(--muted)]">{formatDataHora(item.criado_em)}</span>
                      </div>
                      <div className="text-[12px] text-[var(--muted)]">
                        {formatResumoLinha(item)} · {item.usuarioEmail || 'usuário removido'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--violet)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
