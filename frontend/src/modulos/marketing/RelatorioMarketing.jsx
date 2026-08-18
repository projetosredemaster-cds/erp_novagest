// style-system: Tailwind
// View de topo "Relatório de visão geral" do módulo Marketing — multi-mês, só percentual
// (`percentualMarketing`), acessada por um botão no cabeçalho de MarketingPage.jsx (mesmo
// mecanismo de troca de view — state + botão `btnGhost` — já usado em MargensPage.jsx entre
// "Lançamento" e "Relatório de período"). SEM endpoint novo: reaproveita
// GET /api/marketing/entradas?ano=&mes= (fetchEntradas, já existente em marketingApi.js)
// chamado uma vez por mês do intervalo, mais UM mês extra ANTES do início só pra poder
// colorir a 1ª coluna visível (nunca vira coluna da tabela) — ver useEffect abaixo.
//
// Diferente do fetch de apoio do mês anterior em MarketingPage.jsx (`.catch(() => [])`, só
// apoio visual da linha de TOTAL), aqui TODOS os meses buscados (inclusive o extra) são
// conteúdo necessário pra montar a tabela inteira — se qualquer chamada falhar, o relatório
// inteiro vira erro com "Tentar novamente" (mesmo padrão visual de EstadoCarregamento já
// usado em MarketingPage.jsx, replicado aqui porque não está exportado de lá).
//
// Não recebe estado de diretor próprio: `diretorId` vem do MESMO <select> compartilhado no
// cabeçalho de MarketingPage.jsx (não duplicamos esse estado aqui) — a seleção persiste ao
// alternar entre "lancamento" e "relatorio". `diretores` (lista já agrupada por
// MarketingPage.jsx) é usado só pra exibir o nome do diretor selecionado no subtítulo.
import { useEffect, useMemo, useState, Fragment } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fetchEntradas } from './marketingApi.js';
import {
  periodoAnterior,
  enumerarPeriodos,
  somarCampoLojas,
  percentualSobreTotal,
  compararTotais,
  formatPercentualBR,
  SETA_PERCENTUAL,
} from './marketingFormat.js';

// cores RGB usadas no PDF (jspdf-autotable, célula por célula), separadas das classes
// Tailwind usadas na tela porque o PDF é desenhado fora do DOM e não enxerga CSS — mesmo
// princípio de COR_PDF em MargensPage.jsx. Tons -600 do Tailwind (emerald/orange), mais
// saturados que o emerald-400/orange-400 usados na tela, pra manter contraste de texto
// branco legível no PDF.
const COR_PDF = {
  subiu: { fillColor: [5, 150, 105], textColor: [255, 255, 255] },
  caiu: { fillColor: [234, 88, 12], textColor: [255, 255, 255] },
};

// remove acentuação e caracteres não alfanuméricos pro nome do arquivo do PDF (ex.: "João
// Hugo" -> "joao-hugo") — só usado no nome do arquivo, não afeta nenhum texto exibido.
function slugify(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'diretor';
}
// "YYYY-MM" com mês sempre com 2 dígitos, pro nome do arquivo (chavePeriodo abaixo não
// preenche zero à esquerda no mês, o que ficaria estranho num nome de arquivo).
function formatMesArquivo({ ano, mes }) {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";
const input = "bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

function mesAnoAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}
// mês/ano `qtd` meses antes de `mesAno` ("YYYY-MM") — usado só pro default de mesInicio
// (janela padrão de 6 meses terminando no mês atual; não há um período "oficial" pedido pra
// este relatório, ver resumo da tarefa).
function subtrairMeses(mesAno, qtd) {
  const [anoStr, mesStr] = mesAno.split('-');
  let ano = Number(anoStr);
  let mes = Number(mesStr) - qtd;
  while (mes < 1) { mes += 12; ano -= 1; }
  return `${ano}-${String(mes).padStart(2, '0')}`;
}
function labelMes({ ano, mes }) {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}
function chavePeriodo({ ano, mes }) {
  return `${ano}-${mes}`;
}

// index lojaId -> loja (percentualMarketing/faturamentoGeral/faturamentoMarketing etc.) a
// partir do array flat de blocos de UM período — usado pra procurar o valor de uma loja
// específica em cada coluna/mês sem refazer a hierarquia inteira a cada célula.
function indexarLojasPorId(blocos) {
  const map = new Map();
  (blocos || []).forEach(bloco => {
    (bloco.lojas || []).forEach(loja => map.set(loja.id, loja));
  });
  return map;
}

