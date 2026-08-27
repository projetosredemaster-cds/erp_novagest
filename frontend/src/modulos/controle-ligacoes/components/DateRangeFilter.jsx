// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';

function hojeSemHora() {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  return data;
}

function addDias(data, dias) {
  const resultado = new Date(data);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

function formatISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function dataDeISO(dataIso) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

function inicioSemana(data) {
  const diaSemana = data.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  return addDias(data, diff);
}

function primeiroDiaDoMes(data) {
  return new Date(data.getFullYear(), data.getMonth(), 1);
}

function construirGradeDias(mesVisivel) {
  const primeiroDiaMes = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth(), 1);
  const inicioGrade = inicioSemana(primeiroDiaMes);
  return Array.from({ length: 42 }, (_, indice) => addDias(inicioGrade, indice));
}

function formatCabecalhoMes(data) {
  const texto = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function formatCurto(dataIso) {
  const [, mes, dia] = dataIso.split('-');
  return `${dia} de ${MESES_ABREV[Number(mes) - 1]}.`;
}

const DIAS_SEMANA_LABEL = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const ATALHOS_PERIODO = [
  { label: 'Hoje', calc: (hoje) => ({ inicio: hoje, fim: hoje }) },
  {
    label: 'Ontem',
    calc: (hoje) => {
      const ontem = addDias(hoje, -1);
      return { inicio: ontem, fim: ontem };
    },
  },
  { label: 'Hoje e ontem', calc: (hoje) => ({ inicio: addDias(hoje, -1), fim: hoje }) },
  { label: 'Últimos 7 dias', calc: (hoje) => ({ inicio: addDias(hoje, -6), fim: hoje }) },
  { label: 'Últimos 14 dias', calc: (hoje) => ({ inicio: addDias(hoje, -13), fim: hoje }) },
  { label: 'Últimos 28 dias', calc: (hoje) => ({ inicio: addDias(hoje, -27), fim: hoje }) },
  { label: 'Últimos 30 dias', calc: (hoje) => ({ inicio: addDias(hoje, -29), fim: hoje }) },
  { label: 'Esta semana', calc: (hoje) => ({ inicio: inicioSemana(hoje), fim: hoje }) },
  {
    label: 'Semana passada',
    calc: (hoje) => {
      const inicioAtual = inicioSemana(hoje);
      return { inicio: addDias(inicioAtual, -7), fim: addDias(inicioAtual, -1) };
    },
  },
  { label: 'Este mês', calc: (hoje) => ({ inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: hoje }) },
  {
    label: 'Mês passado',
    calc: (hoje) => ({
      inicio: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1),
      fim: new Date(hoje.getFullYear(), hoje.getMonth(), 0),
    }),
  },
  { label: 'Máximo', calc: () => ({ inicio: null, fim: null }) },
];

const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50";

