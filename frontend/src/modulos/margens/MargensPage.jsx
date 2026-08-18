import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchRedes } from '../../lib/cadastrosApi.js';
import { fetchEntradas, salvarEntrada, fetchRelatorio } from './margensApi.js';

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
// base de dígitos -> valor float guardado no estado (nunca a string formatada); base
// vazia representa campo vazio, não zero — preserva a distinção "nunca digitado" vs "digitou 0"
function digitosParaValor(digitos) {
  if (!digitos) return '';
  return (parseInt(digitos, 10) || 0) / 100;
}
// caminho inverso: reconstrói a base de dígitos a partir do valor float guardado —
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
// campo vazio/indefinido vira 0 só na hora de calcular/montar o payload pro backend.
function numOrZero(v) {
  return v === '' || v === undefined || v === null ? 0 : (Number(v) || 0);
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
// primeiro dia do mês da data informada (string, sem passar por Date/timezone) — usado só
// como valor inicial do período do resumo geral, pra abrir a tela já com um período útil.
function primeiroDiaDoMes(iso) {
  return iso.slice(0, 8) + '01';
}
function formatDateFullPt(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
// "DD-MM", usado só no nome do arquivo do PDF (sem ano, conforme pedido)
function diaMes(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}
// string manual "48,07%" (vírgula decimal, sem depender de toLocaleString pro símbolo)
function formatPercentualBR(n) {
  const num = Number(n) || 0;
  return num.toFixed(2).replace('.', ',') + '%';
}
function capitalizeCor(cor) {
  if (cor === 'verde') return 'Verde';
  if (cor === 'amarelo') return 'Amarelo';
  if (cor === 'vermelho') return 'Vermelho';
  return cor ? cor.charAt(0).toUpperCase() + cor.slice(1) : '-';
}
// mesma regra de corte do backend (ver CONTRATO-MARGENS-API.md, seção 3) — usada aqui só
// pra colorir a margem calculada AO VIVO no formulário, antes de salvar (o backend é quem
// calcula a cor "oficial" que volta no relatório).
function calcularCorPercentual(percentual) {
  if (percentual === null || percentual === undefined || Number.isNaN(percentual)) return null;
  return percentual >= 41 ? 'verde' : percentual >= 40 ? 'amarelo' : 'vermelho';
}
// mesma fórmula do backend (CONTRATO-MARGENS-API.md, seção 1/3):
// lucro = faturamento - custoProduto - totalTar; percentual = lucro / faturamento * 100
// (null quando faturamento é 0/vazio — evita divisão por zero e sinaliza "sem margem calculável").
function calcularMargem({ faturamento, custoProduto, totalTar }) {
  const fat = numOrZero(faturamento);
  if (!fat) return null;
  const custo = numOrZero(custoProduto);
  const tar = numOrZero(totalTar);
  return ((fat - custo - tar) / fat) * 100;
}
// inverso de calcularMargem: a loja informa direto a margem % que o ERP externo já
// mostra, e o sistema deriva o Total Tar equivalente pra manter o mesmo payload de
// salvarEntrada de sempre (ver CLAUDE.md/CONTRATO-MARGENS-API.md — contrato não muda).
function calcularTotalTarDerivado({ faturamento, custoProduto, margemPercentual }) {
  const fat = numOrZero(faturamento);
  const custo = numOrZero(custoProduto);
  const margem = numOrZero(margemPercentual);
  return fat - custo - (margem / 100) * fat;
}
// modo de lançamento por loja: 'margem' (padrão — cola a margem % já pronta do ERP
// externo) ou 'tar' (secundário, revelado sob demanda pra digitar o Total Tar direto) —
// ausência de chave cai no padrão 'margem'.
function getModoLoja(modoPorLoja, lojaId) {
  return modoPorLoja[lojaId] || 'margem';
}
// pega o lançamento mais recentemente atualizado do dia (usado só pra pré-preencher os
// campos consolidados da franquia com o último snapshot usado nesse dia, se já existir).
function pegarSnapshotMaisRecente(entradas) {
  if (!entradas || !entradas.length) return null;
  return [...entradas].sort((a, b) => new Date(b.atualizado_em) - new Date(a.atualizado_em))[0];
}

// agrupa o array flat de GET /api/cadastros/redes (cada rede já vem com diretor{id,nome}
// e lojas[] aninhado) na hierarquia visual Diretor -> Rede -> Loja — o endpoint
// compartilhado não devolve isso agrupado, então é o Margens quem monta a árvore.
function agruparRedesPorDiretor(redes) {
  const map = new Map();
  redes.forEach(rede => {
    const dId = rede.diretor.id;
    if (!map.has(dId)) map.set(dId, { id: dId, nome: rede.diretor.nome, redes: [] });
    map.get(dId).redes.push(rede);
  });
  return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// GET /api/margens/relatorio devolve uma lista de blocos (um por rede, com diretor
// repetido quando o diretor tem mais de uma rede) — achata em linhas Diretor+Rede+Loja
// pra poder filtrar em memória (Rede/Cor/busca) sem depender da forma aninhada.
function flattenRelatorio(blocos) {
  const linhas = [];
  (blocos || []).forEach(bloco => {
    (bloco.lojas || []).forEach(loja => {
      linhas.push({
        diretorId: bloco.diretor.id,
        diretorNome: bloco.diretor.nome,
        redeId: bloco.rede.id,
        redeNome: bloco.rede.nome,
        responsavelNome: bloco.rede.responsavel?.nome ?? null,
        lojaId: loja.id,
        lojaNome: loja.nome,
        faturamento: loja.faturamento,
        custoProduto: loja.custoProduto,
        totalTar: loja.totalTar,
        lucro: loja.lucro,
        percentualMargem: loja.percentualMargem,
        cor: loja.cor,
      });
    });
  });
  return linhas;
}

// reagrupa linhas (já filtradas) de volta em Diretor -> Rede -> Loja[] pra exibição,
// em ordem alfabética em todos os níveis (mesma ordem exigida pro PDF).
function agruparLinhasPorDiretorERede(linhas) {
  const diretores = new Map();
  linhas.forEach(l => {
    if (!diretores.has(l.diretorId)) {
      diretores.set(l.diretorId, { diretorId: l.diretorId, diretorNome: l.diretorNome, redes: new Map() });
    }
    const diretor = diretores.get(l.diretorId);
    if (!diretor.redes.has(l.redeId)) {
      diretor.redes.set(l.redeId, { redeId: l.redeId, redeNome: l.redeNome, responsavelNome: l.responsavelNome, lojas: [] });
    }
    diretor.redes.get(l.redeId).lojas.push(l);
  });

  return Array.from(diretores.values())
    .map(d => ({
      ...d,
      redes: Array.from(d.redes.values())
        .map(r => ({ ...r, lojas: [...r.lojas].sort((a, b) => a.lojaNome.localeCompare(b.lojaNome, 'pt-BR')) }))
        .sort((a, b) => a.redeNome.localeCompare(b.redeNome, 'pt-BR')),
    }))
    .sort((a, b) => a.diretorNome.localeCompare(b.diretorNome, 'pt-BR'));
}

const COR_BADGE = {
  verde: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  amarelo: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  vermelho: 'bg-red-500/15 text-red-400 border-red-500/40',
};
const COR_BOLINHA = {
  verde: 'bg-emerald-400',
  amarelo: 'bg-amber-400',
  vermelho: 'bg-red-400',
};
// cores RGB usadas no PDF (jspdf-autotable didParseCell), separadas das classes
// Tailwind acima porque o PDF é desenhado fora do DOM e não enxerga classes CSS.
const COR_PDF = {
  verde: { fill: [22, 163, 74], text: [255, 255, 255] },
  amarelo: { fill: [234, 179, 8], text: [17, 24, 39] },
  vermelho: { fill: [220, 38, 38], text: [255, 255, 255] },
};

// classes reaproveitadas (mesma filosofia de RankingPage.jsx — ainda não há util
// compartilhado, ver CLAUDE.md)
const btn = "bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";
const input = "bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed";

export default function MargensPage() {
  const [currentView, setCurrentView] = useState('lancamento');
  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  // type 'success' (padrão) some rápido; type 'error' (mensagens do backend) fica
  // visível por mais tempo — mesmo padrão de toast de RankingPage.jsx.
  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1400);
  }

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] antialiased p-6 min-h-screen">
      <div className="max-w-[1180px] mx-auto">
        <div className="flex justify-between items-end flex-wrap gap-4 border-b border-[var(--border)] pb-[18px] mb-[22px]">
          <div>
            <div className="text-[11px] tracking-[.14em] uppercase text-[var(--teal)] font-semibold">Painel de Margens · Lucro</div>
            <h1 className="font-display text-[34px] font-extrabold mt-0.5 leading-none">
              {currentView === 'lancamento' ? 'Lançamento' : 'Relatório de período'}
            </h1>
          </div>
          <div className="flex gap-2.5 items-center">
            <button
              className={btnGhost}
              onClick={() => setCurrentView(v => (v === 'lancamento' ? 'relatorio' : 'lancamento'))}
            >
              {currentView === 'lancamento' ? '📊 Ver relatório de período' : '← Voltar ao lançamento'}
            </button>
          </div>
        </div>

        {currentView === 'lancamento'
          ? <LancamentoView flash={flash} onVerRelatorio={() => setCurrentView('relatorio')} />
          : <RelatorioView />}
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

// ---------- View: Lançamento (resumo do período + consolidado da franquia + formulário por loja) ----------
function LancamentoView({ flash, onVerRelatorio }) {
  return (
    <div className="flex flex-col gap-[22px]">
      <ResumoPeriodo />
      <FormularioLancamento flash={flash} />
      <div className="flex justify-center">
        <button className={btnGhost} onClick={onVerRelatorio}>Ver relatório de período</button>
      </div>
    </div>
  );
}

// ---------- Bloco (a): resumo geral do período no topo da view de Lançamento ----------
function ResumoPeriodo() {
  const [dataInicio, setDataInicio] = useState(() => primeiroDiaDoMes(hojeISO()));
  const [dataFim, setDataFim] = useState(hojeISO);
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // `loading`/`error` só são resetados de forma síncrona nos handlers de evento que
  // disparam este efeito (handleInicioChange/handleFimChange/handleRetry logo abaixo) —
  // nunca dentro do próprio corpo do efeito, mesmo padrão de RankingPage.jsx.
  useEffect(() => {
    if (!dataInicio || !dataFim) return;
    let cancelled = false;
    fetchRelatorio(dataInicio, dataFim)
      .then(resultado => {
        if (cancelled) return;
        setDados(resultado || []);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Erro ao carregar o resumo do período.');
        setDados(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataInicio, dataFim, reloadToken]);

  function handleInicioChange(valor) {
    setLoading(true);
    setDataInicio(valor);
  }
  function handleFimChange(valor) {
    setLoading(true);
    setDataFim(valor);
  }
  function handleRetry() {
    setLoading(true);
    setReloadToken(t => t + 1);
  }

  const metrics = useMemo(() => {
    if (!dados) return null;
    const lojas = dados.flatMap(bloco => bloco.lojas || []);
    const totalFaturamento = lojas.reduce((s, l) => s + (Number(l.faturamento) || 0), 0);
    const totalLucro = lojas.reduce((s, l) => s + (Number(l.lucro) || 0), 0);
    const margemMedia = totalFaturamento !== 0 ? (totalLucro / totalFaturamento) * 100 : 0;
    const contagem = { verde: 0, amarelo: 0, vermelho: 0 };
    lojas.forEach(l => { if (contagem[l.cor] !== undefined) contagem[l.cor] += 1; });
    return { margemMedia, contagem, totalLojas: lojas.length };
  }, [dados]);

  return (
    <div className={card}>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <h2 className="font-display text-[20px] font-bold m-0">Resumo geral do período</h2>
        <div className="flex gap-2.5 items-end flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Início</span>
            <input type="date" value={dataInicio} onChange={e => handleInicioChange(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Fim</span>
            <input type="date" value={dataFim} onChange={e => handleFimChange(e.target.value)} className={input} />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="text-[var(--muted)] text-sm px-1 py-6 text-center">Carregando resumo...</div>
      ) : error ? (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
          <span>Não foi possível carregar o resumo: {error}</span>
          <button className={btnGhost} onClick={handleRetry}>Tentar novamente</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[.06em] text-[var(--muted)] font-semibold mb-1">Margem média</div>
              <div className="font-display text-2xl font-bold text-[var(--teal)]">{formatPercentualBR(metrics.margemMedia)}</div>
            </div>
            <div className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[.06em] text-[var(--muted)] font-semibold mb-1">Verde</div>
              <div className="font-display text-2xl font-bold text-emerald-400">{metrics.contagem.verde}</div>
            </div>
            <div className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[.06em] text-[var(--muted)] font-semibold mb-1">Amarelo</div>
              <div className="font-display text-2xl font-bold text-amber-400">{metrics.contagem.amarelo}</div>
            </div>
            <div className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[.06em] text-[var(--muted)] font-semibold mb-1">Vermelho</div>
              <div className="font-display text-2xl font-bold text-red-400">{metrics.contagem.vermelho}</div>
            </div>
          </div>
          <div className="text-[12px] text-[var(--muted)] mt-3">
            Verde: margem ≥ 41% · Amarelo: 40% a 40,9% · Vermelho: abaixo de 40%
          </div>
          {metrics.totalLojas === 0 ? (
            <div className="text-[var(--muted)] text-[13px] mt-3">Nenhum lançamento encontrado nesse período.</div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------- Bloco (b)+(c): consolidado da franquia (dia único) + formulário por loja ----------
function FormularioLancamento({ flash }) {
  const [dataLancamento, setDataLancamento] = useState(hojeISO);

  const [diretores, setDiretores] = useState([]);
  const [loadingArvore, setLoadingArvore] = useState(true);
  const [errorArvore, setErrorArvore] = useState(null);
  const [reloadArvoreToken, setReloadArvoreToken] = useState(0);

  const [entradasDoDia, setEntradasDoDia] = useState({}); // lojaId -> { id, faturamento, custoProduto, totalTar, margemInformada, atualizado_em }
  const [loadingEntradas, setLoadingEntradas] = useState(true);
  const [errorEntradas, setErrorEntradas] = useState(null);
  const [reloadEntradasToken, setReloadEntradasToken] = useState(0);

  // valores consolidados da franquia pro dia selecionado — valem pra TODAS as lojas
  // (ver CONTRATO-MARGENS-API.md v4); pré-preenchidos com o snapshot mais recente do
  // dia, se já houver algum lançamento confirmado.
  const [consolidado, setConsolidado] = useState({ faturamento: '', custoProduto: '' });

  const [redeSelecionadaId, setRedeSelecionadaId] = useState('');
  // lojas explicitamente colocadas em edição via botão "Editar" (mesmo já tendo entrada
  // salva no dia) — union com "nunca confirmada" decide se a linha está editável.
  const [editingSet, setEditingSet] = useState(() => new Set());
  // rascunho do Total Tar em edição, por loja; ausência de chave cai pro valor já salvo.
  const [rascunhosTar, setRascunhosTar] = useState({});
  const [salvandoLojaId, setSalvandoLojaId] = useState(null);

  // modo de lançamento por loja ('margem' padrão ou 'tar', revelado sob demanda) e o
  // valor digitado que só existe no frontend enquanto não confirmado (ver funções
  // auxiliares abaixo): margemDigitadaPorLoja guarda a margem % colada pelo usuário,
  // usada tanto pra colorir a linha ao vivo quanto (quando o Total Tar está vazio) pra
  // derivar o totalTar enviado no Confirmar (calcularTotalTarDerivado).
  const [modoPorLoja, setModoPorLoja] = useState({});
  const [margemDigitadaPorLoja, setMargemDigitadaPorLoja] = useState({});

  // árvore Diretor -> Rede (com Lojas aninhadas) — carregada uma vez, não depende da data.
  // `loadingArvore`/`errorArvore` só são resetados de forma síncrona no handler de retry
  // (handleRetryArvore, abaixo) — nunca dentro do próprio corpo do efeito, mesmo padrão
  // de RankingPage.jsx.
  useEffect(() => {
    let cancelled = false;
    fetchRedes()
      .then(redes => {
        if (cancelled) return;
        // uma rede desativada não pode ser escolhida pra lançamento de margem (ver
        // CLAUDE.md/CONTRATO-CADASTROS-API.md — `ativo` tem efeito no sistema todo,
        // não só na tela de configuração, que continua mostrando todas).
        setDiretores(agruparRedesPorDiretor((redes || []).filter(r => r.ativo !== false)));
        setErrorArvore(null);
      })
      .catch(err => {
        if (cancelled) return;
        setErrorArvore(err.message || 'Erro ao carregar diretores/redes/lojas.');
      })
      .finally(() => { if (!cancelled) setLoadingArvore(false); });
    return () => { cancelled = true; };
  }, [reloadArvoreToken]);

  function handleRetryArvore() {
    setLoadingArvore(true);
    setReloadArvoreToken(t => t + 1);
  }

  // entradas já confirmadas na data escolhida — refeito sempre que a data mudar (ver
  // handleDataLancamentoChange) ou o usuário clicar em "Tentar novamente". Também
  // pré-preenche o consolidado da franquia com o snapshot mais recente do dia, se houver.
  useEffect(() => {
    let cancelled = false;
    fetchEntradas(dataLancamento)
      .then(entradas => {
        if (cancelled) return;
        const map = {};
        (entradas || []).forEach(e => {
          map[e.loja_id] = { id: e.id, faturamento: e.faturamento, custoProduto: e.custoProduto, totalTar: e.totalTar, margemInformada: e.margemInformada, atualizado_em: e.atualizado_em };
        });
        setEntradasDoDia(map);
        const maisRecente = pegarSnapshotMaisRecente(entradas);
        if (maisRecente) {
          setConsolidado({ faturamento: maisRecente.faturamento, custoProduto: maisRecente.custoProduto });
        }
        setErrorEntradas(null);
      })
      .catch(err => {
        if (cancelled) return;
        setErrorEntradas(err.message || 'Erro ao carregar lançamentos do dia.');
      })
      .finally(() => { if (!cancelled) setLoadingEntradas(false); });
    return () => { cancelled = true; };
  }, [dataLancamento, reloadEntradasToken]);

  function handleDataLancamentoChange(valor) {
    setLoadingEntradas(true);
    setConsolidado({ faturamento: '', custoProduto: '' });
    setEditingSet(new Set());
    setRascunhosTar({});
    setModoPorLoja({});
    setMargemDigitadaPorLoja({});
    setDataLancamento(valor);
  }

  function handleRetryEntradas() {
    setLoadingEntradas(true);
    setReloadEntradasToken(t => t + 1);
  }

  function setConsolidadoCampo(campo, valor) {
    setConsolidado(prev => ({ ...prev, [campo]: valor }));
  }
  function handleConsolidadoBackspace(campo) {
    const digitosAtuais = valorParaDigitos(consolidado[campo]);
    setConsolidadoCampo(campo, digitosParaValor(digitosAtuais.slice(0, -1)));
  }

  const redeSelecionada = useMemo(() => {
    for (const diretor of diretores) {
      const achada = diretor.redes.find(r => String(r.id) === String(redeSelecionadaId));
      if (achada) return achada;
    }
    return null;
  }, [diretores, redeSelecionadaId]);

  const lojasDaRede = useMemo(
    () => (redeSelecionada ? (redeSelecionada.lojas || []).filter(l => l.ativo !== false) : []),
    [redeSelecionada],
  );

  // Total Tar exibido: rascunho em andamento se existir, senão o que já está salvo pra
  // essa loja/data — sem precisar de um estado derivado sincronizado via efeito.
  function valorTar(lojaId) {
    if (Object.prototype.hasOwnProperty.call(rascunhosTar, lojaId)) return rascunhosTar[lojaId];
    return entradasDoDia[lojaId] ? entradasDoDia[lojaId].totalTar : '';
  }
  function setTar(lojaId, valor) {
    setRascunhosTar(prev => ({ ...prev, [lojaId]: valor }));
  }
  function handleTarBackspace(lojaId) {
    const digitosAtuais = valorParaDigitos(valorTar(lojaId));
    setTar(lojaId, digitosParaValor(digitosAtuais.slice(0, -1)));
  }

  // margem % colada/digitada pelo usuário (campo principal da linha) — usada tanto pra
  // colorir a linha ao vivo quanto (quando o Total Tar está vazio) pra derivar o Total
  // Tar enviado no Confirmar.
  function valorMargemDigitada(lojaId) {
    return margemDigitadaPorLoja[lojaId] ?? '';
  }
  function setMargemDigitada(lojaId, valor) {
    setMargemDigitadaPorLoja(prev => ({ ...prev, [lojaId]: valor }));
  }
  function handleMargemDigitadaBackspace(lojaId) {
    const digitosAtuais = valorParaDigitos(valorMargemDigitada(lojaId));
    setMargemDigitada(lojaId, digitosParaValor(digitosAtuais.slice(0, -1)));
  }

  function toggleModoLoja(lojaId) {
    setModoPorLoja(prev => ({ ...prev, [lojaId]: getModoLoja(prev, lojaId) === 'tar' ? 'margem' : 'tar' }));
  }

  // margem ao vivo de uma linha: se a loja está bloqueada (confirmada e não em edição),
  // usa o snapshot já salvo daquela loja; senão, aplica a regra de precedência entre os
  // dois campos: Total Tar preenchido (o usuário revelou o campo secundário e digitou
  // algo) vence e a margem é calculada a partir dele, sobrepondo o que estiver digitado
  // na margem; Total Tar vazio (caso comum, campo secundário nem revelado) faz a margem
  // digitada mandar direto — é a própria margem, não precisa recalcular. Independe de
  // `modoPorLoja`, que só controla a VISIBILIDADE do campo Total Tar, não qual fonte é
  // autoritativa (ver handleConfirmarLoja abaixo, mesma regra usada no payload).
  function margemLinha(loja, bloqueado) {
    if (bloqueado) return calcularMargem(entradasDoDia[loja.id]);
    if (valorTar(loja.id) !== '') {
      return calcularMargem({ faturamento: consolidado.faturamento, custoProduto: consolidado.custoProduto, totalTar: valorTar(loja.id) });
    }
    const v = valorMargemDigitada(loja.id);
    return v === '' ? null : numOrZero(v);
  }

  function handleConfirmarLoja(lojaId) {
    const faturamento = numOrZero(consolidado.faturamento);
    const custoProduto = numOrZero(consolidado.custoProduto);
    // mesma regra de precedência de margemLinha: Total Tar preenchido é a fonte
    // autoritativa (envia o valor digitado direto); vazio faz a margem digitada mandar
    // (deriva o Total Tar equivalente e registra margemInformada pro backend gravar o
    // histórico do que foi de fato digitado).
    const tarPreenchido = valorTar(lojaId) !== '';
    const totalTar = tarPreenchido
      ? numOrZero(valorTar(lojaId))
      : calcularTotalTarDerivado({ faturamento, custoProduto, margemPercentual: valorMargemDigitada(lojaId) });
    const margemInformada = tarPreenchido ? null : numOrZero(valorMargemDigitada(lojaId));
    const payload = { data: dataLancamento, lojaId, faturamento, custoProduto, totalTar, margemInformada };
    setSalvandoLojaId(lojaId);
    salvarEntrada(payload)
      .then(entrada => {
        setEntradasDoDia(prev => ({ ...prev, [lojaId]: entrada }));
        setEditingSet(prev => { if (!prev.has(lojaId)) return prev; const next = new Set(prev); next.delete(lojaId); return next; });
        setRascunhosTar(prev => {
          if (!(lojaId in prev)) return prev;
          const next = { ...prev };
          delete next[lojaId];
          return next;
        });
        setMargemDigitadaPorLoja(prev => {
          if (!(lojaId in prev)) return prev;
          const next = { ...prev };
          delete next[lojaId];
          return next;
        });
        flash('Salvo');
      })
      .catch(err => flash(err.message || 'Erro ao salvar lançamento', 'error'))
      .finally(() => setSalvandoLojaId(null));
  }

  function handleEditarLoja(lojaId) {
    setEditingSet(prev => new Set(prev).add(lojaId));
  }

  const semRedeCadastrada = !loadingArvore && !errorArvore && diretores.every(d => d.redes.length === 0);

  return (
    <>
      <div className={card}>
        <h2 className="font-display text-[20px] font-bold m-0 mb-1">Consolidado da franquia</h2>
        <p className="text-[12px] text-[var(--muted)] mb-4">
          Valores únicos por dia, valem para todas as lojas — o que diferencia a margem de cada loja é o Total Tar.
        </p>

        <div className="flex gap-2.5 items-end flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Data</span>
            <input
              type="date"
              value={dataLancamento}
              onChange={e => handleDataLancamentoChange(e.target.value)}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Faturamento</span>
            <input
              type="text" inputMode="decimal" placeholder="0,00"
              value={formatarDigitosBR(valorParaDigitos(consolidado.faturamento))}
              onChange={e => { setConsolidadoCampo('faturamento', digitosParaValor(extrairDigitos(e.target.value))); moveCaretToEnd(e.target); }}
              onKeyDown={e => {
                if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                e.preventDefault();
                handleConsolidadoBackspace('faturamento');
                moveCaretToEnd(e.target);
              }}
              onPaste={e => { e.preventDefault(); setConsolidadoCampo('faturamento', parseValorBR(e.clipboardData.getData('text'))); moveCaretToEnd(e.target); }}
              className="font-display w-[160px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Custo geral de produtos</span>
            <input
              type="text" inputMode="decimal" placeholder="0,00"
              value={formatarDigitosBR(valorParaDigitos(consolidado.custoProduto))}
              onChange={e => { setConsolidadoCampo('custoProduto', digitosParaValor(extrairDigitos(e.target.value))); moveCaretToEnd(e.target); }}
              onKeyDown={e => {
                if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                e.preventDefault();
                handleConsolidadoBackspace('custoProduto');
                moveCaretToEnd(e.target);
              }}
              onPaste={e => { e.preventDefault(); setConsolidadoCampo('custoProduto', parseValorBR(e.clipboardData.getData('text'))); moveCaretToEnd(e.target); }}
              className="font-display w-[160px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)]"
            />
          </label>
        </div>
      </div>

      <div className={card}>
        <h2 className="font-display text-[20px] font-bold m-0 mb-4">Lançamento por loja</h2>

        <div className="mb-5">
          <label className="flex flex-col gap-1 max-w-xs">
            <span className="text-[12px] text-[var(--muted)] font-semibold">Rede</span>
            <select
              value={redeSelecionadaId}
              onChange={e => setRedeSelecionadaId(e.target.value)}
              disabled={loadingArvore || !!errorArvore}
              className={`${input} min-w-[220px]`}
            >
              <option value="">Selecione a rede...</option>
              {diretores.map(diretor => (
                <optgroup key={diretor.id} label={diretor.nome}>
                  {diretor.redes.map(rede => (
                    <option key={rede.id} value={rede.id}>{rede.nome}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        {loadingArvore || loadingEntradas ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>
        ) : errorArvore ? (
          <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
            <span>Não foi possível carregar diretores/redes: {errorArvore}</span>
            <button className={btnGhost} onClick={handleRetryArvore}>Tentar novamente</button>
          </div>
        ) : errorEntradas ? (
          <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
            <span>Não foi possível carregar os lançamentos do dia: {errorEntradas}</span>
            <button className={btnGhost} onClick={handleRetryEntradas}>Tentar novamente</button>
          </div>
        ) : semRedeCadastrada ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
            Nenhuma rede cadastrada ainda. Cadastre diretores, redes e lojas para começar a lançar margem.
          </div>
        ) : !redeSelecionada ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Selecione uma rede para lançar os valores.</div>
        ) : lojasDaRede.length === 0 ? (
          <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Nenhuma loja cadastrada nesta rede ainda.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {lojasDaRede.map(loja => {
              const salvo = entradasDoDia[loja.id];
              const emEdicao = editingSet.has(loja.id);
              const bloqueado = !!salvo && !emEdicao;
              const percentual = margemLinha(loja, bloqueado);
              const cor = calcularCorPercentual(percentual);
              const salvando = salvandoLojaId === loja.id;
              const modoAtual = getModoLoja(modoPorLoja, loja.id);
              // Total Tar é o campo secundário/opcional — só fica visível (pra edição)
              // quando o usuário clica em "Calcular pelo Total Tar" pra revelá-lo.
              const tarRevelado = modoAtual === 'tar';

              // "Confirmar" só habilita depois que o usuário digitou algo de verdade em
              // pelo menos um dos dois campos (mesmo "0" conta, foi uma ação explícita) —
              // evita confirmar margem calculada em cima de valor vazio/zero por acidente.
              const preenchido = valorMargemDigitada(loja.id) !== '' || valorTar(loja.id) !== '';

              return (
                <div key={loja.id} className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-3 py-2.5 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[120px] text-[14px] font-semibold">{loja.nome}</div>

                  {!bloqueado ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">Margem (%)</span>
                      <input
                        type="text" inputMode="decimal" placeholder="0,00"
                        value={formatarDigitosBR(valorParaDigitos(valorMargemDigitada(loja.id)))}
                        onChange={e => { setMargemDigitada(loja.id, digitosParaValor(extrairDigitos(e.target.value))); moveCaretToEnd(e.target); }}
                        onKeyDown={e => {
                          if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                          e.preventDefault();
                          handleMargemDigitadaBackspace(loja.id);
                          moveCaretToEnd(e.target);
                        }}
                        onPaste={e => { e.preventDefault(); setMargemDigitada(loja.id, parseValorBR(e.clipboardData.getData('text'))); moveCaretToEnd(e.target); }}
                        className="font-display w-[110px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)]"
                      />
                    </label>
                  ) : null}

                  {bloqueado || tarRevelado ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">Total Tar</span>
                      <input
                        type="text" inputMode="decimal" placeholder="0,00"
                        disabled={bloqueado}
                        value={formatarDigitosBR(valorParaDigitos(valorTar(loja.id)))}
                        onChange={e => { setTar(loja.id, digitosParaValor(extrairDigitos(e.target.value))); moveCaretToEnd(e.target); }}
                        onKeyDown={e => {
                          if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                          e.preventDefault();
                          handleTarBackspace(loja.id);
                          moveCaretToEnd(e.target);
                        }}
                        onPaste={e => { e.preventDefault(); setTar(loja.id, parseValorBR(e.clipboardData.getData('text'))); moveCaretToEnd(e.target); }}
                        className="font-display w-[130px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)] disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </label>
                  ) : null}

                  {bloqueado && salvo?.margemInformada != null ? (
                    <span className="text-[12px] text-[var(--muted)] font-semibold">
                      Margem informada: {formatPercentualBR(salvo.margemInformada)}
                    </span>
                  ) : null}

                  <div className="flex flex-col gap-1 w-[90px]">
                    <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">Margem</span>
                    {percentual === null ? (
                      <span className="text-[13px] text-[var(--muted)]">—</span>
                    ) : (
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full border text-center ${COR_BADGE[cor]}`}>
                        {formatPercentualBR(percentual)}
                      </span>
                    )}
                  </div>

                  {!bloqueado ? (
                    <button
                      type="button"
                      className={`${btnGhost} !px-2.5 !py-1 !text-[11px]`}
                      onClick={() => toggleModoLoja(loja.id)}
                    >
                      {tarRevelado ? 'Ocultar Total Tar' : 'Calcular pelo Total Tar'}
                    </button>
                  ) : null}

                  {bloqueado ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[var(--teal)]/15 text-[var(--teal)] border-[var(--teal)]/40">
                        ✓ Confirmado
                      </span>
                      <button className={btnGhost} onClick={() => handleEditarLoja(loja.id)}>Editar</button>
                    </div>
                  ) : (
                    <button
                      className={btn}
                      onClick={() => handleConfirmarLoja(loja.id)}
                      disabled={salvando || !preenchido}
                    >
                      {salvando ? 'Salvando...' : 'Confirmar'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---------- View: Relatório de período ----------
function RelatorioView() {
  const [dataInicio, setDataInicio] = useState(() => primeiroDiaDoMes(hojeISO()));
  const [dataFim, setDataFim] = useState(hojeISO);
  const [relatorio, setRelatorio] = useState(null); // null = ainda não gerado nesta sessão
  // já nasce carregando: o efeito abaixo gera automaticamente o relatório do período
  // padrão assim que a tela monta (ver comentário do efeito).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [redeFiltro, setRedeFiltro] = useState('');
  const [corFiltro, setCorFiltro] = useState('');
  const [buscaLoja, setBuscaLoja] = useState('');

  // só dispara o fetch em si; `loading`/`error` são resetados de forma síncrona pelos
  // handlers de evento que disparam este efeito (handleGerar, chamado pelo clique no
  // botão) — nunca dentro do próprio corpo do efeito, mesmo padrão de RankingPage.jsx.
  function runFetchRelatorio() {
    fetchRelatorio(dataInicio, dataFim)
      .then(dados => {
        setRelatorio(dados || []);
        setError(null);
      })
      .catch(err => {
        setError(err.message || 'Erro ao gerar relatório de margens.');
        setRelatorio(null);
      })
      .finally(() => setLoading(false));
  }

  function handleGerar() {
    if (!dataInicio || !dataFim) return;
    setLoading(true);
    setError(null);
    runFetchRelatorio();
  }

  // gera automaticamente na primeira renderização, com o período padrão (mês atual até
  // hoje) — troca de período depois disso exige clicar em "Gerar relatório" de novo,
  // igual ao "Resumo geral do período" da view de Lançamento.
  useEffect(() => {
    runFetchRelatorio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linhasFlat = useMemo(() => (relatorio ? flattenRelatorio(relatorio) : []), [relatorio]);

  const redesDisponiveis = useMemo(() => {
    const map = new Map();
    linhasFlat.forEach(l => { if (!map.has(l.redeId)) map.set(l.redeId, l.redeNome); });
    return Array.from(map, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [linhasFlat]);

  // filtros aplicados EM MEMÓRIA sobre o resultado já buscado — trocar Rede/Cor/busca
  // nunca dispara uma nova chamada de API (só dataInicio/dataFim, via "Gerar relatório").
  const linhasFiltradas = useMemo(() => {
    const busca = buscaLoja.trim().toLowerCase();
    return linhasFlat.filter(l => (
      (!redeFiltro || String(l.redeId) === String(redeFiltro))
      && (!corFiltro || l.cor === corFiltro)
      && (!busca || l.lojaNome.toLowerCase().includes(busca))
    ));
  }, [linhasFlat, redeFiltro, corFiltro, buscaLoja]);

  const gruposFiltrados = useMemo(() => agruparLinhasPorDiretorERede(linhasFiltradas), [linhasFiltradas]);

  // monta o PDF inteiramente no navegador (sem rota nova no backend), respeitando os
  // mesmos filtros aplicados na tela — exporta só o que está sendo mostrado.
  function handleBaixarPdf() {
    if (!linhasFiltradas.length) return;

    const linhas = [...linhasFiltradas].sort((a, b) => (
      a.diretorNome.localeCompare(b.diretorNome, 'pt-BR')
      || a.redeNome.localeCompare(b.redeNome, 'pt-BR')
      || a.lojaNome.localeCompare(b.lojaNome, 'pt-BR')
    ));

    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('Relatório de Margem de Lucro', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    doc.text(`${formatDateFullPt(dataInicio)} a ${formatDateFullPt(dataFim)}`, 14, 23);
    doc.setTextColor(0, 0, 0);

    autoTable(doc, {
      startY: 28,
      columns: [
        { header: 'Diretor', dataKey: 'diretor' },
        { header: 'Rede', dataKey: 'rede' },
        { header: 'Loja', dataKey: 'loja' },
        { header: '% Margem', dataKey: 'percentual' },
        { header: 'Situação', dataKey: 'situacao' },
      ],
      body: linhas.map(l => ({
        diretor: l.diretorNome,
        rede: l.redeNome,
        loja: l.lojaNome,
        percentual: formatPercentualBR(l.percentualMargem),
        situacao: capitalizeCor(l.cor),
      })),
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.dataKey === 'situacao') {
          const cores = COR_PDF[linhas[data.row.index]?.cor];
          if (cores) {
            data.cell.styles.fillColor = cores.fill;
            data.cell.styles.textColor = cores.text;
          }
        }
      },
    });

    doc.save(`margem-${diaMes(dataInicio)}-a-${diaMes(dataFim)}.pdf`);
  }

  return (
    <div>
      <div className="flex gap-2.5 items-end mb-4 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Início</span>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Fim</span>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className={input} />
        </label>
        <button className={btn} onClick={handleGerar} disabled={loading}>
          {loading ? 'Gerando...' : 'Gerar relatório'}
        </button>
        <button className={btnGhost} onClick={handleBaixarPdf} disabled={!linhasFiltradas.length}>
          Baixar PDF
        </button>
      </div>

      <div className="flex gap-2.5 items-end mb-5 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Rede</span>
          <select value={redeFiltro} onChange={e => setRedeFiltro(e.target.value)} className={`${input} min-w-[160px]`}>
            <option value="">Todas</option>
            {redesDisponiveis.map(r => (
              <option key={r.id} value={r.id}>{r.nome}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Cor</span>
          <select value={corFiltro} onChange={e => setCorFiltro(e.target.value)} className={`${input} min-w-[140px]`}>
            <option value="">Todas</option>
            <option value="verde">Verde</option>
            <option value="amarelo">Amarelo</option>
            <option value="vermelho">Vermelho</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Buscar loja</span>
          <input
            type="text" placeholder="Nome da loja..." value={buscaLoja}
            onChange={e => setBuscaLoja(e.target.value)}
            className={`${input} min-w-[180px]`}
          />
        </label>
      </div>

      {loading ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Gerando relatório...</div>
      ) : error ? (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
          <span>Não foi possível gerar o relatório: {error}</span>
          <button className={btnGhost} onClick={handleGerar}>Tentar novamente</button>
        </div>
      ) : relatorio === null ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
          Selecione um período e clique em &quot;Gerar relatório&quot;.
        </div>
      ) : relatorio.length === 0 ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
          Nenhum lançamento de margem encontrado nesse período.
        </div>
      ) : gruposFiltrados.length === 0 ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
          Nenhum resultado para os filtros aplicados.
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {gruposFiltrados.map(grupo => (
            <div className={card} key={grupo.diretorId}>
              <h2 className="font-display text-[22px] font-bold m-0 mb-3.5">{grupo.diretorNome}</h2>
              {grupo.redes.map(rede => (
                <div key={rede.redeId} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-[15px] font-bold">{rede.redeNome}</h3>
                    {rede.responsavelNome ? (
                      <span className="text-[12px] text-[var(--muted)] font-medium">GG: {rede.responsavelNome}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {rede.lojas.map(loja => (
                      <div key={loja.lojaId} className="flex items-center gap-3 px-3 py-2 rounded-[9px] bg-[var(--panel-alt)]">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${COR_BOLINHA[loja.cor] || 'bg-[var(--muted)]'}`} />
                        <span className="flex-1 text-[14px] font-semibold">{loja.lojaNome}</span>
                        <span className="text-[13px] text-[var(--muted)]">Margem: {formatPercentualBR(loja.percentualMargem)}</span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${COR_BADGE[loja.cor] || 'bg-[var(--panel-alt)] text-[var(--muted)] border-[var(--border)]'}`}>
                          {capitalizeCor(loja.cor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
