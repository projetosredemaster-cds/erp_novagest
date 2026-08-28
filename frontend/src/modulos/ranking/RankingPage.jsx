import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchCategorias, fetchEntradas, salvarEntrada, removerEntrada,
  criarCategoria, atualizarCategoria, removerCategoria,
  enviarRelatorioPorEmail,
} from './rankingApi';
import {
  fetchDiretores,
  criarDiretor, atualizarDiretor, removerDiretor,
  criarRede, atualizarRede, removerRede,
} from '../../lib/cadastrosApi';
import { useAuth } from '../../app/useAuth.js';
import ConfigView from './ConfigView.jsx';

const emptyState = () => ({ diretores: [], categorias: [] });

function toBRL(n) {
  n = Number(n) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseValorBR(texto) {
  let s = String(texto ?? '').trim();
  if (!s) return 0;
  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');
  if (temPonto && temVirgula) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function extrairDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}
function formatarDigitosBR(digitos) {
  if (!digitos) return '';
  const n = parseInt(digitos, 10) || 0;
  const centavos = String(n % 100).padStart(2, '0');
  const inteiro = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${centavos}`;
}
function digitosParaValor(digitos) {
  if (!digitos) return '';
  return (parseInt(digitos, 10) || 0) / 100;
}
function valorParaDigitos(valor) {
  if (valor === '' || valor === undefined || valor === null) return '';
  const n = Math.round(Number(valor) * 100);
  return Number.isFinite(n) ? String(n) : '';
}
function moveCaretToEnd(el) {
  requestAnimationFrame(() => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}
function formatDatePt(iso) {
  const [, m, d] = iso.split('-');
  return d + '/' + m;
}
function dataKey(date, catId) { return date + '|' + catId; }
function fetchAllEntradas(date, categorias) {
  return Promise.all(
    categorias.map(c =>
      fetchEntradas(date, c.id).then(lista => ({ catId: c.id, lista }))
    )
  );
}
function mergeEntradasResults(prev, results, date, protect) {
  const next = { ...prev };
  results.forEach(({ catId, lista }) => {
    const vals = {};
    (lista || []).forEach(e => { vals[e.rede_id] = e.valor; });
    const key = dataKey(date, catId);
    if (protect && protect.redeId != null && protect.catId === catId) {
      const localVals = prev[key] || {};
      if (Object.prototype.hasOwnProperty.call(localVals, protect.redeId)) {
        vals[protect.redeId] = localVals[protect.redeId];
      }
    }
    next[key] = vals;
  });
  return next;
}
const ORDEM_RELATORIO = ['Receita Bruta', 'Correção', 'Acessórios'];
function normalizeNomeCategoria(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
const ORDEM_RELATORIO_NORMALIZADA = ORDEM_RELATORIO.map(normalizeNomeCategoria);
function prioridadeCategoria(nome) {
  const idx = ORDEM_RELATORIO_NORMALIZADA.indexOf(normalizeNomeCategoria(nome));
  return idx === -1 ? Infinity : idx;
}
function sanitizeSheetName(nome) {
  const cleaned = String(nome).replace(/[/\\?*[\]:]/g, '').trim();
  return (cleaned || 'Categoria').slice(0, 31);
}
function rankRede(values, redes) {
  const withVal = redes.map(r => ({ ...r, valor: Number(values[r.id]) || 0 }));
  withVal.sort((a, b) => b.valor - a.valor);
  return withVal.map((r, i) => ({ ...r, pos: i, medal: i === 0 ? '🥇' : (i === 1 ? '🥈' : '🍍') }));
}

const btn = "bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-2.5 min-h-11 lg:py-1.5 lg:min-h-0 text-[13px] font-bold cursor-pointer hover:brightness-110";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 min-h-11 lg:py-1.5 lg:min-h-0 text-[13px] font-bold cursor-pointer hover:brightness-110";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-3 pt-4 pb-4 sm:px-5 sm:pt-5 sm:pb-[22px]";

export default function RankingPage() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState(emptyState);
  const [entries, setEntries] = useState({});
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currentCatId, setCurrentCatId] = useState(null);
  const currentView = window.location.pathname === '/ranking/configuracoes' ? 'config' : 'report';
  const [reportText, setReportText] = useState('');
  const [copyShown, setCopyShown] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);
  const copyTimer = useRef(null);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState(null);
  const [entriesError, setEntriesError] = useState(null);

  function runLoadConfig() {
    Promise.all([fetchDiretores(), fetchCategorias()])
      .then(([diretores, categorias]) => {
        setConfig({ diretores: diretores || [], categorias: categorias || [] });
      })
      .catch(err => {
        setConfigError(err.message || 'Erro ao carregar dados do servidor.');
      })
      .finally(() => setLoadingConfig(false));
  }

  function loadConfig() {
    setLoadingConfig(true);
    setConfigError(null);
    runLoadConfig();
  }

  useEffect(() => {
    runLoadConfig();
  }, []);

  const categoriasVisiveis = useMemo(
    () => config.categorias.filter(c => c.visivel !== false),
    [config.categorias]
  );

  const cat = useMemo(() => (
    categoriasVisiveis.find(c => c.id === currentCatId)
    || categoriasVisiveis.find(c => c.principal)
    || categoriasVisiveis[0]
  ), [categoriasVisiveis, currentCatId]);

  useEffect(() => {
    if (!config.categorias.length) return;
    let cancelled = false;
    fetchAllEntradas(currentDate, config.categorias)
      .then(results => {
        if (cancelled) return;
        setEntries(prev => mergeEntradasResults(prev, results, currentDate));
        setEntriesError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setEntriesError(err.message || 'Erro ao carregar entradas.');
      });
    return () => { cancelled = true; };
  }, [currentDate, config.categorias]);

  const [focusedRedeId, setFocusedRedeId] = useState(null);
  const catRef = useRef(cat);
  useEffect(() => { catRef.current = cat; }, [cat]);
  const focusedRedeIdRef = useRef(focusedRedeId);
  useEffect(() => { focusedRedeIdRef.current = focusedRedeId; }, [focusedRedeId]);

  useEffect(() => {
    if (currentView !== 'report' || !config.categorias.length) return;

    let intervalId = null;

    function poll() {
      fetchAllEntradas(currentDate, config.categorias)
        .then(results => {
          setEntries(prev => mergeEntradasResults(prev, results, currentDate, {
            catId: catRef.current?.id,
            redeId: focusedRedeIdRef.current,
          }));
        })
        .catch(() => {
        });
    }

    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(poll, 5000);
    }
    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function handleVisibilityChange() {
      if (document.hidden) stopPolling();
      else startPolling();
    }

    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentDate, config.categorias, currentView]);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1400);
  }

  const values = cat ? (entries[dataKey(currentDate, cat.id)] || {}) : {};

  function setValue(redeId, val) {
    if (!cat) return;
    const k = dataKey(currentDate, cat.id);
    setEntries(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [redeId]: val } }));
  }

  function onBlurSave(redeId) {
    if (!cat) return;
    const valor = parseValorBR(values[redeId]);
    setValue(redeId, valor);
    if (valor === 0) {
      removerEntrada({ data: currentDate, categoriaId: cat.id, redeId })
        .then(() => flash('Salvo'))
        .catch(err => flash(err.message || 'Erro ao salvar', 'error'));
      return;
    }
    salvarEntrada({ data: currentDate, categoriaId: cat.id, redeId, valor })
      .then(() => flash('Salvo'))
      .catch(err => flash(err.message || 'Erro ao salvar', 'error'));
  }

  function handleValueFocus(redeId) {
    setFocusedRedeId(redeId);
  }
  function handleValueBlur(redeId) {
    onBlurSave(redeId);
    setFocusedRedeId(null);
  }

  function addCategoria(nome) {
    const nomeFinal = (nome ?? prompt('Nome da nova categoria (ex: Frete, Trocas...):') ?? '').trim();
    if (!nomeFinal) return;
    criarCategoria({ nome: nomeFinal })
      .then(categoriaCriada => {
        setConfig(prev => ({ ...prev, categorias: [...prev.categorias, categoriaCriada] }));
        setCurrentCatId(categoriaCriada.id);
      })
      .catch(err => flash(err.message || 'Erro ao criar categoria', 'error'));
  }

  function updateCategoriaVisivel(catId, novoValor) {
    atualizarCategoria(catId, { visivel: novoValor })
      .then(categoriaAtualizada => {
        setConfig(prev => ({ ...prev, categorias: prev.categorias.map(c => (c.id === catId ? categoriaAtualizada : c)) }));
      })
      .catch(err => flash(err.message || 'Erro ao atualizar categoria', 'error'));
  }

  function removeCategoria(catId) {
    removerCategoria(catId)
      .then(() => {
        setConfig(prev => ({ ...prev, categorias: prev.categorias.filter(c => c.id !== catId) }));
        if (currentCatId === catId) setCurrentCatId(null);
      })
      .catch(err => flash(err.message || 'Erro ao remover categoria', 'error'));
  }

  function buildFullReport() {
    const parts = [];
    const categoriasOrdenadas = config.categorias
      .map((c, index) => ({ c, index }))
      .sort((a, b) => {
        const diff = prioridadeCategoria(a.c.nome) - prioridadeCategoria(b.c.nome);
        return diff !== 0 ? diff : a.index - b.index;
      })
      .map(({ c }) => c);
    for (const c of categoriasOrdenadas) {
      const vals = entries[dataKey(currentDate, c.id)] || {};
      const hasAny = config.diretores.some(d => d.redes.some(r => r.ativo !== false && r.visivel !== false && vals[r.id] !== undefined && vals[r.id] !== ''));
      if (!hasAny) continue;
      const titulo = `*RELATÓRIO ${c.nome.toUpperCase()} — ${formatDatePt(currentDate)}*`;
      const lines = [titulo, ''];
      const diretoresComTotal = config.diretores.map(diretor => {
        const redesVisiveis = diretor.redes.filter(r => r.ativo !== false && r.visivel !== false);
        const ranked = rankRede(vals, redesVisiveis);
        const total = ranked.reduce((s, r) => s + r.valor, 0);
        return { diretor, ranked, total };
      });
      diretoresComTotal.sort((a, b) => b.total - a.total);
      diretoresComTotal.forEach(({ diretor, ranked, total }) => {
        lines.push(`*${diretor.nome}*   ${toBRL(total)}`);
        lines.push('');
        ranked.forEach(r => lines.push(`${r.medal} ${r.nome} ${r.emoji || ''}   ${toBRL(r.valor)}`));
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
  function buildWorkbook() {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set();
    config.categorias.forEach(c => {
      const vals = entries[dataKey(currentDate, c.id)] || {};
      const rows = [['Diretor', 'Posição', 'Rede', 'Valor']];
      config.diretores.forEach(diretor => {
        const ranked = rankRede(vals, diretor.redes);
        ranked.forEach(r => rows.push([diretor.nome, r.pos + 1, r.nome, r.valor]));
        const total = ranked.reduce((s, r) => s + r.valor, 0);
        rows.push([diretor.nome, '', `Total ${diretor.nome}`, total]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
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

  function updateRedeCampo(redeId, patch, fallbackMsg = 'Erro ao atualizar rede') {
    atualizarRede(redeId, patch)
      .then(redeAtualizada => {
        setConfig(prev => ({
          ...prev,
          diretores: prev.diretores.map(d => d.id === redeAtualizada.diretor_id
            ? { ...d, redes: d.redes.map(r => r.id === redeId ? redeAtualizada : r) }
            : d),
        }));
      })
      .catch(err => flash(err.message || fallbackMsg, 'error'));
  }

  function toggleRedeVisivel(redeId, novoValor) {
    updateRedeCampo(redeId, { visivel: novoValor }, 'Erro ao atualizar visibilidade da rede');
  }

  function toggleRedeAtivo(redeId, novoValor) {
    updateRedeCampo(redeId, { ativo: novoValor }, 'Erro ao atualizar status da rede');
  }

  function updateRedeResponsavel(redeId, responsavelId) {
    updateRedeCampo(redeId, { responsavelId }, 'Erro ao atualizar GG da rede');
  }

  function updateRedeNome(redeId, nome) {
    if (!nome.trim()) return;
    updateRedeCampo(redeId, { nome: nome.trim() }, 'Erro ao atualizar nome da rede');
  }

  function updateRedeEmoji(redeId, emoji) {
    updateRedeCampo(redeId, { emoji: emoji.trim() }, 'Erro ao atualizar emoji da rede');
  }

  function updateRedeDiretor(redeId, diretorId) {
    atualizarRede(redeId, { diretorId })
      .then(redeAtualizada => {
        setConfig(prev => ({
          ...prev,
          diretores: prev.diretores.map(d => {
            if (d.id === redeAtualizada.diretor_id) {
              const jaTinha = d.redes.some(r => r.id === redeId);
              return { ...d, redes: jaTinha ? d.redes.map(r => (r.id === redeId ? redeAtualizada : r)) : [...d.redes, redeAtualizada] };
            }
            return { ...d, redes: d.redes.filter(r => r.id !== redeId) };
          }),
        }));
      })
      .catch(err => flash(err.message || 'Erro ao mover rede de diretor', 'error'));
  }

  function removeRede(diretorId, redeId) {
    removerRede(redeId)
      .then(() => {
        setConfig(prev => ({
          ...prev,
          diretores: prev.diretores.map(d => d.id === diretorId ? { ...d, redes: d.redes.filter(r => r.id !== redeId) } : d),
        }));
      })
      .catch(err => flash(err.message || 'Erro ao remover rede', 'error'));
  }

  function addRede(diretorId, emoji, nome) {
    if (!nome.trim() || !diretorId) return;
    criarRede({ diretorId: Number(diretorId), nome: nome.trim(), emoji: emoji.trim() })
      .then(redeCriada => {
        setConfig(prev => ({
          ...prev,
          diretores: prev.diretores.map(d => d.id === redeCriada.diretor_id ? { ...d, redes: [...d.redes, redeCriada] } : d),
        }));
      })
      .catch(err => flash(err.message || 'Erro ao criar rede', 'error'));
  }

  function updateDiretorNome(diretorId, nome) {
    if (!nome.trim()) return;
    atualizarDiretor(diretorId, { nome: nome.trim() })
      .then(diretorAtualizado => {
        setConfig(prev => ({ ...prev, diretores: prev.diretores.map(d => d.id === diretorId ? diretorAtualizado : d) }));
      })
      .catch(err => flash(err.message || 'Erro ao atualizar diretor', 'error'));
  }

  function removeDiretor(diretorId) {
    if (!confirm('Remover este diretor e todas as redes dele?')) return;
    removerDiretor(diretorId)
      .then(() => {
        setConfig(prev => ({ ...prev, diretores: prev.diretores.filter(d => d.id !== diretorId) }));
      })
      .catch(err => flash(err.message || 'Erro ao remover diretor', 'error'));
  }

  function addDiretor(nome) {
    if (!nome.trim()) return;
    criarDiretor({ nome: nome.trim() })
      .then(diretorCriado => {
        setConfig(prev => ({ ...prev, diretores: [...prev.diretores, diretorCriado] }));
      })
      .catch(err => flash(err.message || 'Erro ao criar diretor', 'error'));
  }

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] antialiased p-3 sm:p-6 min-h-screen">
      <div className="max-w-[1180px] mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end flex-wrap gap-4 border-b border-[var(--border)] pb-[18px] mb-[22px]">
          <div>
            <div className="text-[11px] tracking-[.14em] uppercase text-[var(--teal)] font-semibold">Painel de Ranking · Vendas</div>
            <h1 className="font-display text-[26px] sm:text-[34px] font-extrabold mt-0.5 leading-none">Placar do dia</h1>
          </div>
          <div className="flex gap-2.5 items-center w-full sm:w-auto">
            <input
              type="date"
              value={currentDate}
              onChange={e => setCurrentDate(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm w-full sm:w-auto min-h-11 lg:min-h-0"
            />
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
              ? (
                <ConfigView
                  config={config}
                  removeDiretor={removeDiretor} addDiretor={addDiretor} updateDiretorNome={updateDiretorNome}
                  removeRede={removeRede} addRede={addRede}
                  updateRedeNome={updateRedeNome} updateRedeEmoji={updateRedeEmoji}
                  addCategoria={addCategoria} updateCategoriaVisivel={updateCategoriaVisivel} removeCategoria={removeCategoria}
                  isAdmin={isAdmin}
                  toggleRedeVisivel={toggleRedeVisivel} toggleRedeAtivo={toggleRedeAtivo}
                  updateRedeResponsavel={updateRedeResponsavel} updateRedeDiretor={updateRedeDiretor}
                  flash={flash}
                />
              )
              : (
                <ReportView
                  config={config} categoriasVisiveis={categoriasVisiveis}
                  cat={cat} values={values} setValue={setValue} onBlurSave={handleValueBlur}
                  onFocusValue={handleValueFocus}
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
        className={`fixed bottom-5 right-5 max-w-[calc(100vw-2.5rem)] sm:max-w-[360px] px-4 py-2 rounded-lg text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
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

function ReportView({ config, categoriasVisiveis, cat, values, setValue, onBlurSave, onFocusValue, setCurrentCatId, addCategoria, currentDate, handleGenReport, handleCopyReport, reportText, copyShown, handleExportExcel, handleSendEmail, sendingEmail, isAdmin, toggleRedeVisivel }) {
  return (
    <div>
      <div className="flex gap-1.5 mb-5 flex-wrap items-center">
        {categoriasVisiveis.map(c => (
          <div
            key={c.id}
            onClick={() => setCurrentCatId(c.id)}
            className={`px-[18px] py-3 lg:py-2 min-h-11 lg:min-h-0 flex items-center rounded-full text-[13px] font-semibold cursor-pointer transition-[.15s] border ${
              c.id === cat.id
                ? 'bg-[var(--teal)] text-[#0b1010] border-[var(--teal)]'
                : 'bg-[var(--panel)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[#3a4150]'
            }`}
          >
            {c.nome}
          </div>
        ))}
        <div
          onClick={() => addCategoria()}
          title="Nova categoria"
          className="bg-transparent border border-dashed border-[var(--border)] text-[var(--muted)] w-11 h-11 lg:w-[34px] lg:h-[34px] rounded-full cursor-pointer text-base leading-none flex items-center justify-center hover:text-[var(--text)] hover:border-[var(--teal)]"
        >
          +
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-[18px]">
        {config.diretores.map(diretor => {
          const redesRankeaveis = diretor.redes.filter(r => r.ativo !== false && r.visivel !== false);
          const ranked = rankRede(values, redesRankeaveis);
          const total = ranked.reduce((s, r) => s + r.valor, 0);
          return (
            <div className={card} key={diretor.id}>
              <div className="flex flex-wrap justify-between items-baseline gap-2 mb-3.5">
                <h2 className="font-display text-[19px] sm:text-[22px] font-bold m-0">{diretor.nome}</h2>
                <div className="text-lg sm:text-xl font-bold text-[var(--teal)] bg-[var(--teal)]/10 px-3.5 py-1 rounded-lg">{toBRL(total)}</div>
              </div>
              {ranked.length
                ? ranked.map(r => (
                  <div
                    key={r.id}
                    className={`flex flex-wrap lg:flex-nowrap items-center gap-2 lg:gap-3 px-2.5 py-2.5 rounded-[9px] mb-1.5 ${
                      r.pos === 0
                        ? 'bg-gradient-to-r from-[var(--gold)]/[.16] to-[var(--gold)]/[.03]'
                        : r.pos === 1
                          ? 'bg-gradient-to-r from-[var(--silver)]/[.14] to-[var(--silver)]/[.03]'
                          : 'bg-[var(--panel-alt)]'
                    }`}
                  >
                    <div className={`font-display w-[30px] text-center text-xl font-bold flex-shrink-0 ${r.pos === 0 ? 'text-[var(--gold)]' : r.pos === 1 ? 'text-[var(--silver)]' : 'text-[var(--muted)]'}`}>{r.pos + 1}</div>
                    <div className="text-base w-[22px] text-center flex-shrink-0">{r.medal}</div>
                    <div className="text-base w-5 text-center flex-shrink-0">{r.emoji || ''}</div>
                    <div className="flex-1 min-w-[110px] lg:min-w-0 text-[14.5px] font-semibold">{r.nome}</div>
                    <input
                      type="text" inputMode="decimal" value={formatarDigitosBR(valorParaDigitos(values[r.id]))} placeholder="0,00"
                      onChange={e => {
                        setValue(r.id, digitosParaValor(extrairDigitos(e.target.value)));
                        moveCaretToEnd(e.target);
                      }}
                      onKeyDown={e => {
                        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                        e.preventDefault();
                        const digitos = valorParaDigitos(values[r.id]);
                        setValue(r.id, digitosParaValor(digitos.slice(0, -1)));
                        moveCaretToEnd(e.target);
                      }}
                      onPaste={e => {
                        e.preventDefault();
                        setValue(r.id, parseValorBR(e.clipboardData.getData('text')));
                        moveCaretToEnd(e.target);
                      }}
                      onFocus={() => onFocusValue(r.id)} onBlur={() => onBlurSave(r.id)}
                      className="font-display w-[130px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-base text-right font-semibold focus:outline-none focus:border-[var(--teal)]"
                    />
                    {isAdmin ? (
                      <button
                        className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-2.5 py-2.5 lg:py-1.5 min-h-11 lg:min-h-0 text-[12px] font-bold cursor-pointer hover:brightness-110 flex-shrink-0"
                        onClick={() => toggleRedeVisivel(r.id, false)}
                      >
                        Ocultar
                      </button>
                    ) : null}
                  </div>
                ))
                : <div className="text-[var(--muted)] text-[13px] px-1 py-2">Nenhuma rede cadastrada neste diretor ainda.</div>
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
        <div className="flex flex-wrap gap-2.5 my-3.5 items-center">
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
          className="w-full min-h-[260px] max-h-[60vh] overflow-y-auto lg:max-h-none lg:min-h-[420px] bg-[#0b0d11] border border-[var(--border)] text-[var(--text)] rounded-[10px] p-4 font-mono text-[13.5px] leading-[1.55] resize-y whitespace-pre-wrap break-words"
        />
      </div>
    </div>
  );
}

