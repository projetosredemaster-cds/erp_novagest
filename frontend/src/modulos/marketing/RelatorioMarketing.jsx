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

const COR_PDF = {
  subiu: { fillColor: [5, 150, 105], textColor: [255, 255, 255] },
  caiu: { fillColor: [234, 88, 12], textColor: [255, 255, 255] },
};

function slugify(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'diretor';
}

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
function indexarLojasPorId(blocos) {
  const map = new Map();
  (blocos || []).forEach(bloco => {
    (bloco.lojas || []).forEach(loja => map.set(loja.id, loja));
  });
  return map;
}

function calcularCelula(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) {
    return { texto: '—', classe: '' };
  }
  const estado = compararTotais(percentualAtual, percentualAnterior);
  return { texto: formatPercentualBR(percentualAtual), classe: SETA_PERCENTUAL[estado]?.classe ?? '' };
}

function celulaPdf(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) return '—';
  const estado = compararTotais(percentualAtual, percentualAnterior);
  const texto = formatPercentualBR(percentualAtual);
  const cores = COR_PDF[estado];
  return cores ? { content: texto, styles: cores } : texto;
}

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

  useEffect(() => {
    if (!periodoValido) return;
    let cancelled = false;
    const anterior = periodoAnterior(periodosVisiveis[0].ano, periodosVisiveis[0].mes);
    const periodosBusca = [anterior, ...periodosVisiveis];
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

  const indicesPorPeriodo = useMemo(() => dadosPorPeriodo.map(indexarLojasPorId), [dadosPorPeriodo]);

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
        {}
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
