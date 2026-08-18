import {
  somarCampoLojas,
  percentualSobreTotal,
  compararTotais,
  buildObservacao,
  formatMoedaBR,
  formatPercentualBR,
  corCardPorFaturamentoGeral,
  SETA_PERCENTUAL,
} from './marketingFormat.js';

export default function TotalGeralRow({ lojasAtual, lojasAnteriores, aba, labelParte }) {
  const campoParte = aba === 'marketing' ? 'faturamentoMarketing' : 'faturamentoRetornoIndicacao';

  const totalGeralAtual = somarCampoLojas(lojasAtual, 'faturamentoGeral');
  const totalParteAtual = somarCampoLojas(lojasAtual, campoParte);
  const totalGeralAnterior = somarCampoLojas(lojasAnteriores, 'faturamentoGeral');
  const totalParteAnterior = somarCampoLojas(lojasAnteriores, campoParte);

  const percentual = percentualSobreTotal(totalParteAtual, totalGeralAtual);

  const estadoGeral = compararTotais(totalGeralAtual, totalGeralAnterior);
  const estadoParte = compararTotais(totalParteAtual, totalParteAnterior);

  const comparacaoSintetica = { faturamentoGeral: estadoGeral, [campoParte]: estadoParte };
  const observacao = buildObservacao(comparacaoSintetica, labelParte);

  return (
    <div className={`border-2 rounded-[9px] px-4 py-3.5 flex flex-col gap-2.5 mt-1 ${corCardPorFaturamentoGeral(estadoGeral)}`}>
      <div className="text-[13px] font-bold uppercase tracking-[.05em] text-[var(--text)]">
        Total geral do diretor
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        <TotalCampo label="Total Fat. Geral" valor={formatMoedaBR(totalGeralAtual)} />
        <TotalCampo
          label={aba === 'marketing' ? 'Total Fat. Marketing' : 'Total Fat. Retorno/Indicação'}
          valor={formatMoedaBR(totalParteAtual)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">
            {aba === 'marketing' ? '% Marketing do total' : '% Retorno/Indicação do total'}
          </span>
          <span className="flex items-center gap-1.5 h-[34px] text-[16px] font-bold">
            {formatPercentualBR(percentual) ?? <span className="text-[var(--muted)] font-normal">—</span>}
            {SETA_PERCENTUAL[estadoParte] ? (
              <span
                className={`${SETA_PERCENTUAL[estadoParte].classe} text-[13px]`}
                aria-label={`comparado ao mês anterior: ${estadoParte}`}
              >
                {SETA_PERCENTUAL[estadoParte].icone}
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="text-[12px] text-[var(--muted)]">
        <span className="font-semibold uppercase tracking-[.04em] mr-1.5">Observação:</span>
        {observacao}
      </div>
    </div>
  );
}

function TotalCampo({ label, valor }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">{label}</span>
      <span className="font-display text-[17px] font-extrabold">{valor}</span>
    </div>
  );
}