// célula de percentual (item 5 do pedido): sem dado no mês atual -> "—", sem cor; com dado
// no atual mas sem dado no anterior -> percentual sem cor; com dado nos dois -> cor conforme
// compararTotais (subiu = verde/SETA_PERCENTUAL.subiu, caiu = laranja/SETA_PERCENTUAL.caiu,
// igual = sem classe, já que SETA_PERCENTUAL não tem entrada pra "igual"). Reaproveita
// compararTotais/SETA_PERCENTUAL/formatPercentualBR já existentes em marketingFormat.js —
// não duplica lógica de comparação/cor.
function calcularCelula(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) {
    return { texto: '—', classe: '' };
  }
  const estado = compararTotais(percentualAtual, percentualAnterior);
  return { texto: formatPercentualBR(percentualAtual), classe: SETA_PERCENTUAL[estado]?.classe ?? '' };
}

// mesma regra de cor de calcularCelula acima, só que devolvendo estilo pro jspdf-autotable
// (fillColor/textColor RGB, ver COR_PDF) em vez de classe Tailwind — célula "crua" (string)
// quando não há cor a aplicar (sem dado, ou percentual igual ao mês anterior).
function celulaPdf(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) return '—';
  const estado = compararTotais(percentualAtual, percentualAnterior);
  const texto = formatPercentualBR(percentualAtual);
  const cores = COR_PDF[estado];
  return cores ? { content: texto, styles: cores } : texto;
}

// linha de subtotal (por Rede) ou total geral (por Diretor) pro PDF — MESMA agregação
// SOMA/SOMA de LinhaTotal abaixo (somarCampoLojas + percentualSobreTotal, reaproveitadas de
// marketingFormat.js), só que devolvendo um array de células pro body do autoTable em vez de
// JSX, já que autoTable roda fora do DOM.
function linhaTotalPdf(label, lojas, periodosVisiveis, indicesPorPeriodo) {
  const linha = [{ content: label, styles: { fontStyle: 'bold' } }];
  periodosVisiveis.forEach((periodo, i) => {
    const registrosAtual = lojas.map(l => indicesPorPeriodo[i + 1]?.get(l.id));
    const registrosAnterior = lojas.map(l => indicesPorPeriodo[i]?.get(l.id));
    const percentualAtual = percentualSobreTotal(
      somarCampoLojas(registrosAtual, 'faturamentoMarketing'),
      somarCampoLojas(registrosAtual, 'faturamentoGeral'),
    );
    const percentualAnterior = percentualSobreTotal(
      somarCampoLojas(registrosAnterior, 'faturamentoMarketing'),
      somarCampoLojas(registrosAnterior, 'faturamentoGeral'),
    );
    const cel = celulaPdf(percentualAtual, percentualAnterior);
    linha.push(typeof cel === 'string'
      ? { content: cel, styles: { fontStyle: 'bold' } }
      : { content: cel.content, styles: { ...cel.styles, fontStyle: 'bold' } });
  });
  return linha;
}

// mesmo bloco de loading/erro de MarketingPage.jsx (EstadoCarregamento, não exportado de
// lá) — duplicado aqui de propósito, ver comentário no topo do arquivo.
function EstadoCarregamento({ loading, error, onRetry }) {
  if (loading) {
    return <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>;
  }
  if (error) {
    return (
      <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
        <span>Não foi possível carregar o relatório de marketing: {error}</span>
        <button className={btnGhost} onClick={onRetry}>Tentar novamente</button>
      </div>
    );
  }
  return null;
}

