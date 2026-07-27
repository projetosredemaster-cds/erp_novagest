// style-system: Tailwind
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchCategorias, fetchEntradas, salvarEntrada, removerEntrada,
  enviarRelatorioPorEmail,
} from './rankingApi';
import {
  fetchDiretores,
  criarDiretor, atualizarDiretor, removerDiretor,
  criarRede, atualizarRede, removerRede,
  fetchResponsaveis, criarResponsavel, removerResponsavel,
} from '../../lib/cadastrosApi';
import { useAuth } from '../../app/AuthContext.jsx';

// estado inicial vazio: diretores/categorias agora vêm da API (ver useEffect de carga em RankingPage)
// hierarquia: Diretor -> Rede (o Ranking não opera no nível Loja física, ver CLAUDE.md/CONTRATO-RANKING-API.md)
const emptyState = () => ({ diretores: [], categorias: [] });

function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }
function toBRL(n) {
  n = Number(n) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// interpreta texto digitado/colado no formato brasileiro (ex: "1.730,00" ou "1730,5")
// como número — inputs de valor são type="text" justamente para não deixar o navegador
// truncar a vírgula decimal como faria um type="number" nativo.
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
// máscara monetária ao vivo (estilo app bancário): dígitos digitados são tratados da
// direita pra esquerda como centavos — "173000" digitado vira "1.730,00" exibido.
// extrai só os dígitos (0-9) de um texto — usado a cada tecla pra achar a base em centavos
function extrairDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}
// formata a base de dígitos (centavos) no padrão BR: "173000" -> "1.730,00"
function formatarDigitosBR(digitos) {
  if (!digitos) return '';
  const n = parseInt(digitos, 10) || 0;
  const centavos = String(n % 100).padStart(2, '0');
  const inteiro = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${centavos}`;
}
// base de dígitos -> valor float guardado em `entries` (nunca a string formatada); base
// vazia representa campo vazio, não zero — preserva a distinção "nunca digitado" vs "digitou 0"
function digitosParaValor(digitos) {
  if (!digitos) return '';
  return (parseInt(digitos, 10) || 0) / 100;
}
// caminho inverso: reconstrói a base de dígitos a partir do valor float em `entries` —
// usado a cada render pra formatar o input e pelo backspace pra saber o que remover
function valorParaDigitos(valor) {
  if (valor === '' || valor === undefined || valor === null) return '';
  const n = Math.round(Number(valor) * 100);
  return Number.isFinite(n) ? String(n) : '';
}
// força o cursor pro final do campo após a formatação reescrever o texto — mantém o
// comportamento "digita da direita pra esquerda" de uma máscara de app bancário
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
// busca as entradas de TODAS as categorias em paralelo — reutilizada tanto pelo fetch
// inicial (ao trocar de data/carregar categorias) quanto pelo polling de sincronização
// multi-usuário (ver useEffect de polling em RankingPage). Não conhece estado do
// componente; recebe tudo por parâmetro para poder ficar fora do componente.
function fetchAllEntradas(date, categorias) {
  return Promise.all(
    categorias.map(c =>
      fetchEntradas(date, c.id).then(lista => ({ catId: c.id, lista }))
    )
  );
}
// funde o resultado de fetchAllEntradas no estado `entries` existente. `protect`
// (opcional, { catId, redeId }) evita sobrescrever, na categoria indicada, o valor da
// rede indicada — usado só pelo polling em background pra não sobrescrever o input que
// o usuário está editando neste exato momento; o fetch inicial ao trocar de data não
// passa `protect` e sobrescreve tudo, como sempre fez.
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
// ordem fixa de exibição no relatório gerado (buildFullReport) — não afeta a ordem
// das abas na tela nem config.categorias em si. Comparação é insensível a acento/caixa
// para tolerar pequenas divergências de digitação no cadastro da categoria.
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
// nomes de aba do Excel: máx. 31 caracteres, sem / \ ? * [ ] :
function sanitizeSheetName(nome) {
  const cleaned = String(nome).replace(/[/\\?*[\]:]/g, '').trim();
  return (cleaned || 'Categoria').slice(0, 31);
}
// ordena as redes (Delta, Lendários...) de um diretor por valor lançado e atribui
// posição/medalha — mesma lógica de antes (quando operava sobre lojas de uma rede),
// só que agora opera um nível acima na hierarquia Diretor -> Rede.
function rankRede(values, redes) {
  const withVal = redes.map(r => ({ ...r, valor: Number(values[r.id]) || 0 }));
  withVal.sort((a, b) => b.valor - a.valor);
  return withVal.map((r, i) => ({ ...r, pos: i, medal: i === 0 ? '🥇' : (i === 1 ? '🥈' : '🍍') }));
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
    Promise.all([fetchDiretores(), fetchCategorias()])
      .then(([diretores, categorias]) => {
        setConfig({ diretores: diretores || [], categorias: categorias || [] });
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

  // ---------- polling de sincronização multi-usuário (a cada 5s, só na tela de relatório) ----------
  // refs para acessar sempre os valores mais recentes de dentro do setInterval sem precisar
  // reiniciar o intervalo a cada mudança de aba/foco (o efeito abaixo só depende de
  // currentDate/config.categorias/currentView, conforme pedido).
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
          // falha de polling em background é ignorada silenciosamente — não usamos
          // entriesError aqui pra não incomodar o usuário a cada 5s numa instabilidade de rede.
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

  // type 'success' (padrão, usado ex. em "Salvo") some rápido; type 'error' (mensagens do backend,
  // incluindo bloqueios 409, que podem ser mais longas) fica visível por mais tempo.
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

  // marca/desmarca qual rede está com o input focado — usado pelo polling de sincronização
  // acima pra não sobrescrever, a cada 5s, o valor que o usuário está digitando agora mesmo.
  function handleValueFocus(redeId) {
    setFocusedRedeId(redeId);
  }
  function handleValueBlur(redeId) {
    onBlurSave(redeId);
    setFocusedRedeId(null);
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
    const parts = [];
    // cópia ordenada (não muta config.categorias): Receita Bruta, Correção, Acessórios
    // primeiro, nessa ordem, seguidas de qualquer categoria extra na ordem de criação —
    // essa ordem afeta só o texto do relatório, não as abas da UI.
    const categoriasOrdenadas = config.categorias
      .map((c, index) => ({ c, index }))
      .sort((a, b) => {
        const diff = prioridadeCategoria(a.c.nome) - prioridadeCategoria(b.c.nome);
        return diff !== 0 ? diff : a.index - b.index;
      })
      .map(({ c }) => c);
    for (const c of categoriasOrdenadas) {
      const vals = entries[dataKey(currentDate, c.id)] || {};
      // `visivel` (antes filtro de Diretor) e `ativo` (antes filtro de Loja) agora são
      // ambos campos de Rede — uma rede oculta/inativa nunca aparece no relatório.
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

  // gera uma aba por categoria (config.categorias), com todas as redes de cada diretor
  // empilhadas na mesma tabela (Diretor | Posição | Rede | Valor) e uma linha de total por
  // diretor — mesmo total já exibido no total-pill do card daquele diretor na tela.
  // Sem filtro por ativo/visivel, igual ao comportamento anterior (exporta tudo).
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

  // ---------- mutações de Rede (Delta, Lendários...) ----------
  // helper genérico: `visivel` e `ativo` moraram no Diretor/Loja do modelo antigo e agora
  // são ambos campos de Rede — todos os toggles/edições de Rede passam por aqui, seguindo
  // a mesma filosofia não-otimista de sempre: só troca o estado local depois que a API
  // confirma, substituindo a rede pelo objeto real retornado (usa `diretor_id` da resposta
  // para achar o diretor-pai, já que quem chama nem sempre tem esse id à mão).
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

  // ocultar/mostrar rede no grid principal e no relatório (campo `visivel`).
  function toggleRedeVisivel(redeId, novoValor) {
    updateRedeCampo(redeId, { visivel: novoValor }, 'Erro ao atualizar visibilidade da rede');
  }

  // ativar/desativar rede (soft-delete, campo `ativo`) — ação separada de `visivel`,
  // ver decisão de UX documentada no topo de ConfigView.
  function toggleRedeAtivo(redeId, novoValor) {
    updateRedeCampo(redeId, { ativo: novoValor }, 'Erro ao atualizar status da rede');
  }

  // atribui/desatribui o GG (responsável) de uma rede via <select> (ConfigView).
  // `responsavelId` já vem convertido para number ou null por quem chama (a opção
  // "Nenhum" do <select> vira null).
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

  // ---------- mutações de Diretor ----------
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
                {currentView === 'config' ? '← Voltar ao relatório' : '⚙ Configurar diretores/redes'}
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
              ? (
                <ConfigView
                  config={config}
                  removeDiretor={removeDiretor} addDiretor={addDiretor} updateDiretorNome={updateDiretorNome}
                  removeRede={removeRede} addRede={addRede}
                  updateRedeNome={updateRedeNome} updateRedeEmoji={updateRedeEmoji}
                  removeCategoria={removeCategoria} isAdmin={isAdmin}
                  toggleRedeVisivel={toggleRedeVisivel} toggleRedeAtivo={toggleRedeAtivo}
                  updateRedeResponsavel={updateRedeResponsavel}
                />
              )
              : (
                <ReportView
                  config={config} cat={cat} values={values} setValue={setValue} onBlurSave={handleValueBlur}
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

function ReportView({ config, cat, values, setValue, onBlurSave, onFocusValue, setCurrentCatId, addCategoria, currentDate, handleGenReport, handleCopyReport, reportText, copyShown, handleExportExcel, handleSendEmail, sendingEmail, isAdmin, toggleRedeVisivel }) {
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
        {config.diretores.map(diretor => {
          // uma rede oculta (visivel=false) ou inativa (ativo=false) não aparece ranqueada
          // aqui nem no relatório — mesmo filtro que antes existia em dois níveis diferentes,
          // agora unificado no nível Rede (ver buildFullReport/CLAUDE.md).
          const redesRankeaveis = diretor.redes.filter(r => r.ativo !== false && r.visivel !== false);
          const ranked = rankRede(values, redesRankeaveis);
          const total = ranked.reduce((s, r) => s + r.valor, 0);
          return (
            <div className={card} key={diretor.id}>
              <div className="flex justify-between items-baseline mb-3.5">
                <h2 className="font-display text-[22px] font-bold m-0">{diretor.nome}</h2>
                <div className="text-xl font-bold text-[var(--teal)] bg-[var(--teal)]/10 px-3.5 py-1 rounded-lg">{toBRL(total)}</div>
              </div>
              {ranked.length
                ? ranked.map(r => (
                  <div
                    key={r.id}
                    className={`flex items-center gap-3 px-2.5 py-2.5 rounded-[9px] mb-1.5 ${
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
                    <div className="flex-1 text-[14.5px] font-semibold">{r.nome}</div>
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
                        className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-2.5 py-1.5 text-[12px] font-bold cursor-pointer hover:brightness-110 flex-shrink-0"
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

// Decisão de UX (visivel vs ativo na Rede, ver resumo final): mantidos como DOIS controles
// separados e explícitos ("Ocultar"/"Mostrar" para `visivel`, "Desativar"/"Reativar" para
// `ativo`) em vez de combinados num único botão — são conceitos com efeitos diferentes
// (visivel: some do relatório/ranking mas continua "ativa" pro resto do sistema; ativo:
// soft-delete de verdade, é o que o backend olha antes de permitir excluir a rede) e um
// admin pode querer, por exemplo, desativar uma rede que fechou sem tirá-la do relatório
// do dia em que ainda havia lançamento, ou ocultar temporariamente uma rede ainda ativa.
function ConfigView({
  config,
  removeDiretor, addDiretor, updateDiretorNome,
  removeRede, addRede, updateRedeNome, updateRedeEmoji,
  removeCategoria, isAdmin,
  toggleRedeVisivel, toggleRedeAtivo, updateRedeResponsavel,
}) {
  const [newDiretorNome, setNewDiretorNome] = useState('');
  const [novaRedeDiretorId, setNovaRedeDiretorId] = useState('');
  const [novaRedeEmoji, setNovaRedeEmoji] = useState('');
  const [novaRedeNome, setNovaRedeNome] = useState('');

  // ---------- GGs (responsáveis): lista carregada uma vez ao entrar na ConfigView ----------
  const [responsaveis, setResponsaveis] = useState([]);
  const [loadingResponsaveis, setLoadingResponsaveis] = useState(true);
  const [responsaveisError, setResponsaveisError] = useState(null);
  const [novoResponsavelNome, setNovoResponsavelNome] = useState('');
  const [responsavelFormError, setResponsavelFormError] = useState(null);

  useEffect(() => {
    fetchResponsaveis()
      .then(lista => setResponsaveis(lista || []))
      .catch(err => setResponsaveisError(err.message || 'Erro ao carregar GGs.'))
      .finally(() => setLoadingResponsaveis(false));
  }, []);

  function handleAddResponsavel() {
    const nome = novoResponsavelNome.trim();
    if (!nome) {
      setResponsavelFormError('Informe um nome para o GG.');
      return;
    }
    setResponsavelFormError(null);
    criarResponsavel({ nome })
      .then(responsavelCriado => {
        setResponsaveis(prev => [...prev, responsavelCriado]);
        setNovoResponsavelNome('');
      })
      .catch(err => setResponsavelFormError(err.message || 'Erro ao criar GG'));
  }

  function handleRemoveResponsavel(id) {
    setResponsavelFormError(null);
    removerResponsavel(id)
      .then(() => setResponsaveis(prev => prev.filter(r => r.id !== id)))
      .catch(err => setResponsavelFormError(err.message || 'Erro ao remover GG'));
  }

  return (
    <div>
      <div className="mb-[22px]">
        <h3 className="font-display text-[19px] mb-3 font-bold">Diretores e redes</h3>
        {config.diretores.map(diretor => (
          <div key={diretor.id} className="border border-[var(--border)] rounded-xl px-4 py-3.5 mb-3 bg-[var(--panel-alt)]">
            <div className="flex gap-2.5 items-center mb-2.5">
              <input
                key={`diretor-nome-${diretor.id}`}
                defaultValue={diretor.nome}
                aria-label={`Nome do diretor ${diretor.nome}`}
                readOnly={!isAdmin}
                onBlur={e => updateDiretorNome(diretor.id, e.target.value)}
                className="font-display text-[var(--text)] text-[19px] font-bold px-1 py-0.5 flex-1 bg-transparent border border-transparent rounded-lg focus:outline-none focus:border-[var(--teal)] focus:bg-[#12151b]"
              />
              {isAdmin ? (
                <button
                  className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110"
                  onClick={() => removeDiretor(diretor.id)}
                >
                  Remover diretor
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {diretor.redes.length
                ? diretor.redes.map(r => (
                  <div
                    key={r.id}
                    className={`flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-lg pl-2 pr-1.5 py-1.5 text-[13px] ${r.ativo === false ? 'opacity-50' : ''}`}
                  >
                    <input
                      key={`rede-emoji-${r.id}`}
                      defaultValue={r.emoji || ''}
                      maxLength={2}
                      aria-label={`Emoji da rede ${r.nome}`}
                      readOnly={!isAdmin}
                      onBlur={e => updateRedeEmoji(r.id, e.target.value)}
                      className="w-9 text-center bg-transparent border border-transparent rounded px-1 py-0.5 focus:outline-none focus:border-[var(--teal)]"
                    />
                    <input
                      key={`rede-nome-${r.id}`}
                      defaultValue={r.nome}
                      aria-label={`Nome da rede ${r.nome}`}
                      readOnly={!isAdmin}
                      onBlur={e => updateRedeNome(r.id, e.target.value)}
                      className="w-[120px] bg-transparent border border-transparent rounded px-1 py-0.5 focus:outline-none focus:border-[var(--teal)]"
                    />
                    {isAdmin ? (
                      <select
                        aria-label={`GG da rede ${r.nome}`}
                        value={r.responsavel?.id ?? ''}
                        onChange={e => updateRedeResponsavel(r.id, e.target.value === '' ? null : Number(e.target.value))}
                        className="text-[12px] font-medium text-[var(--muted)] flex-none w-28 bg-transparent border border-[var(--border)] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[var(--teal)]"
                      >
                        <option value="">Nenhum</option>
                        {responsaveis.map(resp => (
                          <option key={resp.id} value={resp.id}>{resp.nome}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[12px] font-medium text-[var(--muted)] flex-none">
                        {r.responsavel?.nome ?? 'sem GG'}
                      </span>
                    )}
                    {r.visivel === false ? <span className="text-[11px] text-[var(--muted)] font-semibold">(oculta)</span> : null}
                    {r.ativo === false ? <span className="text-[11px] text-[var(--muted)] font-semibold">(inativa)</span> : null}
                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => toggleRedeVisivel(r.id, r.visivel === false ? true : false)}
                          aria-label={`${r.visivel === false ? 'Mostrar' : 'Ocultar'} rede ${r.nome} no relatório`}
                          className="bg-transparent border border-[var(--border)] text-[var(--text)] rounded-full px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-110"
                        >
                          {r.visivel === false ? 'Mostrar' : 'Ocultar'}
                        </button>
                        <button
                          onClick={() => toggleRedeAtivo(r.id, r.ativo === false ? true : false)}
                          aria-label={`${r.ativo === false ? 'Reativar' : 'Desativar'} rede ${r.nome}`}
                          className="bg-transparent border border-[var(--border)] text-[var(--text)] rounded-full px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-110"
                        >
                          {r.ativo === false ? 'Reativar' : 'Desativar'}
                        </button>
                      </>
                    ) : null}
                    <button
                      onClick={() => removeRede(diretor.id, r.id)}
                      aria-label={`Remover rede ${r.nome}`}
                      className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-full w-[18px] h-[18px] text-[11px] cursor-pointer leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ))
                : <span className="text-[var(--muted)] text-[13px]">Nenhuma rede ainda</span>
              }
            </div>
          </div>
        ))}

        {isAdmin ? (
          <div className="flex gap-2 mt-1 flex-wrap items-center">
            <select
              aria-label="Diretor pai da nova rede"
              value={novaRedeDiretorId}
              onChange={e => setNovaRedeDiretorId(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Selecione o diretor...</option>
              {config.diretores.map(d => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
            <input
              placeholder="🏆" maxLength={2} value={novaRedeEmoji} onChange={e => setNovaRedeEmoji(e.target.value)}
              className="w-11 text-center bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-2.5 py-2 text-sm"
            />
            <input
              placeholder="Nome da rede (ex: Delta)" value={novaRedeNome} onChange={e => setNovaRedeNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            />
            <button
              className={btn}
              onClick={() => {
                addRede(novaRedeDiretorId, novaRedeEmoji, novaRedeNome);
                setNovaRedeEmoji('');
                setNovaRedeNome('');
              }}
            >
              Adicionar rede
            </button>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="flex gap-2 mt-2.5">
            <input placeholder="Nome do diretor (ex: Victor Hugo)" value={newDiretorNome} onChange={e => setNewDiretorNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm" />
            <button className={btn} onClick={() => { addDiretor(newDiretorNome); setNewDiretorNome(''); }}>Adicionar diretor</button>
          </div>
        ) : null}
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

      {isAdmin ? (
        <div className="mt-[22px]">
          <h3 className="font-display text-[19px] mb-3 font-bold">GGs</h3>
          {loadingResponsaveis ? (
            <div className="text-[var(--muted)] text-sm">Carregando GGs...</div>
          ) : responsaveisError ? (
            <div className="text-[var(--danger)] text-[13px] mb-2">{responsaveisError}</div>
          ) : (
            <div className="flex flex-wrap mb-2">
              {responsaveis.length
                ? responsaveis.map(r => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-full pl-3 pr-1.5 py-1 mr-1 mb-1 text-[13px]">
                    {r.nome}
                    <button
                      onClick={() => handleRemoveResponsavel(r.id)}
                      aria-label={`Remover GG ${r.nome}`}
                      className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-full w-[18px] h-[18px] text-[11px] cursor-pointer leading-none"
                    >
                      ✕
                    </button>
                  </span>
                ))
                : <span className="text-[var(--muted)] text-[13px]">Nenhum GG cadastrado ainda</span>
              }
            </div>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <input
              placeholder="Nome do GG" value={novoResponsavelNome}
              onChange={e => setNovoResponsavelNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            />
            <button className={btn} onClick={handleAddResponsavel}>Adicionar GG</button>
            {responsavelFormError ? <span className="text-[var(--danger)] text-[13px]">{responsavelFormError}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
