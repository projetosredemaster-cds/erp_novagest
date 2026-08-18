import { useEffect, useId, useRef } from 'react';
import {
  extrairDigitos,
  parseValorBR,
  formatarDigitosBR,
  valorParaDigitos,
  digitosParaValor,
  moveCaretToEnd,
  formatPercentualBR,
  formatDataHoraPt,
  buildObservacao,
  SETA_PERCENTUAL,
  corCardPorFaturamentoGeral,
} from './marketingFormat.js';

const campoMonetario = "font-display w-full sm:w-[150px] bg-[#12151b] border border-[var(--border)] text-[var(--text)] px-2.5 py-1.5 rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[var(--teal)] disabled:opacity-50 disabled:cursor-not-allowed";
const campoSomenteLeitura = "font-display w-full sm:w-[150px] bg-[#12151b]/60 border border-dashed border-[var(--border)] text-[var(--muted)] px-2.5 py-1.5 rounded-lg text-sm text-right";

export default function LojaMarketingCard({
  loja,
  aba,
  labelParte,
  valorCampo,
  setCampo,
  onBackspaceCampo,
  onBlurLoja,
  salvando,
}) {
  const idBase = useId();
  const cardRef = useRef(null);
  const blurTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  function handleCampoBlur(e) {
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && cardRef.current?.contains(relatedTarget)) return;
    clearTimeout(blurTimerRef.current);
    if (relatedTarget) {
      onBlurLoja(loja.id);
      return;
    }
    blurTimerRef.current = setTimeout(() => onBlurLoja(loja.id), 200);
  }
  function handleCampoFocus() {
    clearTimeout(blurTimerRef.current);
  }

  const atualizadoEmFmt = formatDataHoraPt(loja.atualizadoEm);
  const estadoGeral = loja.comparacao?.faturamentoGeral ?? null;
  const corCard = corCardPorFaturamentoGeral(estadoGeral);

  const campoParteId = aba === 'marketing' ? 'faturamentoMarketing' : 'faturamentoRetornoIndicacao';
  const percentual = aba === 'marketing' ? loja.percentualMarketing : loja.percentualRetornoIndicacao;
  const estadoParte = aba === 'marketing'
    ? loja.comparacao?.faturamentoMarketing
    : loja.comparacao?.faturamentoRetornoIndicacao;
  const observacao = buildObservacao(loja.comparacao ?? null, labelParte);

  const geralVazio = valorCampo(loja.id, 'faturamentoGeral') === '';

  return (
    <div
      ref={cardRef}
      onFocus={handleCampoFocus}
      className={`border rounded-[9px] px-4 py-3 flex flex-col gap-2.5 transition-colors ${corCard}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-[110px]">
          <div className="text-[14px] font-semibold">{loja.nome}</div>
          {atualizadoEmFmt ? (
            <div className="text-[11px] text-[var(--muted)]">Atualizado {atualizadoEmFmt}</div>
          ) : null}
        </div>
        {salvando ? <span className="text-[11px] text-[var(--muted)] font-semibold">Salvando...</span> : null}
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        {aba === 'marketing' ? (
          <CampoFaturamento
            id={`${idBase}-geral`}
            label="Faturamento Geral"
            valor={valorCampo(loja.id, 'faturamentoGeral')}
            onChange={v => setCampo(loja.id, 'faturamentoGeral', v)}
            onBackspace={() => onBackspaceCampo(loja.id, 'faturamentoGeral')}
            onBlur={handleCampoBlur}
          />
        ) : geralVazio ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">Faturamento Geral</span>
            <span className="text-[12px] text-[var(--danger)] max-w-[220px]">
              Lance o Faturamento Geral na aba Marketing primeiro
            </span>
          </div>
        ) : (
          <CampoSomenteLeitura
            label="Faturamento Geral"
            valorFormatado={formatarDigitosBR(valorParaDigitos(valorCampo(loja.id, 'faturamentoGeral')))}
          />
        )}

        <CampoFaturamento
          id={`${idBase}-parte`}
          label={aba === 'marketing' ? 'Faturamento Marketing' : 'Faturamento Retorno/Indicação'}
          valor={valorCampo(loja.id, campoParteId)}
          onChange={v => setCampo(loja.id, campoParteId, v)}
          onBackspace={() => onBackspaceCampo(loja.id, campoParteId)}
          onBlur={handleCampoBlur}
          disabled={aba === 'retorno' && geralVazio}
        />

        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">
            {aba === 'marketing' ? '% Marketing' : '% Retorno/Indicação'}
          </span>
          <span className="flex items-center gap-1.5 h-[34px] text-[14px] font-semibold">
            {formatPercentualBR(percentual) ?? <span className="text-[var(--muted)] font-normal">—</span>}
            {SETA_PERCENTUAL[estadoParte] ? (
              <span
                className={`${SETA_PERCENTUAL[estadoParte].classe} text-[12px]`}
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

function CampoFaturamento({ id, label, valor, onChange, onBackspace, onBlur, disabled }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">{label}</span>
      <input
        id={id}
        type="text" inputMode="decimal" placeholder="0,00"
        value={formatarDigitosBR(valorParaDigitos(valor))}
        disabled={disabled}
        onChange={e => { onChange(digitosParaValor(extrairDigitos(e.target.value))); moveCaretToEnd(e.target); }}
        onKeyDown={e => {
          if (e.key !== 'Backspace' && e.key !== 'Delete') return;
          e.preventDefault();
          onBackspace();
          moveCaretToEnd(e.target);
        }}
        onPaste={e => { e.preventDefault(); onChange(parseValorBR(e.clipboardData.getData('text'))); moveCaretToEnd(e.target); }}
        onBlur={onBlur}
        className={campoMonetario}
      />
    </label>
  );
}

function CampoSomenteLeitura({ label, valorFormatado }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">{label}</span>
      <span className={campoSomenteLeitura}>{valorFormatado || '0,00'}</span>
    </div>
  );
}
