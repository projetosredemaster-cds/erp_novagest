// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../../app/useAuth.js';
import {
  fetchEstados, criarEstado,
  fetchNumerosRemetentes, criarNumeroRemetente, atualizarNumeroRemetente, removerNumeroRemetente,
  desconectarNumeroRemetente, abrirStreamConexao,
} from './controleLigacoesConfigApi.js';

const btn = "bg-[var(--pd-accent)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-card-bg)] disabled:cursor-not-allowed disabled:opacity-50";
const btnDanger = "bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[12.5px] font-bold cursor-pointer hover:brightness-110";
const inputCls = "w-full rounded-lg border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-3 py-3 sm:py-2 text-sm text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]";
const card = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5";
const tag = "inline-flex items-center gap-1.5 rounded-full bg-[var(--pd-card-bg)] border border-[var(--pd-border)] pl-2.5 pr-1.5 py-1 text-[12px]";

const STATUS_CONEXAO_INFO = {
  conectado: { label: 'Conectado', bg: 'bg-[var(--success-bg)]', text: 'text-[var(--success)]' },
  desconectado: { label: 'Desconectado', bg: 'bg-[var(--danger-bg)]', text: 'text-[var(--danger)]' },
  aguardando_conexao: { label: 'Aguardando conexão', bg: 'bg-[var(--warning-bg)]', text: 'text-[var(--warning)]' },
};