export default function DateRangeFilter({ dataInicio, dataFim, onAplicar }) {
  const [aberto, setAberto] = useState(false);
  const [selInicio, setSelInicio] = useState(dataInicio);
  const [selFim, setSelFim] = useState(dataFim);
  const [mesVisivel, setMesVisivel] = useState(() => (
    primeiroDiaDoMes(dataInicio ? dataDeISO(dataInicio) : hojeSemHora())
  ));
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setAberto(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [aberto]);

  function abrirPopover() {
    setSelInicio(dataInicio);
    setSelFim(dataFim);
    setMesVisivel(primeiroDiaDoMes(dataInicio ? dataDeISO(dataInicio) : hojeSemHora()));
    setAberto(true);
  }

  function aplicarAtalho(atalho) {
    const { inicio, fim } = atalho.calc(hojeSemHora());
    const inicioIso = inicio ? formatISO(inicio) : null;
    const fimIso = fim ? formatISO(fim) : null;
    setSelInicio(inicioIso);
    setSelFim(fimIso);
    setMesVisivel(primeiroDiaDoMes(inicio || fim || hojeSemHora()));
  }

  function handleClickDia(diaIso) {
    if (!selInicio || selFim) {
      setSelInicio(diaIso);
      setSelFim(null);
      return;
    }
    if (diaIso < selInicio) {
      setSelInicio(diaIso);
      return;
    }
    setSelFim(diaIso);
  }

  function cancelar() {
    setAberto(false);
  }

  function aplicar() {
    const fimFinal = selInicio && !selFim ? selInicio : selFim;
    onAplicar(selInicio, fimFinal);
    setAberto(false);
  }

  const dias = construirGradeDias(mesVisivel);
  const rotuloBotao = dataInicio && dataFim
    ? `${formatCurto(dataInicio)} - ${formatCurto(dataFim)}`
    : 'Selecionar período';

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={abrirPopover}
        aria-expanded={aberto}
        aria-haspopup="true"
        className="rounded-full border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-4 py-2 text-sm font-semibold text-[var(--pd-text-primary)] hover:bg-[var(--pd-surface-alt)] focus:outline-none focus:border-[var(--pd-accent)]"
      >
        📅 {rotuloBotao}
      </button>

      {aberto ? (
        <div className="absolute right-0 top-full z-50 mt-2 flex w-[min(90vw,560px)] flex-col rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] shadow-xl sm:flex-row">
          <div className="flex flex-col gap-1 border-b border-[var(--pd-border)] p-2 sm:w-40 sm:shrink-0 sm:border-b-0 sm:border-r">
            {ATALHOS_PERIODO.map((atalho) => (
              <button
                key={atalho.label}
                type="button"
                onClick={() => aplicarAtalho(atalho)}
                className="rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-[var(--pd-text-primary)] hover:bg-[var(--pd-surface-alt)]"
              >
                {atalho.label}
              </button>
            ))}
          </div>

          <div className="flex-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMesVisivel((mes) => new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
                aria-label="Mês anterior"
                className="rounded-lg px-2 py-1 text-sm font-bold text-[var(--pd-text-secondary)] hover:bg-[var(--pd-surface-alt)]"
              >
                ‹
              </button>
              <span className="text-[13px] font-bold text-[var(--pd-text-primary)]">{formatCabecalhoMes(mesVisivel)}</span>
              <button
                type="button"
                onClick={() => setMesVisivel((mes) => new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
                aria-label="Próximo mês"
                className="rounded-lg px-2 py-1 text-sm font-bold text-[var(--pd-text-secondary)] hover:bg-[var(--pd-surface-alt)]"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[10.5px] font-semibold uppercase text-[var(--pd-text-secondary)]">
              {DIAS_SEMANA_LABEL.map((label) => (
                <span key={label} className="py-1">{label}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {dias.map((dia) => {
                const diaIso = formatISO(dia);
                const foraDoMes = dia.getMonth() !== mesVisivel.getMonth();
                const isInicio = diaIso === selInicio;
                const isFim = diaIso === selFim;
                const noIntervalo = Boolean(selInicio && selFim && diaIso > selInicio && diaIso < selFim);

                return (
                  <button
                    key={diaIso}
                    type="button"
                    onClick={() => handleClickDia(diaIso)}
                    className={`rounded-md py-1.5 text-[12px] font-semibold ${
                      isInicio || isFim
                        ? 'bg-[var(--pd-accent)] text-white'
                        : noIntervalo
                          ? 'bg-[var(--pd-accent)]/20 text-[var(--pd-text-primary)]'
                          : 'text-[var(--pd-text-primary)] hover:bg-[var(--pd-surface-alt)]'
                    } ${foraDoMes ? 'opacity-40' : ''}`}
                  >
                    {dia.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end gap-2 border-t border-[var(--pd-border)] pt-3">
              <button type="button" onClick={cancelar} className={btnGhost}>Cancelar</button>
              <button
                type="button"
                onClick={aplicar}
                disabled={!selInicio}
                className="rounded-lg bg-[var(--pd-accent)] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Aplicar período
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