export default function RelatorioMarketing({ diretorId, diretores }) {
  const [mesInicio, setMesInicio] = useState(() => subtrairMeses(mesAnoAtual(), 5));
  const [mesFim, setMesFim] = useState(mesAnoAtual);
  // paralelo a [periodoAnterior(periodosVisiveis[0]), ...periodosVisiveis] — um array de
  // blocos (o mesmo formato flat que fetchEntradas devolve) por posição.
  const [dadosPorPeriodo, setDadosPorPeriodo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const diretorSelecionado = diretorId !== '' && diretorId !== null && diretorId !== undefined;

  const periodosVisiveis = useMemo(() => enumerarPeriodos(mesInicio, mesFim), [mesInicio, mesFim]);
  const periodoValido = periodosVisiveis.length > 0;
  const mensagemPeriodoInvalido = !mesInicio || !mesFim
    ? 'Selecione o mês inicial e o mês final.'
    : 'O mês final não pode ser anterior ao mês inicial.';

  // `loading`/`error` só são resetados de forma síncrona nos handlers de evento que disparam
  // este efeito (handleMesInicioChange/handleMesFimChange/handleRetry, abaixo) — mesmo padrão
  // de MarketingPage.jsx, e nunca dentro do próprio corpo do efeito (regra do
  // react-hooks/set-state-in-effect). Período inválido (fim < início, ou algum dos dois
  // vazio) simplesmente não dispara fetch nenhum: `loading`/`dadosPorPeriodo` ficam parados
  // no último valor, mas isso é inofensivo porque o branch de render que os usa
  // (EstadoCarregamento/tabela) só aparece quando `periodoValido` é true — a mensagem de
  // período inválido é um branch à parte que não depende de `loading`.
  useEffect(() => {
    if (!periodoValido) return;
    let cancelled = false;
    // um mês ANTES do início do intervalo, só pra poder colorir a 1ª coluna visível — nunca
    // vira coluna da tabela (ver item 3 do pedido original).
    const anterior = periodoAnterior(periodosVisiveis[0].ano, periodosVisiveis[0].mes);
    const periodosBusca = [anterior, ...periodosVisiveis];
    // TODOS os meses (inclusive o extra) são conteúdo principal do relatório — diferente do
    // fetch de apoio do mês anterior em MarketingPage.jsx, aqui não há `.catch(() => [])` por
    // chamada individual: qualquer falha vira erro do relatório inteiro.
    Promise.all(periodosBusca.map(p => fetchEntradas({ ano: p.ano, mes: p.mes })))
      .then(resultados => {
        if (cancelled) return;
        setDadosPorPeriodo(resultados.map(r => r || []));
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Erro ao carregar o relatório de marketing.');
        setDadosPorPeriodo([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesInicio, mesFim, reloadToken]);

  function handleMesInicioChange(valor) {
    setLoading(true);
    setError(null);
    setMesInicio(valor);
  }
  function handleMesFimChange(valor) {
    setLoading(true);
    setError(null);
    setMesFim(valor);
  }
  function handleRetry() {
    setLoading(true);
    setError(null);
    setReloadToken(t => t + 1);
  }

  // um índice (lojaId -> loja) por período buscado, na mesma ordem de dadosPorPeriodo —
  // reconstruído só quando os dados mudam, não a cada célula renderizada.
  const indicesPorPeriodo = useMemo(() => dadosPorPeriodo.map(indexarLojasPorId), [dadosPorPeriodo]);

  // hierarquia Diretor->Rede->Loja vem SEMPRE do mês MAIS RECENTE do intervalo (mesFim,
  // último item de dadosPorPeriodo) — evita mostrar uma loja/rede desativada depois (item 4
  // do pedido). Filtra só o diretor selecionado no cabeçalho de MarketingPage.jsx.
  const redesDoDiretor = useMemo(() => {
    if (!periodoValido || !diretorSelecionado) return null;
    const blocosMesFim = dadosPorPeriodo[dadosPorPeriodo.length - 1] || [];
    const map = new Map();
    blocosMesFim
      .filter(bloco => bloco.diretor.id === diretorId)
      .forEach(bloco => {
        map.set(bloco.rede.id, { id: bloco.rede.id, nome: bloco.rede.nome, lojas: bloco.lojas || [] });
      });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [dadosPorPeriodo, diretorId, diretorSelecionado, periodoValido]);

  const diretorNome = useMemo(
    () => (diretores || []).find(d => d.id === diretorId)?.nome ?? null,
    [diretores, diretorId],
  );

  const temDadosParaExportar = !!redesDoDiretor && redesDoDiretor.length > 0;

  // monta o PDF inteiramente no navegador (jsPDF + jspdf-autotable, sem rota nova no
  // backend — mesma abordagem de handleBaixarPdf em MargensPage.jsx), com a MESMA tabela
  // exibida na tela: lojas agrupadas por Rede, uma coluna por mês, subtotal por Rede e total
  // do diretor ao final — reaproveitando os mesmos índices/agregações já calculados pro
  // render (indicesPorPeriodo, somarCampoLojas, percentualSobreTotal), não uma cópia deles.
  function handleBaixarPdf() {
    if (!temDadosParaExportar) return;

    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('Relatório de Visão Geral — Marketing', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    const periodoTexto = `${labelMes(periodosVisiveis[0])} a ${labelMes(periodosVisiveis[periodosVisiveis.length - 1])}`;
    doc.text(`${diretorNome ?? ''} — ${periodoTexto}`, 14, 23);
    doc.setTextColor(0, 0, 0);

    const head = [['Loja', ...periodosVisiveis.map(labelMes)]];
    const body = [];
    redesDoDiretor.forEach(rede => {
      body.push([{
        content: rede.nome,
        colSpan: periodosVisiveis.length + 1,
        styles: { fontStyle: 'bold', fillColor: [235, 235, 235] },
      }]);
      if (rede.lojas.length === 0) {
        body.push([{
          content: 'Nenhuma loja cadastrada nesta rede.',
          colSpan: periodosVisiveis.length + 1,
          styles: { textColor: [140, 140, 140] },
        }]);
        return;
      }
      rede.lojas.forEach(loja => {
        const linha = [loja.nome];
        periodosVisiveis.forEach((periodo, i) => {
          const atual = indicesPorPeriodo[i + 1]?.get(loja.id)?.percentualMarketing ?? null;
          const anterior = indicesPorPeriodo[i]?.get(loja.id)?.percentualMarketing ?? null;
          linha.push(celulaPdf(atual, anterior));
        });
        body.push(linha);
      });
      body.push(linhaTotalPdf(`Total ${rede.nome}`, rede.lojas, periodosVisiveis, indicesPorPeriodo));
    });
    body.push(linhaTotalPdf('Total geral do diretor', redesDoDiretor.flatMap(r => r.lojas), periodosVisiveis, indicesPorPeriodo));

    autoTable(doc, { startY: 28, head, body, styles: { fontSize: 9 } });

    const nomeArquivo = `relatorio-marketing-${slugify(diretorNome)}-${formatMesArquivo(periodosVisiveis[0])}-a-${formatMesArquivo(periodosVisiveis[periodosVisiveis.length - 1])}.pdf`;
    doc.save(nomeArquivo);
  }

  return (
    <div className={card}>
      <h2 className="font-display text-[20px] font-bold m-0 mb-1">Relatório de visão geral — % Marketing</h2>
      <p className="text-[12px] text-[var(--muted)] mb-4">
        Percentual de faturamento vindo de marketing por loja, mês a mês{diretorNome ? ` — ${diretorNome}` : ''}.
        A cor compara sempre com o mês imediatamente anterior na MESMA linha (verde = subiu, laranja = caiu).
      </p>

      <div className="flex gap-3 flex-wrap items-end mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-[var(--muted)] font-semibold" id="relatorio-marketing-inicio-label">Mês inicial</span>
          <input
            type="month"
            aria-labelledby="relatorio-marketing-inicio-label"
            value={mesInicio}
            onChange={e => handleMesInicioChange(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-[var(--muted)] font-semibold" id="relatorio-marketing-fim-label">Mês final</span>
          <input
            type="month"
            aria-labelledby="relatorio-marketing-fim-label"
            value={mesFim}
            onChange={e => handleMesFimChange(e.target.value)}
            className={input}
          />
        </label>
        {/* Sem um botão "Gerar relatório" próprio nesta tela (a busca já dispara sozinha ao
            trocar mês inicial/final, ver useEffect acima) — "Baixar PDF" fica ao lado dos
            filtros de período, mesmo componente de botão (`btnGhost`) e mesma regra de
            desabilitado de MargensPage.jsx: sem dado carregado, não tem o que exportar. */}
        <button type="button" className={btnGhost} onClick={handleBaixarPdf} disabled={!temDadosParaExportar}>
          Baixar PDF
        </button>
      </div>

      {!periodoValido ? (
        <div className="text-[var(--muted)] text-sm px-1 py-6">{mensagemPeriodoInvalido}</div>
      ) : (
        <>
          <EstadoCarregamento loading={loading} error={error} onRetry={handleRetry} />
          {!loading && !error ? (
            !diretorSelecionado ? (
              <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
                Selecione um diretor acima para ver o relatório de visão geral dele.
              </div>
            ) : (redesDoDiretor || []).length === 0 ? (
              <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
                Nenhuma rede/loja encontrada para este diretor no período selecionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-2 py-1.5 text-left text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">
                        Loja
                      </th>
                      {periodosVisiveis.map(p => (
                        <th
                          key={chavePeriodo(p)}
                          className="px-2 py-1.5 text-right text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]"
                        >
                          {labelMes(p)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {redesDoDiretor.map(rede => (
                      <Fragment key={rede.id}>
                        <tr>
                          <td
                            colSpan={periodosVisiveis.length + 1}
                            className="pt-4 pb-1 px-2 text-[12px] font-semibold text-[var(--muted)] uppercase tracking-[.03em]"
                          >
                            {rede.nome}
                          </td>
                        </tr>
                        {rede.lojas.length === 0 ? (
                          <tr>
                            <td colSpan={periodosVisiveis.length + 1} className="px-2 py-2 text-[13px] text-[var(--muted)]">
                              Nenhuma loja cadastrada nesta rede.
                            </td>
                          </tr>
                        ) : (
                          <>
                            {rede.lojas.map(loja => (
                              <tr key={loja.id} className="border-t border-[var(--border)]">
                                <td className="px-2 py-1.5 text-left">{loja.nome}</td>
                                {periodosVisiveis.map((periodo, i) => {
                                  const atual = indicesPorPeriodo[i + 1]?.get(loja.id)?.percentualMarketing ?? null;
                                  const anterior = indicesPorPeriodo[i]?.get(loja.id)?.percentualMarketing ?? null;
                                  const { texto, classe } = calcularCelula(atual, anterior);
                                  return (
                                    <td key={chavePeriodo(periodo)} className={`px-2 py-1.5 text-right font-semibold ${classe}`}>
                                      {texto}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                            <LinhaTotal
                              label={`Total ${rede.nome}`}
                              lojas={rede.lojas}
                              periodosVisiveis={periodosVisiveis}
                              indicesPorPeriodo={indicesPorPeriodo}
                            />
                          </>
                        )}
                      </Fragment>
                    ))}
                    <LinhaTotal
                      label="Total geral do diretor"
                      lojas={redesDoDiretor.flatMap(r => r.lojas)}
                      periodosVisiveis={periodosVisiveis}
                      indicesPorPeriodo={indicesPorPeriodo}
                      destaque
                    />
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

// linha de subtotal (por Rede) ou total geral (por Diretor) — SOMA/SOMA por mês
// (somarCampoLojas + percentualSobreTotal, ambas reaproveitadas de marketingFormat.js, MESMA
// lógica já usada em TotalGeralRow.jsx pro total do Diretor na view de Lançamento — nunca
// média de percentuais individuais). `lojas` é a lista CANÔNICA (do mês mais recente, id +
// nome); os valores de faturamento de cada mês são buscados no índice daquele período —
// uma loja sem lançamento num mês específico simplesmente não contribui pra soma daquele mês
// (mesmo critério de somarCampoLojas, que ignora campo null/undefined).
function LinhaTotal({ label, lojas, periodosVisiveis, indicesPorPeriodo, destaque = false }) {
  return (
    <tr
      className={
        destaque
          ? 'border-t-2 border-[var(--border)] font-bold'
          : 'border-t border-[var(--border)] font-semibold bg-[var(--panel-alt)]'
      }
    >
      <td className="px-2 py-1.5 text-left text-[12px] uppercase tracking-[.03em] text-[var(--muted)]">
        {label}
      </td>
      {periodosVisiveis.map((periodo, i) => {
        const registrosAtual = lojas.map(l => indicesPorPeriodo[i + 1]?.get(l.id));
        const registrosAnterior = lojas.map(l => indicesPorPeriodo[i]?.get(l.id));
        const percentualAtual = percentualSobreTotal(
          somarCampoLojas(registrosAtual, 'faturamentoMarketing'),
          somarCampoLojas(registrosAtual, 'faturamentoGeral'),
        );
        const percentualAnterior = percentualSobreTotal(
          somarCampoLojas(registrosAnterior, 'faturamentoMarketing'),
          somarCampoLojas(registrosAnterior, 'faturamentoGeral'),
        );
        const { texto, classe } = calcularCelula(percentualAtual, percentualAnterior);
        return (
          <td key={chavePeriodo(periodo)} className={`px-2 py-1.5 text-right ${classe}`}>
            {texto}
          </td>
        );
      })}
    </tr>
  );
}
