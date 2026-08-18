import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEntradas, salvarEntrada, removerEntrada } from './marketingApi.js';
import LojaMarketingCard from './LojaMarketingCard.jsx';
import TotalGeralRow from './TotalGeralRow.jsx';
import DashboardMarketing from './DashboardMarketing.jsx';
import RelatorioMarketing from './RelatorioMarketing.jsx';
import { numOrZero, valorParaDigitos, digitosParaValor, periodoAnterior } from './marketingFormat.js';

function mesAnoAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function agruparBlocosPorDiretor(blocos) {
  const map = new Map();
  (blocos || []).forEach(bloco => {
    const dId = bloco.diretor.id;
    if (!map.has(dId)) map.set(dId, { id: dId, nome: bloco.diretor.nome, redes: [] });
    map.get(dId).redes.push({ id: bloco.rede.id, nome: bloco.rede.nome, lojas: bloco.lojas || [] });
  });
  return Array.from(map.values())
    .map(d => ({ ...d, redes: [...d.redes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function atualizarLojaNosBlocos(blocos, lojaId, updater) {
  return (blocos || []).map(bloco => ({
    ...bloco,
    lojas: (bloco.lojas || []).map(loja => (loja.id === lojaId ? updater(loja) : loja)),
  }));
}

function construirValoresIniciais(blocos) {
  const map = {};
  (blocos || []).forEach(bloco => {
    (bloco.lojas || []).forEach(loja => {
      map[loja.id] = {
        faturamentoGeral: loja.faturamentoGeral ?? '',
        faturamentoMarketing: loja.faturamentoMarketing ?? '',
        faturamentoRetornoIndicacao: loja.faturamentoRetornoIndicacao ?? '',
      };
    });
  });
  return map;
}

function calcularPercentual(parte, faturamentoGeral) {
  const geral = numOrZero(faturamentoGeral);
  if (!geral) return null;
  return (numOrZero(parte) / geral) * 100;
}

function lojasDoDiretor(blocos, diretorId) {
  if (diretorId === '' || diretorId === null || diretorId === undefined) return [];
  return (blocos || [])
    .filter(bloco => bloco.diretor.id === diretorId)
    .flatMap(bloco => bloco.lojas || []);
}

const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";
const input = "bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

const tabBase = "px-4 py-2 rounded-lg text-[13px] font-bold cursor-pointer transition-colors border";
const tabAtiva = "bg-[var(--teal)] text-[#0b1010] border-[var(--teal)]";
const tabInativa = "bg-transparent text-[var(--text)] border-[var(--border)] hover:brightness-110";

const ABAS = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'retorno', label: 'Cliente Retorno/Indicação' },
  { id: 'resumo', label: 'Resumo Geral' },
];

function EstadoCarregamento({ loading, error, onRetry }) {
  if (loading) {
    return <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>;
  }
  if (error) {
    return (
      <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
        <span>Não foi possível carregar as entradas de marketing: {error}</span>
        <button className={`${btnGhost} min-h-11 lg:min-h-0`} onClick={onRetry}>Tentar novamente</button>
      </div>
    );
  }
  return null;
}

export default function MarketingPage() {
  const [mesAno, setMesAno] = useState(mesAnoAtual);
  const [blocos, setBlocos] = useState([]);
  const [blocosAnteriores, setBlocosAnteriores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [valoresPorLoja, setValoresPorLoja] = useState({});
  const [salvandoLojaId, setSalvandoLojaId] = useState(null);

  const valoresSalvosRef = useRef({});

  const [diretorId, setDiretorId] = useState('');
  const [aba, setAba] = useState('marketing');

  const [view, setView] = useState('lancamento');

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);
  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1400);
  }

  const [anoStr, mesStr] = mesAno.split('-');
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const periodoValido = Number.isFinite(ano) && Number.isFinite(mes);

  useEffect(() => {
    if (!periodoValido) return;
    let cancelled = false;
    const anterior = periodoAnterior(ano, mes);
    Promise.all([
      fetchEntradas({ ano, mes }),
      fetchEntradas({ ano: anterior.ano, mes: anterior.mes }).catch(() => []),
    ])
      .then(([dadosAtual, dadosAnterior]) => {
        if (cancelled) return;
        const valoresIniciais = construirValoresIniciais(dadosAtual || []);
        setBlocos(dadosAtual || []);
        setBlocosAnteriores(dadosAnterior || []);
        setValoresPorLoja(valoresIniciais);
        valoresSalvosRef.current = valoresIniciais;
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Erro ao carregar entradas de marketing.');
        setBlocos([]);
        setBlocosAnteriores([]);
        setValoresPorLoja({});
        valoresSalvosRef.current = {};
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ano, mes, reloadToken]);

  function handleMesAnoChange(valor) {
    setLoading(true);
    setError(null);
    setMesAno(valor);
  }
  function handleRetry() {
    setLoading(true);
    setError(null);
    setReloadToken(t => t + 1);
  }

  function valorCampo(lojaId, campo) {
    const v = valoresPorLoja[lojaId]?.[campo];
    return v === undefined ? '' : v;
  }
  function setCampo(lojaId, campo, valor) {
    setValoresPorLoja(prev => ({ ...prev, [lojaId]: { ...(prev[lojaId] || {}), [campo]: valor } }));
  }
  function handleBackspaceCampo(lojaId, campo) {
    const digitosAtuais = valorParaDigitos(valorCampo(lojaId, campo));
    setCampo(lojaId, campo, digitosParaValor(digitosAtuais.slice(0, -1)));
  }

  function handleBlurLoja(lojaId) {
    const atual = {
      faturamentoGeral: valorCampo(lojaId, 'faturamentoGeral'),
      faturamentoMarketing: valorCampo(lojaId, 'faturamentoMarketing'),
      faturamentoRetornoIndicacao: valorCampo(lojaId, 'faturamentoRetornoIndicacao'),
    };
    const salvo = valoresSalvosRef.current[lojaId] ?? {
      faturamentoGeral: '',
      faturamentoMarketing: '',
      faturamentoRetornoIndicacao: '',
    };
    const dirty = atual.faturamentoGeral !== salvo.faturamentoGeral
      || atual.faturamentoMarketing !== salvo.faturamentoMarketing
      || atual.faturamentoRetornoIndicacao !== salvo.faturamentoRetornoIndicacao;
    if (!dirty) return;

    const todosZerados = numOrZero(atual.faturamentoGeral) === 0
      && numOrZero(atual.faturamentoMarketing) === 0
      && numOrZero(atual.faturamentoRetornoIndicacao) === 0;

    setSalvandoLojaId(lojaId);

    if (todosZerados) {
      const vazio = { faturamentoGeral: '', faturamentoMarketing: '', faturamentoRetornoIndicacao: '' };
      removerEntrada({ ano, mes, lojaId })
        .then(() => {
          setBlocos(prev => atualizarLojaNosBlocos(prev, lojaId, loja => ({
            ...loja,
            faturamentoGeral: null,
            faturamentoMarketing: null,
            faturamentoRetornoIndicacao: null,
            percentualMarketing: null,
            percentualRetornoIndicacao: null,
            comparacao: null,
            atualizadoEm: null,
          })));
          valoresSalvosRef.current = { ...valoresSalvosRef.current, [lojaId]: vazio };
          flash('Removido');
        })
        .catch(err => flash(err.message || 'Erro ao excluir lançamento de marketing.', 'error'))
        .finally(() => setSalvandoLojaId(null));
      return;
    }

    const payload = {
      lojaId,
      ano,
      mes,
      faturamentoGeral: numOrZero(atual.faturamentoGeral),
      faturamentoMarketing: numOrZero(atual.faturamentoMarketing),
      faturamentoRetornoIndicacao: numOrZero(atual.faturamentoRetornoIndicacao),
    };
    salvarEntrada(payload)
      .then(entrada => {
        setBlocos(prev => atualizarLojaNosBlocos(prev, lojaId, loja => ({
          ...loja,
          faturamentoGeral: payload.faturamentoGeral,
          faturamentoMarketing: payload.faturamentoMarketing,
          faturamentoRetornoIndicacao: payload.faturamentoRetornoIndicacao,
          percentualMarketing: calcularPercentual(payload.faturamentoMarketing, payload.faturamentoGeral),
          percentualRetornoIndicacao: calcularPercentual(payload.faturamentoRetornoIndicacao, payload.faturamentoGeral),
          atualizadoEm: entrada?.atualizadoEm ?? loja.atualizadoEm,
        })));
        valoresSalvosRef.current = { ...valoresSalvosRef.current, [lojaId]: atual };
        flash('Salvo');
      })
      .catch(err => flash(err.message || 'Erro ao salvar lançamento de marketing.', 'error'))
      .finally(() => setSalvandoLojaId(null));
  }

  const diretores = useMemo(() => agruparBlocosPorDiretor(blocos), [blocos]);
  const totalLojas = useMemo(
    () => diretores.reduce((s, d) => s + d.redes.reduce((s2, r) => s2 + r.lojas.length, 0), 0),
    [diretores],
  );

  const diretorIdEfetivo = diretorId !== '' && diretores.some(d => d.id === diretorId) ? diretorId : '';
  const diretorAtual = diretorIdEfetivo === '' ? null : diretores.find(d => d.id === diretorIdEfetivo) || null;
  const labelParte = aba === 'marketing' ? 'MARKETING' : 'RETORNO/INDICAÇÃO';

  const lojasAtualDiretor = useMemo(
    () => lojasDoDiretor(blocos, diretorIdEfetivo),
    [blocos, diretorIdEfetivo],
  );
  const lojasAnteriorDiretor = useMemo(
    () => lojasDoDiretor(blocosAnteriores, diretorIdEfetivo),
    [blocosAnteriores, diretorIdEfetivo],
  );

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] antialiased p-4 sm:p-6 min-h-screen">
      <div className="max-w-[1180px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 border-b border-[var(--border)] pb-[18px] mb-[22px]">
          <div>
            <div className="text-[11px] tracking-[.14em] uppercase text-[var(--teal)] font-semibold">Painel de Marketing</div>
            <h1 className="font-display text-[28px] sm:text-[34px] font-extrabold mt-0.5 leading-none">Lançamento mensal</h1>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:flex-wrap w-full sm:w-auto">
            <label className="flex flex-col gap-1 w-full sm:w-auto">
              <span className="text-[12px] text-[var(--muted)] font-semibold" id="marketing-diretor-label">Diretor</span>
              <select
                aria-labelledby="marketing-diretor-label"
                value={diretorIdEfetivo}
                onChange={e => setDiretorId(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={view === 'lancamento' && (loading || !!error || aba === 'resumo')}
                className={`${input} w-full sm:w-auto sm:min-w-[180px] min-h-11 lg:min-h-0`}
              >
                <option value="">Selecione...</option>
                {diretores.map(d => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
              {}
              {view === 'lancamento' && aba === 'resumo' ? (
                <span className="text-[11px] text-[var(--muted)]">Não se aplica ao Resumo Geral</span>
              ) : null}
            </label>
            {}
            {view === 'lancamento' ? (
              <label className="flex flex-col gap-1 w-full sm:w-auto">
                <span className="text-[12px] text-[var(--muted)] font-semibold" id="marketing-mes-label">Mês/Ano</span>
                <input
                  type="month"
                  aria-labelledby="marketing-mes-label"
                  value={mesAno}
                  onChange={e => handleMesAnoChange(e.target.value)}
                  className={`${input} w-full sm:w-auto min-h-11 lg:min-h-0`}
                />
              </label>
            ) : null}
            <button
              type="button"
              className={`${btnGhost} w-full sm:w-auto min-h-11 lg:min-h-0`}
              onClick={() => setView(v => (v === 'lancamento' ? 'relatorio' : 'lancamento'))}
            >
              {view === 'lancamento' ? '📊 Ver relatório de visão geral' : '← Voltar ao lançamento'}
            </button>
          </div>
        </div>

        {view === 'relatorio' ? (
          <RelatorioMarketing diretorId={diretorIdEfetivo} diretores={diretores} onDiretorChange={setDiretorId} />
        ) : (
        <>
        <div role="tablist" aria-label="Tipo de indicador" className="flex flex-wrap gap-2 mb-4">
          {ABAS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`marketing-tab-${id}`}
              aria-selected={aba === id}
              aria-controls="marketing-tabpanel"
              className={`${tabBase} min-h-11 lg:min-h-0 ${aba === id ? tabAtiva : tabInativa}`}
              onClick={() => setAba(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={card} role="tabpanel" id="marketing-tabpanel" aria-labelledby={`marketing-tab-${aba}`}>
          {aba === 'resumo' ? (
            <>
              <h2 className="font-display text-[20px] font-bold m-0 mb-1">Resumo geral do mês</h2>
              <p className="text-[12px] text-[var(--muted)] mb-4">
                Visão consolidada de todos os diretores, redes e lojas no período selecionado — não é afetada
                pelo filtro de Diretor acima.
              </p>

              <EstadoCarregamento loading={loading} error={error} onRetry={handleRetry} />
              {!loading && !error ? (
                totalLojas === 0 ? (
                  <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
                    Nenhum diretor, rede ou loja cadastrado(a) ainda. Cadastre diretores, redes e lojas para
                    começar a lançar marketing.
                  </div>
                ) : (
                  <DashboardMarketing blocos={blocos} blocosAnteriores={blocosAnteriores} />
                )
              ) : null}
            </>
          ) : (
            <>
              <h2 className="font-display text-[20px] font-bold m-0 mb-1">Faturamento por loja</h2>
              <p className="text-[12px] text-[var(--muted)] mb-4">
                {aba === 'marketing'
                  ? 'Cole o faturamento geral e o faturamento vindo de marketing de cada loja no mês. Percentual e comparação com o mês anterior são calculados automaticamente.'
                  : 'Cole o faturamento vindo de cliente retorno/indicação de cada loja no mês. O faturamento geral é o mesmo já lançado na aba Marketing.'}
              </p>

              <EstadoCarregamento loading={loading} error={error} onRetry={handleRetry} />
              {!loading && !error ? (
                totalLojas === 0 ? (
                  <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
                    Nenhum diretor, rede ou loja cadastrado(a) ainda. Cadastre diretores, redes e lojas para
                    começar a lançar marketing.
                  </div>
                ) : !diretorAtual ? (
                  <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">
                    Selecione um diretor acima para ver e lançar o faturamento das redes/lojas dele.
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {diretorAtual.redes.map(rede => (
                      <div key={rede.id}>
                        <div className="text-[13px] font-semibold text-[var(--muted)] mb-1.5">{rede.nome}</div>
                        {rede.lojas.length === 0 ? (
                          <div className="text-[var(--muted)] text-[13px] px-1 py-2">Nenhuma loja cadastrada nesta rede.</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {rede.lojas.map(loja => (
                              <LojaMarketingCard
                                key={loja.id}
                                loja={loja}
                                aba={aba}
                                labelParte={labelParte}
                                valorCampo={valorCampo}
                                setCampo={setCampo}
                                onBackspaceCampo={handleBackspaceCampo}
                                onBlurLoja={handleBlurLoja}
                                salvando={salvandoLojaId === loja.id}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {}
                    <TotalGeralRow
                      lojasAtual={lojasAtualDiretor}
                      lojasAnteriores={lojasAnteriorDiretor}
                      aba={aba}
                      labelParte={labelParte}
                    />
                  </div>
                )
              ) : null}
            </>
          )}
        </div>
        </>
        )}
      </div>

      <div
        className={`fixed bottom-5 right-5 left-5 sm:left-auto max-w-none sm:max-w-[360px] px-4 py-2 rounded-lg text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
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
