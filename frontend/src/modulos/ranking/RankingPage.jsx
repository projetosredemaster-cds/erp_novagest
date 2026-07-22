// style-system: Tailwind
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchRedes, fetchCategorias, fetchEntradas, salvarEntrada,
  criarRede, atualizarRede, removerRede, criarLoja, removerLoja,
  enviarRelatorioPorEmail,
} from './rankingApi';
import { useAuth } from '../../app/AuthContext.jsx';

// estado inicial vazio: redes/categorias agora vêm da API (ver useEffect de carga em RankingPage)
const emptyState = () => ({ redes: [], categorias: [] });

function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }
function toBRL(n) {
  n = Number(n) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDatePt(iso) {
  const [, m, d] = iso.split('-');
  return d + '/' + m;
}
function dataKey(date, catId) { return date + '|' + catId; }
// nomes de aba do Excel: máx. 31 caracteres, sem / \ ? * [ ] :
function sanitizeSheetName(nome) {
  const cleaned = String(nome).replace(/[/\\?*[\]:]/g, '').trim();
  return (cleaned || 'Categoria').slice(0, 31);
}
function rankLoja(values, lojas) {
  const withVal = lojas.map(l => ({ ...l, valor: Number(values[l.id]) || 0 }));
  withVal.sort((a, b) => b.valor - a.valor);
  return withVal.map((l, i) => ({ ...l, pos: i, medal: i === 0 ? '🥇' : (i === 1 ? '🥈' : '🍍') }));
}

// classes reaproveitadas (evita repetição, mesma filosofia de variável CSS do protótipo original)
const btn = "bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";

export default function RankingPage() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState(emptyState);
  const [entries, setEntries] = useState({});
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currentCatId, setCurrentCatId] = useState(null);
  const [currentView, setCurrentView] = useState('report');
  const [reportText, setReportText] = useState('');
  const [copyShown, setCopyShown] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);
  const copyTimer = useRef(null);

  // ---------- carga inicial (redes + categorias) via API ----------
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState(null);
  // erro pontual ao buscar entradas da categoria/data atual (não bloqueia a tela)
  const [entriesError, setEntriesError] = useState(null);

  // dispara o fetch em si; não reseta loading/error (isso é feito por quem chama, fora do efeito)
  function runLoadConfig() {
    Promise.all([fetchRedes(), fetchCategorias()])
      .then(([redes, categorias]) => {
        setConfig({ redes: redes || [], categorias: categorias || [] });
      })
      .catch(err => {
        setConfigError(err.message || 'Erro ao carregar dados do servidor.');
      })
      .finally(() => setLoadingConfig(false));
  }

  // handler do botão "Tentar novamente" (evento de UI, não roda dentro de um efeito)
  function loadConfig() {
    setLoadingConfig(true);
    setConfigError(null);
    runLoadConfig();
  }

  useEffect(() => {
    // estados iniciais (loadingConfig=true, configError=null) já cobrem a primeira carga
    runLoadConfig();
  }, []);

  // enquanto o usuário não escolheu uma aba (currentCatId ainda null, ou aponta
  // pra uma categoria que não existe mais), cai na principal — valor totalmente
  // derivado, sem precisar de um efeito só para inicializar/corrigir currentCatId.
  const cat = useMemo(() => (
    config.categorias.find(c => c.id === currentCatId)
    || config.categorias.find(c => c.principal)
    || config.categorias[0]
  ), [config, currentCatId]);

  // a tela de configuração é restrita a admins; a única forma de currentView
  // virar 'config' é o clique no botão abaixo, que só é renderizado quando
  // isAdmin é true — não há outro caminho no código que a defina.

  // ---------- carga de entradas de TODAS as categorias para a data atual ----------
  // roda sempre que a data mudar ou a lista de categorias for carregada (não mais ao trocar de aba),
  // assim o relatório completo (buildFullReport) sempre reflete o que está salvo no banco,
  // independente de quais categorias o usuário visitou nesta sessão.
  useEffect(() => {
    if (!config.categorias.length) return;
    let cancelled = false;
    Promise.all(
      config.categorias.map(c =>
        fetchEntradas(currentDate, c.id).then(lista => ({ catId: c.id, lista }))
      )
    )
      .then(results => {
        if (cancelled) return;
        setEntries(prev => {
          const next = { ...prev };
          results.forEach(({ catId, lista }) => {
            const vals = {};
            (lista || []).forEach(e => { vals[e.loja_id] = e.valor; });
            next[dataKey(currentDate, catId)] = vals;
          });
          return next;
        });
        setEntriesError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setEntriesError(err.message || 'Erro ao carregar entradas.');
      });
    return () => { cancelled = true; };
  }, [currentDate, config.categorias]);

  // type 'success' (padrão, usado ex. em "Salvo") some rápido; type 'error' (mensagens do backend,
  // incluindo bloqueios 409, que podem ser mais longas) fica visível por mais tempo.
  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1400);
  }

  const values = cat ? (entries[dataKey(currentDate, cat.id)] || {}) : {};

  function setValue(lojaId, val) {
    if (!cat) return;
    const k = dataKey(currentDate, cat.id);
    setEntries(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [lojaId]: val } }));
  }

  function onBlurSave(lojaId) {
    if (!cat) return;
    const valor = Number(values[lojaId]) || 0;
    salvarEntrada({ data: currentDate, categoriaId: cat.id, lojaId, valor })
      .then(() => flash('Salvo'))
      .catch(err => flash(err.message || 'Erro ao salvar', 'error'));
  }

  function addCategoria() {
    const nome = prompt('Nome da nova categoria (ex: Frete, Trocas...):');
    if (!nome) return;
    const novaCat = { id: uid('c'), nome, principal: false };
    setConfig(prev => ({ ...prev, categorias: [...prev.categorias, novaCat] }));
    setCurrentCatId(novaCat.id);
  }

  function removeCategoria(catId) {
    setConfig(prev => ({ ...prev, categorias: prev.categorias.filter(c => c.id !== catId) }));
    if (currentCatId === catId) {
      const remaining = config.categorias.filter(c => c.id !== catId);
      setCurrentCatId(remaining.find(c => c.principal)?.id || remaining[0]?.id);
    }
  }

  function buildFullReport() {
    const redesVisiveis = config.redes.filter(r => r.visivel !== false);
    const parts = [];
    for (const c of config.categorias) {
      const vals = entries[dataKey(currentDate, c.id)] || {};
      const hasAny = redesVisiveis.some(r => r.lojas.some(l => vals[l.id] !== undefined && vals[l.id] !== ''));
      if (!hasAny) continue;
      const titulo = `*RELATÓRIO ${c.nome.toUpperCase()} — ${formatDatePt(currentDate)}*`;
      const lines = [titulo, ''];
      redesVisiveis.forEach(rede => {
        const lojasPreenchidas = rede.lojas.filter(l => vals[l.id] !== undefined && vals[l.id] !== '');
        if (!lojasPreenchidas.length) return;
        const ranked = rankLoja(vals, lojasPreenchidas);
        const total = ranked.reduce((s, l) => s + l.valor, 0);
        lines.push(`*${rede.nome}*   ${toBRL(total)}`);
        lines.push('');
        ranked.forEach(l => lines.push(`${l.medal} ${l.nome} ${l.emoji || ''}   ${toBRL(l.valor)}`));
        lines.push('');
      });
      parts.push(lines.join('\n'));
    }
    return parts.length ? parts.join('\n\n') : 'Nenhum dado preenchido ainda para ' + formatDatePt(currentDate) + '.';
  }

  function handleGenReport() { setReportText(buildFullReport()); }

  function handleSendEmail() {
    const texto = reportText || buildFullReport();
    if (!reportText) setReportText(texto);
    setSendingEmail(true);
    enviarRelatorioPorEmail({ texto, assunto: `Relatório ${formatDatePt(currentDate)}` })
      .then(() => flash('Relatório enviado por e-mail'))
      .catch(err => flash(err.message || 'Erro ao enviar relatório por e-mail', 'error'))
      .finally(() => setSendingEmail(false));
  }

  // gera uma aba por categoria (config.categorias), com todas as redes empilhadas
  // na mesma tabela (Rede | Posição | Loja | Valor) e uma linha de total por rede —
  // mesmo total já exibido no total-pill do card daquela rede na tela.
  function buildWorkbook() {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set();
    config.categorias.forEach(c => {
      const vals = entries[dataKey(currentDate, c.id)] || {};
      const rows = [['Rede', 'Posição', 'Loja', 'Valor']];
      config.redes.forEach(rede => {
        const ranked = rankLoja(vals, rede.lojas);
        ranked.forEach(l => rows.push([rede.nome, l.pos + 1, l.nome, l.valor]));
        const total = ranked.reduce((s, l) => s + l.valor, 0);
        rows.push([rede.nome, '', `Total ${rede.nome}`, total]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      // coluna D (Valor) como número em formato de moeda BRL, pulando o cabeçalho
      for (let r = 1; r < rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
        if (cell) cell.z = '"R$" #,##0.00';
      }
      let sheetName = sanitizeSheetName(c.nome);
      if (usedNames.has(sheetName)) {
        let i = 2;
        while (usedNames.has(`${sheetName.slice(0, 28)} ${i}`)) i++;
        sheetName = `${sheetName.slice(0, 28)} ${i}`;
      }
      usedNames.add(sheetName);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    return wb;
  }

  function handleExportExcel() {
    XLSX.writeFile(buildWorkbook(), `ranking-${currentDate}.xlsx`);
  }

  function handleCopyReport(e) {
    const ta = e.target.closest('div').parentElement.querySelector('#reportOut');
    ta.select();
    try { document.execCommand('copy'); } catch { navigator.clipboard?.writeText(ta.value); }
    setCopyShown(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyShown(false), 1500);
  }

  // atualização imediata local (feedback ao digitar) — persistência real acontece no onBlur (onBlurSaveRede)
  function updateRedeField(redeId, field, val) {
    setConfig(prev => ({ ...prev, redes: prev.redes.map(r => r.id === redeId ? { ...r, [field]: val } : r) }));
  }

  function onBlurSaveRede(redeId, field) {
    const rede = config.redes.find(r => r.id === redeId);
    if (!rede) return;
    atualizarRede(redeId, { [field]: rede[field] })
      .then(redeAtualizada => {
        setConfig(prev => ({ ...prev, redes: prev.redes.map(r => r.id === redeId ? redeAtualizada : r) }));
      })
      .catch(err => flash(err.message || 'Erro ao salvar rede', 'error'));
  }

  // ocultar/mostrar rede no grid principal e no relatório — segue a mesma filosofia
  // de onBlurSaveRede: nunca otimista, só troca o estado local depois que a API confirma.
  function toggleRedeVisivel(redeId, novoValor) {
    atualizarRede(redeId, { visivel: novoValor })
      .then(redeAtualizada => {
        setConfig(prev => ({ ...prev, redes: prev.redes.map(r => r.id === redeId ? redeAtualizada : r) }));
      })
      .catch(err => flash(err.message || 'Erro ao atualizar visibilidade da rede', 'error'));
  }

  function removeRede(redeId) {
    if (!confirm('Remover esta rede e todas as lojas dela?')) return;
    removerRede(redeId)
      .then(() => {
        setConfig(prev => ({ ...prev, redes: prev.redes.filter(r => r.id !== redeId) }));
      })
      .catch(err => flash(err.message || 'Erro ao remover rede', 'error'));
  }

  function removeLoja(redeId, lojaId) {
    removerLoja(lojaId)
      .then(() => {
        setConfig(prev => ({ ...prev, redes: prev.redes.map(r => r.id === redeId ? { ...r, lojas: r.lojas.filter(l => l.id !== lojaId) } : r) }));
      })
      .catch(err => flash(err.message || 'Erro ao remover loja', 'error'));
  }

  function addLoja(redeId, emoji, nome) {
    if (!nome.trim()) return;
    criarLoja({ redeId, nome: nome.trim(), emoji: emoji.trim() })
      .then(lojaCriada => {
        setConfig(prev => ({ ...prev, redes: prev.redes.map(r => r.id === redeId ? { ...r, lojas: [...r.lojas, lojaCriada] } : r) }));
      })
      .catch(err => flash(err.message || 'Erro ao criar loja', 'error'));
  }

  function addRede(nome, resp) {
    if (!nome.trim()) return;
    criarRede({ nome: nome.trim(), responsavel: resp.trim() })
      .then(redeCriada => {
        setConfig(prev => ({ ...prev, redes: [...prev.redes, redeCriada] }));
      })
      .catch(err => flash(err.message || 'Erro ao criar rede', 'error'));
  }

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] antialiased p-6 min-h-screen">
      <div className="max-w-[1180px] mx-auto">
        <div className="flex justify-between items-end flex-wrap gap-4 border-b border-[var(--border)] pb-[18px] mb-[22px]">
          <div>
            <div className="text-[11px] tracking-[.14em] uppercase text-[var(--teal)] font-semibold">Painel de Ranking · Vendas</div>
            <h1 className="font-display text-[34px] font-extrabold mt-0.5 leading-none">Placar do dia</h1>
          </div>
          <div className="flex gap-2.5 items-center">
            <input
              type="date"
              value={currentDate}
              onChange={e => setCurrentDate(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm"
            />
            {isAdmin ? (
              <button className={btnGhost} onClick={() => setCurrentView(v => v === 'config' ? 'report' : 'config')}>
                {currentView === 'config' ? '← Voltar ao relatório' : '⚙ Configurar redes/lojas'}
              </button>
            ) : null}
          </div>
        </div>

        {loadingConfig ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>
        ) : configError ? (
          <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
            <span>Não foi possível carregar os dados do servidor: {configError}</span>
            <button className={btnGhost} onClick={loadConfig}>Tentar novamente</button>
          </div>
        ) : !cat ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>
        ) : (
          <>
            {entriesError && currentView === 'report' && (
              <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-3 text-[13px] mb-4">
                Não foi possível carregar as entradas desta categoria/data: {entriesError}
              </div>
            )}
            {currentView === 'config'
              ? <ConfigView config={config} updateRedeField={updateRedeField} onBlurSaveRede={onBlurSaveRede} removeRede={removeRede} removeLoja={removeLoja} addLoja={addLoja} addRede={addRede} removeCategoria={removeCategoria} isAdmin={isAdmin} toggleRedeVisivel={toggleRedeVisivel} />
              : (
                <ReportView
                  config={config} cat={cat} values={values} setValue={setValue} onBlurSave={onBlurSave}
                  currentCatId={currentCatId} setCurrentCatId={setCurrentCatId} addCategoria={addCategoria}
                  currentDate={currentDate} handleGenReport={handleGenReport} handleCopyReport={handleCopyReport}
                  reportText={reportText} copyShown={copyShown} handleExportExcel={handleExportExcel}
                  handleSendEmail={handleSendEmail} sendingEmail={sendingEmail}
                  isAdmin={isAdmin} toggleRedeVisivel={toggleRedeVisivel}
                />
              )}
          </>
        )}
      </div>

      <div
        className={`fixed bottom-5 right-5 max-w-[360px] px-4 py-2 rounded-lg text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)]'
            : 'bg-[var(--teal)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}

function ReportView({ config, cat, values, setValue, onBlurSave, setCurrentCatId, addCategoria, currentDate, handleGenReport, handleCopyReport, reportText, copyShown, handleExportExcel, handleSendEmail, sendingEmail, isAdmin, toggleRedeVisivel }) {
  const redesVisiveis = config.redes.filter(r => r.visivel !== false);
  return (
    <div>
      <div className="flex gap-1.5 mb-5 flex-wrap items-center">
        {config.categorias.map(c => (
          <div
            key={c.id}
            onClick={() => setCurrentCatId(c.id)}
            className={`px-[18px] py-2 rounded-full text-[13px] font-semibold cursor-pointer transition-[.15s] border ${
              c.id === cat.id
                ? 'bg-[var(--teal)] text-[#0b1010] border-[var(--teal)]'
                : 'bg-[var(--panel)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[#3a4150]'
            }`}
          >
            {c.nome}
          </div>
        ))}
        <div
          onClick={addCategoria}
          title="Nova categoria"
          className="bg-transparent border border-dashed border-[var(--border)] text-[var(--muted)] w-[34px] h-[34px] rounded-full cursor-pointer text-base leading-none flex items-center justify-center hover:text-[var(--text)] hover:border-[var(--teal)]"
        >
          +
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[18px]">
        {redesVisiveis.map(rede => {
          const ranked = rankLoja(values, rede.lojas);
          const total = ranked.reduce((s, l) => s + l.valor, 0);
          return (
            <div className={card} key={rede.id}>
              <div className="flex justify-between items-baseline mb-3.5">
                <h2 className="font-display text-[22px] font-bold m-0">{rede.nome}</h2>
                <div className="flex items-center gap-2">
                  <div className="text-xl font-bold text-[var(--teal)] bg-[var(--teal)]/10 px-3.5 py-1 rounded-lg">{toBRL(total)}</div>
                  {isAdmin ? (
                    <button
                      className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3 py-1.5 text-[12px] font-bold cursor-pointer hover:brightness-110"
                      onClick={() => toggleRedeVisivel(rede.id, false)}
                    >
                      Ocultar
                    </button>
                  ) : null}
                </div>
              </div>
              {ranked.length
                ? ranked.map(l => (
                  <div
                    key={l.id}
                    className={`flex items-center gap-3 px-2.5 py-2.5 rounded-[9px] mb-1.5 ${
                      l.pos === 0
                        ? 'bg-gradient-to-r from-[var(--gold)]/[.16] to-[var(--gold)]/[.03]'
                        : l.pos === 1
                          ? 'bg-gradient-to-r from-[var(--silver)]/[.14] to-[var(--silver)]/[.03]'
                          : 'bg-[var(--panel-alt)]'
                    }`}
                  >
                    <div className={`font-display w-[30px] text-center text-xl font-bold flex-shrink-0 ${l.pos === 0 ? 'text-[var(--gold)]' : l.pos === 1 ? 'text-[var(--silver)]' : 'text-[var(--muted)]'}`}>{l.pos + 1}</div>
                    <div className="text-base w-[22px] text-center flex-shrink-0">{l.medal}</div>
                    <div className="text-base w-5 text-center flex-shrink-0">{l.emoji || ''}</div>
                    <div className="flex-1 text-[14.5px] font-semibold">{l.nome}</div>
                    <input
                      type="number" step="0.01" value={values[l.id] ?? ''} placeholder="0,00"
                      onChange={e => setValue(l.id, e.target.value)} onBlur={() => onBlurSave(l.id)}
                      className="font-display w-[130px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-base text-right font-semibold focus:outline-none focus:border-[var(--teal)] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                    />
                  </div>
                ))
                : <div className="text-[var(--muted)] text-[13px] px-1 py-2">Nenhuma loja cadastrada nesta rede ainda.</div>
              }
            </div>
          );
        })}
      </div>

      <div className={`${card} mt-[18px]`}>
        <div className="mb-3.5"><h2 className="font-display text-[22px] font-bold m-0">Relatório para envio</h2></div>
        <div className="text-[11px] tracking-[.08em] uppercase text-[var(--muted)] font-semibold mb-2">
          Gera o texto com todas as categorias já preenchidas em {formatDatePt(currentDate)} — pronto pra colar no WhatsApp
        </div>
        <div className="flex gap-2.5 my-3.5 items-center">
          <button className={btn} onClick={handleGenReport}>Gerar relatório do dia</button>
          <button className={btnGhost} onClick={handleExportExcel}>Baixar Excel</button>
          <button className={btnGhost} onClick={handleCopyReport}>Copiar</button>
          <button className={btnGhost} onClick={handleSendEmail} disabled={sendingEmail}>
            {sendingEmail ? 'Enviando...' : 'Enviar por e-mail'}
          </button>
          <span className={`text-[13px] text-[var(--teal)] transition-opacity duration-200 ${copyShown ? 'opacity-100' : 'opacity-0'}`}>Copiado ✓</span>
        </div>
        <textarea
          id="reportOut" readOnly value={reportText}
          placeholder='Clique em "Gerar relatório do dia" para montar o texto...'
          className="w-full min-h-[420px] bg-[#0b0d11] border border-[var(--border)] text-[var(--text)] rounded-[10px] p-4 font-mono text-[13.5px] leading-[1.55] resize-y"
        />
      </div>
    </div>
  );
}

function ConfigView({ config, updateRedeField, onBlurSaveRede, removeRede, removeLoja, addLoja, addRede, removeCategoria, isAdmin, toggleRedeVisivel }) {
  const [newRedeNome, setNewRedeNome] = useState('');
  const [newRedeResp, setNewRedeResp] = useState('');
  const [lojaDrafts, setLojaDrafts] = useState({});
  const draftFor = (redeId) => lojaDrafts[redeId] || { emoji: '', nome: '' };
  const setDraft = (redeId, field, val) => setLojaDrafts(prev => ({ ...prev, [redeId]: { ...draftFor(redeId), [field]: val } }));

  return (
    <div>
      <div className="mb-[22px]">
        <h3 className="font-display text-[19px] mb-3 font-bold">Redes e lojas</h3>
        {config.redes.map(rede => (
          <div key={rede.id} className="border border-[var(--border)] rounded-xl px-4 py-3.5 mb-3 bg-[var(--panel-alt)]">
            <div className="flex gap-2.5 items-center mb-2.5">
              <input
                value={rede.nome} onChange={e => updateRedeField(rede.id, 'nome', e.target.value)}
                onBlur={() => onBlurSaveRede(rede.id, 'nome')}
                className="font-display bg-transparent border-none border-b border-[var(--border)] text-[var(--text)] text-[19px] font-bold px-1 py-0.5 flex-1 focus:outline-none focus:border-[var(--teal)]"
              />
              <input
                value={rede.responsavel || ''} placeholder="Responsável" onChange={e => updateRedeField(rede.id, 'responsavel', e.target.value)}
                onBlur={() => onBlurSaveRede(rede.id, 'responsavel')}
                className="text-[12.5px] font-medium text-[var(--muted)] flex-none w-40 text-right bg-transparent border-none border-b border-[var(--border)] focus:outline-none focus:border-[var(--teal)]"
              />
              {rede.visivel === false ? <span className="text-[12px] text-[var(--muted)] font-semibold">(oculta do relatório)</span> : null}
              {isAdmin ? (
                <button
                  className={btnGhost + ' ml-auto'}
                  onClick={() => toggleRedeVisivel(rede.id, rede.visivel === false ? true : false)}
                >
                  {rede.visivel === false ? 'Mostrar' : 'Ocultar'}
                </button>
              ) : null}
              <button className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110" onClick={() => removeRede(rede.id)}>Remover rede</button>
            </div>

            <div className="flex flex-wrap">
              {rede.lojas.length
                ? rede.lojas.map(l => (
                  <span key={l.id} className="inline-flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-full pl-3 pr-1.5 py-1 mr-1 mb-1 text-[13px]">
                    {l.emoji || ''} {l.nome}
                    <button onClick={() => removeLoja(rede.id, l.id)} className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-full w-[18px] h-[18px] text-[11px] cursor-pointer leading-none">✕</button>
                  </span>
                ))
                : <span className="text-[var(--muted)] text-[13px]">Nenhuma loja ainda</span>
              }
            </div>

            <div className="flex gap-1.5 mt-2 flex-wrap">
              <input
                placeholder="🏆" maxLength={2} value={draftFor(rede.id).emoji} onChange={e => setDraft(rede.id, 'emoji', e.target.value)}
                className="w-11 text-center bg-[#12151b] border border-[var(--border)] text-[var(--text)] rounded-lg px-2.5 py-1.5 text-[13px]"
              />
              <input
                placeholder="Nome da loja" value={draftFor(rede.id).nome} onChange={e => setDraft(rede.id, 'nome', e.target.value)}
                className="w-[130px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] rounded-lg px-2.5 py-1.5 text-[13px]"
              />
              <button
                className={btn}
                onClick={() => { const d = draftFor(rede.id); addLoja(rede.id, d.emoji, d.nome); setLojaDrafts(prev => ({ ...prev, [rede.id]: { emoji: '', nome: '' } })); }}
              >
                Adicionar loja
              </button>
            </div>
          </div>
        ))}

        <div className="flex gap-2 mt-1">
          <input placeholder="Nome da rede (ex: Rede Fulano)" value={newRedeNome} onChange={e => setNewRedeNome(e.target.value)}
            className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Responsável" value={newRedeResp} onChange={e => setNewRedeResp(e.target.value)}
            className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm" />
          <button className={btn} onClick={() => { addRede(newRedeNome, newRedeResp); setNewRedeNome(''); setNewRedeResp(''); }}>Adicionar rede</button>
        </div>
      </div>

      <div>
        <h3 className="font-display text-[19px] mb-3 font-bold">Categorias de relatório</h3>
        {config.categorias.map(c => (
          <div key={c.id} className="inline-flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-full pl-4 pr-2 py-2 mr-1 mb-1 text-[13px]">
            {c.nome} {c.principal ? <span className="text-[var(--teal)] text-[11px]">(principal)</span> : null}
            {config.categorias.length > 1
              ? <button onClick={() => removeCategoria(c.id)} className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-full w-[18px] h-[18px] text-[11px] cursor-pointer leading-none">✕</button>
              : null}
          </div>
        ))}
      </div>
    </div>
  );
}
