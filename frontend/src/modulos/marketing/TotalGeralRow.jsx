// style-system: Tailwind
// Linha "TOTAL GERAL" do diretor selecionado (item 1 do incremento sobre o redesign já
// existente) — mostrada abaixo da lista de lojas, nas abas "Marketing" e "Cliente
// Retorno/Indicação". Recebe as lojas do diretor JÁ ACHATADAS (mês atual e mês anterior,
// ver `lojasDoDiretor` em MarketingPage.jsx) e faz toda a soma/comparação client-side —
// a API nunca devolve total pronto, só valores por loja (ver CONTRATO-MARKETING-API.md).
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

  // soma só o que tem lançamento (ver comentário de somarCampoLojas) — lojas sem dado no
  // mês não entram como zero.
  const totalGeralAtual = somarCampoLojas(lojasAtual, 'faturamentoGeral');
  const totalParteAtual = somarCampoLojas(lojasAtual, campoParte);
  const totalGeralAnterior = somarCampoLojas(lojasAnteriores, 'faturamentoGeral');
  const totalParteAnterior = somarCampoLojas(lojasAnteriores, campoParte);

  // SOMA/SOMA, nunca média dos percentuais individuais das lojas (bug conhecido da
  // planilha original, #REF! nessa linha) — null (exibido "—") quando o total geral é 0.
  const percentual = percentualSobreTotal(totalParteAtual, totalGeralAtual);

  const estadoGeral = compararTotais(totalGeralAtual, totalGeralAnterior);
  const estadoParte = compararTotais(totalParteAtual, totalParteAnterior);

  // objeto `comparacao` sintético (soma vs soma), no MESMO formato que a API usa por
  // loja, pra reaproveitar buildObservacao em vez de duplicar a tabela de textos.
  const comparacaoSintetica = { faturamentoGeral: estadoGeral, [campoParte]: estadoParte };
  const observacao = buildObservacao(comparacaoSintetica, labelParte);

  // cor da linha amarrada só ao trend do Fat. Geral TOTAL (mesma regra do card de loja,
  // nunca ao indicador de marketing/retorno) — border-2 pra dar o destaque "levemente
  // diferente do card padrão" pedido, sem inventar uma cor nova fora da paleta já usada.
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