function StatusConexaoBadge({ status }) {
  const info = STATUS_CONEXAO_INFO[status] || { label: status, bg: 'bg-[var(--pd-card-bg)]', text: 'text-[var(--pd-text-secondary)]' };
  return (
    <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${info.bg} ${info.text}`}>
      {info.label}
    </span>
  );
}

function AtivoBadge({ ativo }) {
  return ativo ? (
    <span className="w-fit rounded-full bg-[var(--pd-accent)]/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--pd-accent-strong)]">Ativo</span>
  ) : (
    <span className="w-fit rounded-full bg-[var(--pd-card-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">Inativo</span>
  );
}

function ConexaoWhatsAppModal({ numero, token, onClose, onConectado }) {
  const [status, setStatus] = useState('conectando'); // 'conectando' | 'qr' | 'conectado' | 'erro'
  const [qr, setQr] = useState(null);
  const [erro, setErro] = useState(null);
  const abortRef = useRef(null);

  function abrirConexao() {
    const controller = new AbortController();
    abortRef.current = controller;

    abrirStreamConexao(token, numero.id, {
      signal: controller.signal,
      onEvent: (event, data) => {
        if (event === 'qr') {
          setQr(data?.qr || null);
          setStatus('qr');
        } else if (event === 'conectado' || event === 'ja_conectado') {
          setStatus('conectado');
          onConectado();
        } else if (event === 'erro') {
          setErro(data?.mensagem || 'Erro ao conectar ao WhatsApp.');
          setStatus('erro');
        }
      },
    }).catch((err) => {
      if (controller.signal.aborted) return;
      setErro(err.message || 'Erro ao conectar ao WhatsApp.');
      setStatus('erro');
    });
  }

  useEffect(() => {
    abrirConexao();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleClose() {
    abortRef.current?.abort();
    onClose();
  }

  function handleRetry() {
    setStatus('conectando');
    setQr(null);
    setErro(null);
    abrirConexao();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conexao-modal-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="conexao-modal-title" className="font-display text-[19px] font-bold">
            Conectar WhatsApp
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={handleClose}
            className="text-xl leading-none text-[var(--pd-text-secondary)] hover:text-[var(--pd-text-primary)]"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-[13px] text-[var(--pd-text-secondary)]">{numero.apelido}</p>

        {status === 'conectando' ? (
          <div className="px-1 py-8 text-center text-sm text-[var(--pd-text-secondary)]">Aguardando QR Code...</div>
        ) : status === 'qr' ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl bg-white p-4" data-testid="qr-code-container">
              <QRCodeSVG value={qr || ''} size={220} />
            </div>
            <p className="text-center text-[12.5px] text-[var(--pd-text-secondary)]">
              Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o QR Code. Um novo código é
              gerado automaticamente a cada 20 segundos.
            </p>
          </div>
        ) : status === 'conectado' ? (
          <div className="px-1 py-8 text-center text-sm font-semibold text-[var(--success)]">
            WhatsApp conectado com sucesso!
          </div>
        ) : status === 'erro' ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-full rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)] break-words">
              {erro}
            </div>
            <button type="button" className={btn} onClick={handleRetry}>Tentar novamente</button>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button type="button" className={btnGhost} onClick={handleClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default function NumerosRemetentesPage() {
  const { token } = useAuth();

  const [numeros, setNumeros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [estados, setEstados] = useState([]);
  const [loadingEstados, setLoadingEstados] = useState(true);
  const [estadosError, setEstadosError] = useState(null);

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }

  function runLoadNumeros() {
    fetchNumerosRemetentes(token)
      .then((lista) => setNumeros(lista || []))
      .catch((err) => setLoadError(err.message || 'Erro ao carregar números remetentes.'))
      .finally(() => setLoading(false));
  }

  function loadNumeros() {
    setLoading(true);
    setLoadError(null);
    runLoadNumeros();
  }

  function runLoadEstados() {
    fetchEstados(token)
      .then((lista) => setEstados(lista || []))
      .catch((err) => setEstadosError(err.message || 'Erro ao carregar estados.'))
      .finally(() => setLoadingEstados(false));
  }

  useEffect(() => {
    runLoadNumeros();
    runLoadEstados();

  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingNumero, setEditingNumero] = useState(null);
  const [apelido, setApelido] = useState('');
  const [estadoId, setEstadoId] = useState('');
  const [nomeColaboradora, setNomeColaboradora] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [conexaoNumero, setConexaoNumero] = useState(null);
  const [showEstadoForm, setShowEstadoForm] = useState(false);
  const [novoEstadoNome, setNovoEstadoNome] = useState('');
  const [novoEstadoUf, setNovoEstadoUf] = useState('');
  const [novoEstadoDdds, setNovoEstadoDdds] = useState([]);
  const [dddInput, setDddInput] = useState('');
  const [estadoFormError, setEstadoFormError] = useState(null);
  const [savingEstado, setSavingEstado] = useState(false);

  function resetEstadoForm() {
    setShowEstadoForm(false);
    setNovoEstadoNome('');
    setNovoEstadoUf('');
    setNovoEstadoDdds([]);
    setDddInput('');
    setEstadoFormError(null);
  }

  function openCreateForm() {
    setEditingNumero(null);
    setApelido('');
    setEstadoId('');
    setNomeColaboradora('');
    setFormError(null);
    resetEstadoForm();
    setFormOpen(true);
  }

  function openEditForm(numero) {
    setEditingNumero(numero);
    setApelido(numero.apelido);
    setEstadoId(String(numero.estado.id));
    setNomeColaboradora(numero.nomeColaboradora || '');
    setFormError(null);
    resetEstadoForm();
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
  }

  function handleSubmitForm(e) {
    e.preventDefault();
    setFormError(null);

    if (!apelido.trim()) {
      setFormError('Campo "apelido" é obrigatório.');
      return;
    }
    if (!estadoId) {
      setFormError('Selecione um estado.');
      return;
    }

    setSaving(true);
    const payload = { apelido: apelido.trim(), estadoId: Number(estadoId) };
    if (editingNumero) {
      payload.nomeColaboradora = nomeColaboradora.trim() ? nomeColaboradora.trim() : null;
    }
    const promise = editingNumero
      ? atualizarNumeroRemetente(token, editingNumero.id, payload)
      : criarNumeroRemetente(token, payload);

    promise
      .then((numeroSalvo) => {
        setNumeros((prev) => (
          editingNumero
            ? prev.map((n) => (n.id === numeroSalvo.id ? numeroSalvo : n))
            : [...prev, numeroSalvo]
        ));
        flash(editingNumero ? 'Número remetente atualizado.' : 'Número remetente criado.');
        setFormOpen(false);
      })
      .catch((err) => setFormError(err.message || 'Erro ao salvar número remetente.'))
      .finally(() => setSaving(false));
  }

  function handleToggleAtivo(numero) {
    atualizarNumeroRemetente(token, numero.id, { ativo: !numero.ativo })
      .then((numeroAtualizado) => {
        setNumeros((prev) => prev.map((n) => (n.id === numeroAtualizado.id ? numeroAtualizado : n)));
        flash(numeroAtualizado.ativo ? 'Número reativado.' : 'Número desativado.');
      })
      .catch((err) => flash(err.message || 'Erro ao atualizar status do número.', 'error'));
  }

  function handleDelete(numero) {
    if (!confirm(`Excluir o número remetente "${numero.apelido}"?`)) return;
    removerNumeroRemetente(token, numero.id)
      .then(() => {
        setNumeros((prev) => prev.filter((n) => n.id !== numero.id));
        flash('Número remetente excluído.');
      })
      .catch((err) => flash(err.message || 'Erro ao excluir número remetente.', 'error'));
  }

  function openConexaoModal(numero) {
    setConexaoNumero(numero);
  }

  function closeConexaoModal() {
    setConexaoNumero(null);
  }

  function handleConexaoConcluida() {
    setConexaoNumero(null);
    flash('WhatsApp conectado com sucesso.');
    loadNumeros();
  }

  function handleDesconectar(numero) {
    if (!confirm('Isso encerrará a sessão do WhatsApp. Será necessário escanear o QR novamente para reconectar. Continuar?')) return;
    desconectarNumeroRemetente(token, numero.id)
      .then((numeroAtualizado) => {
        setNumeros((prev) => prev.map((n) => (n.id === numeroAtualizado.id ? numeroAtualizado : n)));
        flash('WhatsApp desconectado.');
      })
      .catch((err) => flash(err.message || 'Erro ao desconectar WhatsApp.', 'error'));
  }

  function addDddTag() {
    const valor = dddInput.trim();
    if (!valor) return;
    if (!/^\d{2}$/.test(valor)) {
      setEstadoFormError('Cada DDD deve ter exatamente 2 dígitos.');
      return;
    }
    setEstadoFormError(null);
    setDddInput('');
    setNovoEstadoDdds((prev) => (prev.includes(valor) ? prev : [...prev, valor]));
  }

  function removeDddTag(valor) {
    setNovoEstadoDdds((prev) => prev.filter((d) => d !== valor));
  }

  function handleDddKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDddTag();
    }
  }

  function handleCreateEstado(e) {
    e.preventDefault();
    setEstadoFormError(null);

    if (!novoEstadoNome.trim()) {
      setEstadoFormError('Campo "nome" é obrigatório.');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(novoEstadoUf.trim())) {
      setEstadoFormError('Campo "uf" é obrigatório e deve ter 2 letras.');
      return;
    }
    if (novoEstadoDdds.length === 0) {
      setEstadoFormError('Informe ao menos um DDD válido.');
      return;
    }

    setSavingEstado(true);
    criarEstado(token, {
      nome: novoEstadoNome.trim(),
      uf: novoEstadoUf.trim().toUpperCase(),
      ddds: novoEstadoDdds,
    })
      .then((estadoCriado) => {
        setEstados((prev) => [...prev, estadoCriado]);
        setEstadoId(String(estadoCriado.id));
        resetEstadoForm();
        flash('Estado criado.');
      })
      .catch((err) => setEstadoFormError(err.message || 'Erro ao criar estado.'))
      .finally(() => setSavingEstado(false));
  }

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-[22px] flex flex-col gap-3 border-b border-[var(--pd-border)] pb-[18px] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de ligações - Configurações</div>
            <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Números Remetentes</h1>
          </div>
          <button type="button" className={`${btn} w-full sm:w-auto`} onClick={openCreateForm}>
            + Novo número remetente
          </button>
        </div>

        <div className={card}>
          {loading ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
          ) : loadError ? (
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <span className="break-words">Não foi possível carregar os números remetentes: {loadError}</span>
              <button className={`${btn} w-full sm:w-auto`} onClick={loadNumeros}>Tentar novamente</button>
            </div>
          ) : numeros.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--pd-text-secondary)]">Nenhum número remetente cadastrado.</div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:hidden">
                {numeros.map((n) => (
                  <div key={n.id} className="rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-4 py-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--pd-text-primary)]">{n.apelido}</div>
                        <div className="text-[12px] text-[var(--pd-text-secondary)]">{n.estado.nome} ({n.estado.uf})</div>
                      </div>
                      <AtivoBadge ativo={n.ativo} />
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <StatusConexaoBadge status={n.statusConexao} />
                      {n.statusConexao === 'conectado' ? (
                        <button
                          type="button"
                          className={`${btnGhost} px-2.5 py-1 text-[11.5px]`}
                          onClick={() => handleDesconectar(n)}
                        >
                          Desconectar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`${btn} px-2.5 py-1 text-[11.5px]`}
                          onClick={() => openConexaoModal(n)}
                        >
                          Conectar WhatsApp
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className={btnGhost} onClick={() => openEditForm(n)}>Editar</button>
                      <button className={btnGhost} onClick={() => handleToggleAtivo(n)}>{n.ativo ? 'Desativar' : 'Reativar'}</button>
                      <button className={btnDanger} onClick={() => handleDelete(n)}>Excluir</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[.08em] text-[var(--pd-text-secondary)]">
                      <th className="pb-2 font-semibold">Apelido</th>
                      <th className="pb-2 font-semibold">Estado</th>
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Situação</th>
                      <th className="pb-2 text-right font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {numeros.map((n) => (
                      <tr key={n.id} className="border-t border-[var(--pd-border)]">
                        <td className="py-2.5">{n.apelido}</td>
                        <td className="py-2.5 text-[var(--pd-text-secondary)]">{n.estado.nome} ({n.estado.uf})</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <StatusConexaoBadge status={n.statusConexao} />
                            {n.statusConexao === 'conectado' ? (
                              <button
                                type="button"
                                className={`${btnGhost} px-2.5 py-1 text-[11.5px]`}
                                onClick={() => handleDesconectar(n)}
                              >
                                Desconectar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={`${btn} px-2.5 py-1 text-[11.5px]`}
                                onClick={() => openConexaoModal(n)}
                              >
                                Conectar WhatsApp
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5"><AtivoBadge ativo={n.ativo} /></td>
                        <td className="py-2.5">
                          <div className="flex justify-end gap-2">
                            <button className={btnGhost} onClick={() => openEditForm(n)}>Editar</button>
                            <button className={btnGhost} onClick={() => handleToggleAtivo(n)}>{n.ativo ? 'Desativar' : 'Reativar'}</button>
                            <button className={btnDanger} onClick={() => handleDelete(n)}>Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {formOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="numero-form-title"
          onClick={closeForm}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="numero-form-title" className="font-display text-[19px] font-bold">
                {editingNumero ? 'Editar número remetente' : 'Novo número remetente'}
              </h2>
              <button
                type="button"
                aria-label="Fechar"
                onClick={closeForm}
                className="text-xl leading-none text-[var(--pd-text-secondary)] hover:text-[var(--pd-text-primary)]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} noValidate className="flex flex-col gap-3">
              <div>
                <label htmlFor="numero-apelido" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">Apelido</label>
                <input
                  id="numero-apelido"
                  value={apelido}
                  onChange={(e) => setApelido(e.target.value)}
                  placeholder="Ex.: CDC Cohatrac"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="numero-nome-colaboradora" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">
                  Nome da colaboradora (opcional)
                </label>
                <input
                  id="numero-nome-colaboradora"
                  value={nomeColaboradora}
                  onChange={(e) => setNomeColaboradora(e.target.value)}
                  placeholder="Ex.: Maria Silva"
                  disabled={!editingNumero}
                  className={inputCls}
                />
                {!editingNumero ? (
                  <p className="mt-1 text-[11.5px] text-[var(--pd-text-secondary)]">
                    Disponível para preencher depois de criar o número, na edição.
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="numero-estado" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">Estado</label>
                {loadingEstados ? (
                  <div className="text-sm text-[var(--pd-text-secondary)]">Carregando estados...</div>
                ) : estadosError ? (
                  <div className="text-[13px] text-[var(--danger)]">{estadosError}</div>
                ) : (
                  <select
                    id="numero-estado"
                    value={estadoId}
                    onChange={(e) => setEstadoId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Selecione um estado...</option>
                    {estados.map((estado) => (
                      <option key={estado.id} value={estado.id}>{estado.nome} ({estado.uf})</option>
                    ))}
                  </select>
                )}

                {!showEstadoForm ? (
                  <button
                    type="button"
                    onClick={() => setShowEstadoForm(true)}
                    className="mt-2 text-[12.5px] font-semibold text-[var(--pd-accent-strong)] hover:underline"
                  >
                    + Cadastrar novo estado
                  </button>
                ) : (
                  <div className="mt-3 rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[12.5px] font-semibold text-[var(--pd-text-primary)]">Novo estado</span>
                      <button
                        type="button"
                        aria-label="Cancelar cadastro de estado"
                        onClick={resetEstadoForm}
                        className="text-[13px] leading-none text-[var(--pd-text-secondary)] hover:text-[var(--pd-text-primary)]"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <input
                        placeholder="Nome (ex.: Maranhão)"
                        value={novoEstadoNome}
                        onChange={(e) => setNovoEstadoNome(e.target.value)}
                        className={inputCls}
                      />
                      <input
                        placeholder="UF (ex.: MA)"
                        maxLength={2}
                        value={novoEstadoUf}
                        onChange={(e) => setNovoEstadoUf(e.target.value)}
                        className={inputCls}
                      />
                      <div>
                        <label htmlFor="novo-estado-ddds" className="mb-1 block text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">
                          DDDs (Enter ou vírgula para adicionar)
                        </label>
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {novoEstadoDdds.map((d) => (
                            <span key={d} className={tag}>
                              {d}
                              <button
                                type="button"
                                aria-label={`Remover DDD ${d}`}
                                onClick={() => removeDddTag(d)}
                                className="text-[var(--danger)]"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                        <input
                          id="novo-estado-ddds"
                          placeholder="Ex.: 98"
                          maxLength={2}
                          value={dddInput}
                          onChange={(e) => setDddInput(e.target.value)}
                          onKeyDown={handleDddKeyDown}
                          onBlur={addDddTag}
                          className={inputCls}
                        />
                      </div>

                      {estadoFormError ? (
                        <div className="text-[12.5px] text-[var(--danger)] break-words">{estadoFormError}</div>
                      ) : null}

                      <button
                        type="button"
                        onClick={handleCreateEstado}
                        disabled={savingEstado}
                        className={`${btn} w-full`}
                      >
                        {savingEstado ? 'Salvando...' : 'Salvar estado'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {formError ? (
                <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)] break-words">
                  {formError}
                </div>
              ) : null}

              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={closeForm}>Cancelar</button>
                <button type="submit" className={`${btn} w-full sm:w-auto`} disabled={saving}>
                  {saving ? 'Salvando...' : editingNumero ? 'Salvar alterações' : 'Criar número'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {conexaoNumero ? (
        <ConexaoWhatsAppModal
          numero={conexaoNumero}
          token={token}
          onClose={closeConexaoModal}
          onConectado={handleConexaoConcluida}
        />
      ) : null}

      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--pd-accent)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
