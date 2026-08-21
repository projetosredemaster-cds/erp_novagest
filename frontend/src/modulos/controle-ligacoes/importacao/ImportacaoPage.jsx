// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchEstados, fetchNumerosRemetentes } from '../configuracoes/controleLigacoesConfigApi.js';
import { importarContatos, confirmarImportacao, fetchImportacoesPendentes } from './importacaoApi.js';

const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const btnDanger = "bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[12.5px] font-bold cursor-pointer hover:brightness-110";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-3 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5";
const selectCls = "w-full min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-2.5 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";

function formatData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 text-center">
      <div className="font-display text-[20px] font-extrabold leading-none text-[var(--text)]">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[.06em] text-[var(--muted)]">{label}</div>
    </div>
  );
}

export default function ImportacaoPage() {
  const { token } = useAuth();

  const [numerosRemetentes, setNumerosRemetentes] = useState([]);
  const [estadosCadastrados, setEstadosCadastrados] = useState([]);

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }

  useEffect(() => {
    fetchNumerosRemetentes(token).then((lista) => setNumerosRemetentes(lista || [])).catch(() => {});
    fetchEstados(token).then((lista) => setEstadosCadastrados(lista || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // contador local para chaves de linha da retomada — evita Date.now()
  // (função impura) sendo chamada a partir do corpo do componente.
  const localIdCounterRef = useRef(0);
  function nextLocalId() {
    localIdCounterRef.current += 1;
    return `linha-${localIdCounterRef.current}`;
  }

  function numerosAtivosDoEstado(estadoId) {
    return numerosRemetentes.filter((n) => n.estado.id === Number(estadoId) && n.ativo);
  }

  // --- upload ---
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // --- etapa de confirmação (comum a upload novo e retomada de pendente) ---
  // confirmContext: { modo: 'novo' | 'retomada', loteImportacaoId, resumo }
  const [confirmContext, setConfirmContext] = useState(null);
  const [escolhasPorEstado, setEscolhasPorEstado] = useState({}); // modo 'novo': { [estadoId]: numeroRemetenteId }
  const [retomadaLinhas, setRetomadaLinhas] = useState([]); // modo 'retomada': [{ localId, estadoId, numeroRemetenteId }]
  const [confirmando, setConfirmando] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  function abrirConfirmacaoNova(resultado) {
    setConfirmContext({ modo: 'novo', loteImportacaoId: resultado.loteImportacaoId, resumo: resultado });
    const inicial = {};
    (resultado.porEstado || []).forEach((item) => { inicial[item.estado.id] = ''; });
    setEscolhasPorEstado(inicial);
    setConfirmError(null);
  }

  function abrirConfirmacaoRetomada(pendente) {
    setConfirmContext({ modo: 'retomada', loteImportacaoId: pendente.loteImportacaoId, resumo: pendente });
    setRetomadaLinhas([{ localId: nextLocalId(), estadoId: '', numeroRemetenteId: '' }]);
    setConfirmError(null);
  }

  function cancelarConfirmacao() {
    setConfirmContext(null);
    setEscolhasPorEstado({});
    setRetomadaLinhas([]);
    setConfirmError(null);
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
        abrirConfirmacaoNova(resultado);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        flash('Arquivo importado. Confira o resumo e escolha os números.');
      })
      .catch((err) => setUploadError(err.message || 'Erro ao importar contatos.'))
      .finally(() => setUploading(false));
  }

  function addRetomadaLinha() {
    setRetomadaLinhas((prev) => [...prev, { localId: nextLocalId(), estadoId: '', numeroRemetenteId: '' }]);
  }

  function removeRetomadaLinha(localId) {
    setRetomadaLinhas((prev) => prev.filter((l) => l.localId !== localId));
  }

  function updateRetomadaLinha(localId, campo, valor) {
    setRetomadaLinhas((prev) => prev.map((l) => {
      if (l.localId !== localId) return l;
      if (campo === 'estadoId') return { ...l, estadoId: valor, numeroRemetenteId: '' };
      return { ...l, [campo]: valor };
    }));
  }

  const confirmarHabilitado = confirmContext?.modo === 'novo'
    ? Object.values(escolhasPorEstado).every((v) => v !== '')
      && Object.values(escolhasPorEstado).length > 0
    : retomadaLinhas.length > 0 && retomadaLinhas.every((l) => l.estadoId && l.numeroRemetenteId);

  function handleConfirmar() {
    if (!confirmContext) return;

    const escolhas = confirmContext.modo === 'novo'
      ? Object.entries(escolhasPorEstado).map(([estadoId, numeroRemetenteId]) => ({
        estadoId: Number(estadoId),
        numeroRemetenteId: Number(numeroRemetenteId),
      }))
      : retomadaLinhas
        .filter((l) => l.estadoId && l.numeroRemetenteId)
        .map((l) => ({ estadoId: Number(l.estadoId), numeroRemetenteId: Number(l.numeroRemetenteId) }));

    setConfirmando(true);
    setConfirmError(null);
    confirmarImportacao(token, confirmContext.loteImportacaoId, escolhas)
      .then(() => {
        flash('Distribuição confirmada com sucesso.');
        cancelarConfirmacao();
        loadPendentes();
      })
      .catch((err) => setConfirmError(err.message || 'Erro ao confirmar importação.'))
      .finally(() => setConfirmando(false));
  }

  // --- importações pendentes ---
  const [pendentes, setPendentes] = useState([]);
  const [loadingPendentes, setLoadingPendentes] = useState(true);
  const [pendentesError, setPendentesError] = useState(null);

  function runLoadPendentes() {
    fetchImportacoesPendentes(token)
      .then((lista) => setPendentes(lista || []))
      .catch((err) => setPendentesError(err.message || 'Erro ao carregar importações pendentes.'))
      .finally(() => setLoadingPendentes(false));
  }

  function loadPendentes() {
    setLoadingPendentes(true);
    setPendentesError(null);
    runLoadPendentes();
  }

  useEffect(() => {
    runLoadPendentes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 sm:p-6 text-[var(--text)]">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-[22px] border-b border-[var(--border)] pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
          <h1 className="font-display mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Importação de contatos</h1>
        </div>

        {!confirmContext ? (
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
          </div>
        ) : null}

        {confirmContext ? (
          <div className={`${card} mb-[18px]`}>
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display text-[19px] font-bold">
                {confirmContext.modo === 'novo' ? 'Resumo da importação' : 'Retomar importação pendente'}
              </h2>
              <button type="button" className={btnGhost} onClick={cancelarConfirmacao}>Cancelar</button>
            </div>

            {confirmContext.modo === 'novo' ? (
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Linhas" value={confirmContext.resumo.totalLinhas} />
                <Stat label="Importados" value={confirmContext.resumo.totalImportados} />
                <Stat label="Sem estado" value={confirmContext.resumo.totalSemEstado} />
                <Stat label="Duplicados" value={confirmContext.resumo.totalDuplicado} />
                <Stat label="Erros" value={confirmContext.resumo.totalErro} />
              </div>
            ) : (
              <p className="mb-4 text-[13px] text-[var(--muted)]">
                Arquivo <strong className="text-[var(--text)]">{confirmContext.resumo.nomeArquivo}</strong> — {confirmContext.resumo.totalImportados} contatos importados em {formatData(confirmContext.resumo.criado_em)}.
                Escolha manualmente os estados presentes neste lote e o número que deve recebê-los.
              </p>
            )}

            {confirmContext.modo === 'novo' ? (
              <div className="flex flex-col gap-2.5">
                {(confirmContext.resumo.porEstado || []).map((item) => {
                  const opcoes = numerosAtivosDoEstado(item.estado.id);
                  return (
                    <div key={item.estado.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm">
                        <span className="font-semibold text-[var(--text)]">{item.estado.nome} ({item.estado.uf})</span>
                        <span className="ml-2 text-[var(--muted)]">{item.totalContatos} contato(s)</span>
                      </div>
                      {opcoes.length === 0 ? (
                        <span className="text-[12.5px] text-[var(--danger)]">Nenhum número ativo para este estado.</span>
                      ) : (
                        <select
                          aria-label={`Número remetente para ${item.estado.nome}`}
                          value={escolhasPorEstado[item.estado.id] || ''}
                          onChange={(e) => setEscolhasPorEstado((prev) => ({ ...prev, [item.estado.id]: e.target.value }))}
                          className={selectCls}
                        >
                          <option value="">Selecione o número...</option>
                          {opcoes.map((n) => (
                            <option key={n.id} value={n.id}>{n.apelido}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {retomadaLinhas.map((linha) => {
                  const opcoes = linha.estadoId ? numerosAtivosDoEstado(linha.estadoId) : [];
                  return (
                    <div key={linha.localId} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:flex-row sm:items-center">
                      <select
                        aria-label="Estado"
                        value={linha.estadoId}
                        onChange={(e) => updateRetomadaLinha(linha.localId, 'estadoId', e.target.value)}
                        className={selectCls}
                      >
                        <option value="">Selecione o estado...</option>
                        {estadosCadastrados.map((estado) => (
                          <option key={estado.id} value={estado.id}>{estado.nome} ({estado.uf})</option>
                        ))}
                      </select>
                      <select
                        aria-label="Número remetente"
                        value={linha.numeroRemetenteId}
                        onChange={(e) => updateRetomadaLinha(linha.localId, 'numeroRemetenteId', e.target.value)}
                        disabled={!linha.estadoId}
                        className={selectCls}
                      >
                        <option value="">Selecione o número...</option>
                        {opcoes.map((n) => (
                          <option key={n.id} value={n.id}>{n.apelido}</option>
                        ))}
                      </select>
                      {retomadaLinhas.length > 1 ? (
                        <button
                          type="button"
                          aria-label="Remover estado desta escolha"
                          className={`${btnDanger} shrink-0`}
                          onClick={() => removeRetomadaLinha(linha.localId)}
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <button type="button" className={`${btnGhost} w-fit`} onClick={addRetomadaLinha}>
                  + Adicionar outro estado
                </button>
                <p className="text-[11.5px] text-[var(--muted)]">
                  Esta lista não informa automaticamente quais estados fazem parte do lote pendente — escolha os estados
                  presentes na importação original. Se um estado escolhido não tiver contatos pendentes neste lote, a
                  confirmação retornará um erro explicando isso.
                </p>
              </div>
            )}

            {confirmError ? (
              <div className="mt-3.5 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)] break-words">
                {confirmError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={`${btn} w-full sm:w-auto`}
                disabled={!confirmarHabilitado || confirmando}
                onClick={handleConfirmar}
              >
                {confirmando ? 'Confirmando...' : 'Confirmar distribuição'}
              </button>
            </div>
          </div>
        ) : null}

        <div className={card}>
          <h2 className="font-display mb-3.5 text-[19px] font-bold">Importações pendentes</h2>
          {loadingPendentes ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Carregando...</div>
          ) : pendentesError ? (
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <span className="break-words">Não foi possível carregar as importações pendentes: {pendentesError}</span>
              <button className={`${btn} w-full sm:w-auto`} onClick={loadPendentes}>Tentar novamente</button>
            </div>
          ) : pendentes.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Nenhuma importação pendente.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {pendentes.map((p) => (
                <div
                  key={p.loteImportacaoId}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-semibold text-[var(--text)]">{p.nomeArquivo}</div>
                    <div className="text-[12px] text-[var(--muted)]">{p.totalImportados} contato(s) — {formatData(p.criado_em)}</div>
                  </div>
                  <button type="button" className={`${btn} w-full sm:w-auto`} onClick={() => abrirConfirmacaoRetomada(p)}>
                    Retomar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
