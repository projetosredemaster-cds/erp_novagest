
import { useMemo } from 'react';
import {
  somarCampoLojas,
  percentualSobreTotal,
  compararTotais,
  variacaoPercentual,
  variacaoPontosPercentuais,
  calcularRankingVariacao,
  formatMoedaBR,
  formatPercentualBR,
  formatVariacaoBR,
  corCardPorFaturamentoGeral,
  SETA_PERCENTUAL,
} from './marketingFormat.js';

function achatarLojas(blocos) {
  return (blocos || []).flatMap(bloco =>
    (bloco.lojas || []).map(loja => ({ ...loja, rede: bloco.rede, diretor: bloco.diretor })),
  );
}

export default function DashboardMarketing({ blocos, blocosAnteriores }) {
  const lojasAtual = useMemo(() => achatarLojas(blocos), [blocos]);
  const lojasAnterior = useMemo(() => achatarLojas(blocosAnteriores), [blocosAnteriores]);

  const totalGeralAtual = useMemo(() => somarCampoLojas(lojasAtual, 'faturamentoGeral'), [lojasAtual]);
  const totalMarketingAtual = useMemo(() => somarCampoLojas(lojasAtual, 'faturamentoMarketing'), [lojasAtual]);
  const totalGeralAnterior = useMemo(() => somarCampoLojas(lojasAnterior, 'faturamentoGeral'), [lojasAnterior]);
  const totalMarketingAnterior = useMemo(() => somarCampoLojas(lojasAnterior, 'faturamentoMarketing'), [lojasAnterior]);

  const percentualAtual = percentualSobreTotal(totalMarketingAtual, totalGeralAtual);
  const percentualAnterior = percentualSobreTotal(totalMarketingAnterior, totalGeralAnterior);

  const estadoGeral = compararTotais(totalGeralAtual, totalGeralAnterior);
  const estadoMarketing = compararTotais(totalMarketingAtual, totalMarketingAnterior);
  const variacaoGeralPct = variacaoPercentual(totalGeralAtual, totalGeralAnterior);
  const variacaoMarketingPct = variacaoPercentual(totalMarketingAtual, totalMarketingAnterior);
  const variacaoPontos = variacaoPontosPercentuais(percentualAtual, percentualAnterior);
  const estadoPercentual = variacaoPontos === null ? null : variacaoPontos > 0 ? 'subiu' : variacaoPontos < 0 ? 'caiu' : 'igual';

  const semLancamento = useMemo(
    () => lojasAtual.filter(loja => loja.faturamentoGeral === null || loja.faturamentoGeral === undefined).length,
    [lojasAtual],
  );


  const ranking = useMemo(() => {
    const anteriorPorId = new Map(lojasAnterior.map(loja => [loja.id, loja.faturamentoGeral]));
    const itens = lojasAtual.map(loja => ({
      id: loja.id,
      nome: loja.nome,
      redeNome: loja.rede?.nome,
      diretorNome: loja.diretor?.nome,
      atual: loja.faturamentoGeral,
      anterior: anteriorPorId.get(loja.id),
    }));
    return calcularRankingVariacao(itens);
  }, [lojasAtual, lojasAnterior]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <CardTotal
          label="Faturamento Geral (mês)"
          valor={formatMoedaBR(totalGeralAtual)}
          variacao={formatVariacaoBR(variacaoGeralPct)}
          estado={estadoGeral}
        />
        <CardTotal
          label="Faturamento Marketing (mês)"
          valor={formatMoedaBR(totalMarketingAtual)}
          variacao={formatVariacaoBR(variacaoMarketingPct)}
          estado={estadoMarketing}
        />
        <CardTotal
          label="% Marketing sobre o Geral"
          valor={formatPercentualBR(percentualAtual) ?? '—'}
          variacao={formatVariacaoBR(variacaoPontos, ' p.p.')}
          estado={estadoPercentual}
        />
        <CardTotal
          label="Lojas sem lançamento no mês"
          valor={String(semLancamento)}
          variacao={null}
          estado={null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingLista titulo="Maiores altas" itens={ranking.altas} tom="alta" />
        <RankingLista titulo="Maiores quedas" itens={ranking.quedas} tom="queda" />
      </div>
    </div>
  );
}

function CardTotal({ label, valor, variacao, estado }) {
  return (
    <div className={`border rounded-[9px] px-4 py-3.5 flex flex-col gap-1.5 ${corCardPorFaturamentoGeral(estado)}`}>
      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">{label}</span>
      <span className="font-display text-[22px] font-extrabold leading-none">{valor}</span>
      {variacao ? (
        <span
          className={`flex items-center gap-1 text-[12px] font-semibold ${SETA_PERCENTUAL[estado]?.classe ?? 'text-[var(--muted)]'}`}
        >
          {SETA_PERCENTUAL[estado] ? <span aria-hidden="true">{SETA_PERCENTUAL[estado].icone}</span> : null}
          {variacao} vs mês anterior
        </span>
      ) : (
        <span className="text-[12px] text-[var(--muted)]">—</span>
      )}
    </div>
  );
}

function RankingLista({ titulo, itens, tom }) {
  const corTexto = tom === 'alta' ? 'text-emerald-400' : 'text-orange-400';
  return (
    <div className="border border-[var(--border)] bg-[var(--panel-alt)] rounded-[9px] px-4 py-3.5">
      <h3 className="text-[13px] font-bold uppercase tracking-[.04em] mb-2.5">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">Sem lojas com dado suficiente nos dois meses.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {itens.map((item, idx) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-[13px]">
              <div className="min-w-0">
                <div className="font-semibold truncate">{idx + 1}. {item.nome}</div>
                <div className="text-[11px] text-[var(--muted)] truncate">{item.redeNome} · {item.diretorNome}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-bold ${corTexto}`}>{formatVariacaoBR(item.variacao)}</div>
                <div className="text-[11px] text-[var(--muted)]">
                  {formatMoedaBR(item.atual)} (antes {formatMoedaBR(item.anterior)})
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
