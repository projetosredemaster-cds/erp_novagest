// style-system: Tailwind
import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchRedes } from '../../lib/cadastrosApi.js';
import { fetchEntradas, salvarEntrada, fetchRelatorio } from './margensApi.js';

// ---------- máscara monetária BR (mesma lógica de RankingPage.jsx — ainda não há
// um util compartilhado entre os módulos, ver CLAUDE.md) ----------
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
// campo vazio/indefinido vira 0 só na hora de montar o payload pro backend — os 3
// campos obrigatórios de POST /api/margens/entradas (faturamento/custos/cartoes) não
// podem ir undefined, e franquia/despesas têm default 0 no próprio contrato.
function numOrZero(v) {
  return v === '' || v === undefined || v === null ? 0 : (Number(v) || 0);
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
function contarLojasAtivas(diretores) {
  return diretores.reduce((total, d) => (
    total + d.redes.reduce((s, r) => s + (r.lojas || []).filter(l => l.ativo !== false).length, 0)
  ), 0);
}

// GET /api/margens/relatorio devolve uma lista de blocos (um por rede, com diretor
// repetido quando o diretor tem mais de uma rede) — agrupa por diretor só para exibição.
function agruparRelatorioPorDiretor(blocos) {
  const map = new Map();
  blocos.forEach(bloco => {
    const dId = bloco.diretor.id;
    if (!map.has(dId)) map.set(dId, { diretor: bloco.diretor, redes: [] });
    map.get(dId).redes.push({ rede: bloco.rede, lojas: bloco.lojas });
  });
  return Array.from(map.values());
}

const CAMPOS_VALOR = [
  { key: 'faturamento', label: 'Faturamento' },
  { key: 'franquia', label: 'Franquia' },
  { key: 'custos', label: 'Custos' },
  { key: 'cartoes', label: 'Cartões' },
  { key: 'despesas', label: 'Despesas' },
];

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
              {currentView === 'lancamento' ? 'Lançamento diário' : 'Relatório de período'}
            </h1>
          </div>
          <div className="flex gap-2.5 items-center">
            <button
              className={btnGhost}
              onClick={() => setCurrentView(v => (v === 'lancamento' ? 'relatorio' : 'lancamento'))}
            >
              {currentView === 'lancamento' ? '📊 Ver relatório de período' : '← Voltar ao lançamento diário'}
            </button>
          </div>
        </div>

        {currentView === 'lancamento'
          ? <LancamentoView flash={flash} />
          : <RelatorioView flash={flash} />}
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

// ---------- View: Lançamento diário ----------
function LancamentoView({ flash }) {
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [diretores, setDiretores] = useState([]);
  const [entradasByLoja, setEntradasByLoja] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // contador incrementado só pelo botão "Tentar novamente" — força o efeito abaixo a
  // rodar de novo mesmo quando a data não mudou (o efeito não pode resetar
  // loading/error sozinho de forma síncrona, ver comentário abaixo).
  const [reloadToken, setReloadToken] = useState(0);

  // dependências intencionais: refaz a busca completa (árvore + entradas) sempre que a
  // data mudar ou o usuário clicar em "Tentar novamente", igual ao pedido ("ao
  // montar/trocar de data"). `loading`/`error` só são resetados de forma síncrona nos
  // handlers de evento que disparam esse efeito (handleDateChange/handleRetry) — nunca
  // dentro do próprio corpo do efeito, mesmo padrão do fetch de entradas em RankingPage.jsx.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRedes(), fetchEntradas(currentDate)])
      .then(([redes, entradas]) => {
        if (cancelled) return;
        setDiretores(agruparRedesPorDiretor(redes || []));
        const map = {};
        (entradas || []).forEach(e => {
          map[e.loja_id] = {
            faturamento: e.faturamento,
            franquia: e.franquia,
            custos: e.custos,
            cartoes: e.cartoes,
            despesas: e.despesas,
          };
        });
        setEntradasByLoja(map);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Erro ao carregar dados do servidor.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentDate, reloadToken]);

  function handleDateChange(novaData) {
    setLoading(true);
    setCurrentDate(novaData);
  }

  function handleRetry() {
    setLoading(true);
    setReloadToken(t => t + 1);
  }

  function handleFieldChange(lojaId, campo, digitos) {
    const valor = digitosParaValor(digitos);
    setEntradasByLoja(prev => ({ ...prev, [lojaId]: { ...(prev[lojaId] || {}), [campo]: valor } }));
  }

  function handleFieldBackspace(lojaId, campo) {
    const digitosAtuais = valorParaDigitos((entradasByLoja[lojaId] || {})[campo]);
    handleFieldChange(lojaId, campo, digitosAtuais.slice(0, -1));
  }

  function handleFieldPaste(lojaId, campo, texto) {
    const valor = parseValorBR(texto);
    setEntradasByLoja(prev => ({ ...prev, [lojaId]: { ...(prev[lojaId] || {}), [campo]: valor } }));
  }

  // envia o registro COMPLETO da loja (os 5 campos), não só o campo alterado — o
  // upsert do backend não é parcial (ver CONTRATO-MARGENS-API.md seção 2), então
  // cada blur reenvia o estado atual inteiro, com os campos ainda não digitados
  // defaultando pra 0 (numOrZero).
  function handleFieldBlur(lojaId, campo, rawValue) {
    const valor = parseValorBR(rawValue);
    const registroAtual = { ...(entradasByLoja[lojaId] || {}), [campo]: valor };
    setEntradasByLoja(prev => ({ ...prev, [lojaId]: registroAtual }));
    salvarEntrada({
      data: currentDate,
      lojaId,
      faturamento: numOrZero(registroAtual.faturamento),
      franquia: numOrZero(registroAtual.franquia),
      custos: numOrZero(registroAtual.custos),
      cartoes: numOrZero(registroAtual.cartoes),
      despesas: numOrZero(registroAtual.despesas),
    })
      .then(() => flash('Salvo'))
      .catch(err => flash(err.message || 'Erro ao salvar lançamento', 'error'));
  }

  const totalLojas = useMemo(() => contarLojasAtivas(diretores), [diretores]);

  return (
    <div>
      <div className="flex gap-2.5 items-center mb-5">
        <label htmlFor="margens-data" className="text-[13px] text-[var(--muted)] font-semibold">Data</label>
        <input
          id="margens-data"
          type="date"
          value={currentDate}
          onChange={e => handleDateChange(e.target.value)}
          className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm"
        />
      </div>

      {loading ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>
      ) : error ? (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
          <span>Não foi possível carregar os dados do servidor: {error}</span>
          <button className={btnGhost} onClick={handleRetry}>Tentar novamente</button>
        </div>
      ) : totalLojas === 0 ? (
        <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
          Nenhuma rede/loja cadastrada ainda. Cadastre diretores, redes e lojas para começar a lançar margem.
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {diretores.map(diretor => (
            <div className={card} key={diretor.id}>
              <h2 className="font-display text-[22px] font-bold m-0 mb-3.5">{diretor.nome}</h2>
              {diretor.redes.map(rede => {
                const lojasAtivas = (rede.lojas || []).filter(l => l.ativo !== false);
                return (
                  <div key={rede.id} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 mb-2">
                      {rede.emoji ? <span className="text-base">{rede.emoji}</span> : null}
                      <h3 className="text-[15px] font-bold">{rede.nome}</h3>
                      <span className="text-[12px] text-[var(--muted)] font-medium">
                        {rede.responsavel?.nome ? `GG: ${rede.responsavel.nome}` : 'sem GG'}
                      </span>
                    </div>
                    {lojasAtivas.length ? (
                      <div className="flex flex-col gap-2">
                        {lojasAtivas.map(loja => (
                          <div key={loja.id} className="bg-[var(--panel-alt)] border border-[var(--border)] rounded-[9px] px-3 py-2.5">
                            <div className="text-[13.5px] font-semibold mb-2">{loja.nome}</div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                              {CAMPOS_VALOR.map(campo => (
                                <label key={campo.key} className="flex flex-col gap-1">
                                  <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">{campo.label}</span>
                                  <input
                                    type="text" inputMode="decimal" placeholder="0,00"
                                    value={formatarDigitosBR(valorParaDigitos((entradasByLoja[loja.id] || {})[campo.key]))}
                                    onChange={e => {
                                      handleFieldChange(loja.id, campo.key, extrairDigitos(e.target.value));
                                      moveCaretToEnd(e.target);
                                    }}
                                    onKeyDown={e => {
                                      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                                      e.preventDefault();
                                      handleFieldBackspace(loja.id, campo.key);
                                      moveCaretToEnd(e.target);
                                    }}
                                    onPaste={e => {
                                      e.preventDefault();
                                      handleFieldPaste(loja.id, campo.key, e.clipboardData.getData('text'));
                                      moveCaretToEnd(e.target);
                                    }}
                                    onBlur={e => handleFieldBlur(loja.id, campo.key, e.target.value)}
                                    className="font-display bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)]"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[var(--muted)] text-[13px] px-1 py-1.5">Nenhuma loja cadastrada nesta rede ainda.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- View: Relatório de período ----------
function RelatorioView({ flash }) {
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));
  const [relatorio, setRelatorio] = useState(null); // null = ainda não gerado nesta sessão
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleGerar() {
    if (!dataInicio || !dataFim) {
      flash('Selecione o período (início e fim).', 'error');
      return;
    }
    setLoading(true);
    setError(null);
    fetchRelatorio(dataInicio, dataFim)
      .then(dados => setRelatorio(dados || []))
      .catch(err => {
        setError(err.message || 'Erro ao gerar relatório de margens.');
        setRelatorio(null);
      })
      .finally(() => setLoading(false));
  }

  const grupos = useMemo(() => (relatorio ? agruparRelatorioPorDiretor(relatorio) : []), [relatorio]);

  // monta o PDF inteiramente no navegador (sem rota nova no backend), a partir do
  // último relatório já gerado em tela.
  function handleBaixarPdf() {
    if (!relatorio || !relatorio.length) return;

    const linhas = [];
    relatorio.forEach(bloco => {
      bloco.lojas.forEach(loja => {
        linhas.push({
          diretor: bloco.diretor.nome,
          rede: bloco.rede.nome,
          loja: loja.nome,
          percentual: loja.percentualLucroBruto,
          cor: loja.cor,
        });
      });
    });
    linhas.sort((a, b) => (
      a.diretor.localeCompare(b.diretor, 'pt-BR')
      || a.rede.localeCompare(b.rede, 'pt-BR')
      || a.loja.localeCompare(b.loja, 'pt-BR')
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
        { header: '% Lucro Bruto', dataKey: 'percentual' },
        { header: 'Situação', dataKey: 'situacao' },
      ],
      body: linhas.map(l => ({
        diretor: l.diretor,
        rede: l.rede,
        loja: l.loja,
        percentual: formatPercentualBR(l.percentual),
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
      <div className="flex gap-2.5 items-end mb-5 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Início</span>
          <input
            type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-[var(--muted)] font-semibold">Fim</span>
          <input
            type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm"
          />
        </label>
        <button className={btn} onClick={handleGerar} disabled={loading}>
          {loading ? 'Gerando...' : 'Gerar relatório'}
        </button>
        <button className={btnGhost} onClick={handleBaixarPdf} disabled={!relatorio || !relatorio.length}>
          Baixar PDF
        </button>
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
      ) : (
        <div className="flex flex-col gap-[18px]">
          {grupos.map(grupo => (
            <div className={card} key={grupo.diretor.id}>
              <h2 className="font-display text-[22px] font-bold m-0 mb-3.5">{grupo.diretor.nome}</h2>
              {grupo.redes.map(({ rede, lojas }) => (
                <div key={rede.id} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-[15px] font-bold">{rede.nome}</h3>
                    {rede.responsavel?.nome ? (
                      <span className="text-[12px] text-[var(--muted)] font-medium">GG: {rede.responsavel.nome}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {lojas.map(loja => (
                      <div key={loja.id} className="flex items-center gap-3 px-3 py-2 rounded-[9px] bg-[var(--panel-alt)]">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${COR_BOLINHA[loja.cor] || 'bg-[var(--muted)]'}`} />
                        <span className="flex-1 text-[14px] font-semibold">{loja.nome}</span>
                        <span className="text-[13px] text-[var(--muted)]">Lucro bruto: {formatPercentualBR(loja.percentualLucroBruto)}</span>
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
