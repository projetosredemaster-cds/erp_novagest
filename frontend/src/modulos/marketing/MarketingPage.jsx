// style-system: Tailwind
// Ranking e Margens (os dois módulos de negócio já existentes, ambos com grid
// aninhado Diretor->Rede->Loja parecido com este) são 100% Tailwind — segue o
// mesmo caminho por consistência visual do sistema. Avaliei o DataGrid do MUI
// para este grid (tem bastante linha: Diretor->Rede->Loja) e descartei: aqui
// cada "loja" é um cartão com 2 inputs + percentual + observação + cor
// condicional (ver item 4 do redesign), hierarquia visual em 3 níveis
// (Diretor/Rede/Loja) e onBlur por card — o DataGrid é ótimo pra tabela
// tabular densa com edição célula a célula, mas obrigaria a achatar essa
// hierarquia em colunas artificiais ou a usar renderCell customizado em quase
// toda coluna, perdendo a vantagem do componente pronto. Também misturaria MUI
// com o restante 100% Tailwind do sistema (regra rígida do projeto: nunca no
// mesmo componente) — teria que isolar em arquivo próprio, sem ganho real.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEntradas, salvarEntrada, removerEntrada } from './marketingApi.js';
import LojaMarketingCard from './LojaMarketingCard.jsx';
import TotalGeralRow from './TotalGeralRow.jsx';
import DashboardMarketing from './DashboardMarketing.jsx';
import { numOrZero, valorParaDigitos, digitosParaValor } from './marketingFormat.js';

function mesAnoAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

// agrupa o array flat de GET /api/marketing/entradas (um bloco por Rede, com diretor{id,nome}
// e lojas[] aninhado) na hierarquia visual Diretor -> Rede -> Loja — mesmo princípio de
// agruparRedesPorDiretor em MargensPage.jsx, adaptado pro formato já-aninhado deste endpoint.
// Também é a fonte da lista de diretores usada no filtro do topo (item 1 do redesign) —
// não há chamada de API nova pra isso, o mesmo GET já traz diretor{id,nome} em cada bloco.
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

// substitui, de forma imutável, uma loja específica dentro do array flat de blocos —
// usado depois de um POST bem-sucedido pra atualizar só a linha salva (ver comentário em
// handleBlurLoja sobre por que não refazemos o GET inteiro a cada blur).
function atualizarLojaNosBlocos(blocos, lojaId, updater) {
  return (blocos || []).map(bloco => ({
    ...bloco,
    lojas: (bloco.lojas || []).map(loja => (loja.id === lojaId ? updater(loja) : loja)),
  }));
}

// monta o estado editável (valoresPorLoja) a partir do array flat de blocos vindo da API —
// campos `null` (loja sem lançamento no mês, ver contrato) viram '' (campo vazio no input,
// nunca "0" pré-preenchido).
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

// mesma fórmula do backend (CONTRATO-MARKETING-API.md, seção "Schema novo"):
// percentual = parte / faturamentoGeral * 100, null quando faturamentoGeral é 0/vazio.
function calcularPercentual(parte, faturamentoGeral) {
  const geral = numOrZero(faturamentoGeral);
  if (!geral) return null;
  return (numOrZero(parte) / geral) * 100;
}

// achata as lojas de todas as Redes vinculadas a um Diretor específico, a partir do array
// flat de blocos (mesmo formato de `blocos`/`blocosAnteriores`) — usado pra alimentar
// TotalGeralRow (item 1 do incremento) tanto com o mês atual quanto com o anterior, sem
// duplicar a lógica de agrupamento de agruparBlocosPorDiretor (que monta a árvore
// Diretor->Rede->Loja completa pro render principal, incluindo Redes sem loja nenhuma).
function lojasDoDiretor(blocos, diretorId) {
  if (diretorId === '' || diretorId === null || diretorId === undefined) return [];
  return (blocos || [])
    .filter(bloco => bloco.diretor.id === diretorId)
    .flatMap(bloco => bloco.lojas || []);
}

// período (ano, mês) imediatamente anterior ao selecionado — dezembro do ano anterior
// quando o mês selecionado é janeiro. Usado pra buscar o segundo GET que alimenta a linha
// de TOTAL (item 1) e a aba "Resumo Geral" (item 2).
function periodoAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";
const input = "bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

// abas "Marketing" / "Cliente Retorno-Indicação" (item 5 do redesign) — botões simples com
// role="tab", não uma lib de tabs: mesmo espírito do toggle "Ver relatório de período" já
// usado em MargensPage.jsx, só que aqui são duas opções sempre visíveis lado a lado (em vez
// de um botão só que troca de rótulo) porque o usuário pode querer comparar as duas abas
// olhando o rótulo de qual está ativa, não só alternar - ARIA completo (role=tablist/tab/
// aria-selected) porque já são só dois <button>s fixos, custo baixo, ganho de
// acessibilidade/anunciabilidade real.
const tabBase = "px-4 py-2 rounded-lg text-[13px] font-bold cursor-pointer transition-colors border";
const tabAtiva = "bg-[var(--teal)] text-[#0b1010] border-[var(--teal)]";
const tabInativa = "bg-transparent text-[var(--text)] border-[var(--border)] hover:brightness-110";

const ABAS = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'retorno', label: 'Cliente Retorno/Indicação' },
  { id: 'resumo', label: 'Resumo Geral' },
];

// bloco de loading/erro idêntico nas 3 abas — extraído pra não divergir entre a renderização
// de "Marketing"/"Cliente Retorno-Indicação" (lista de lojas do diretor) e "Resumo Geral"
// (dashboard sem filtro de diretor), que passaram a ter blocos de conteúdo bem diferentes
// depois do item 2 do incremento. Retorna null quando não há nada a mostrar (nem loading
// nem erro), pra quem chama decidir o que renderizar em seguida.
function EstadoCarregamento({ loading, error, onRetry }) {
  if (loading) {
    return <div className="text-[var(--muted)] text-sm px-1 py-10 text-center">Carregando...</div>;
  }
  if (error) {
    return (
      <div className="bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-xl px-5 py-4 text-sm flex items-center justify-between gap-4 flex-wrap">
        <span>Não foi possível carregar as entradas de marketing: {error}</span>
        <button className={btnGhost} onClick={onRetry}>Tentar novamente</button>
      </div>
    );
  }
  return null;
}

export default function MarketingPage() {
  const [mesAno, setMesAno] = useState(mesAnoAtual);
  const [blocos, setBlocos] = useState([]);
  // blocos do mês ANTERIOR ao selecionado — buscados junto do mês atual (mesmo período,
  // mesmo efeito, ver useEffect abaixo) só pra alimentar comparação/soma client-side na
  // linha de TOTAL (item 1) e na aba "Resumo Geral" (item 2); nunca editado pelo usuário.
  const [blocosAnteriores, setBlocosAnteriores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // valoresPorLoja: lojaId -> { faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }
  // (estado editável ÚNICO por loja/mês — as duas abas leem/escrevem no MESMO objeto, só
  // mudam quais campos ficam editáveis/visíveis em cada card; ver "Estado compartilhado" no
  // pedido original). '' representa campo vazio/sem lançamento.
  const [valoresPorLoja, setValoresPorLoja] = useState({});
  const [salvandoLojaId, setSalvandoLojaId] = useState(null);

  // referência de "último valor conhecido como salvo" por loja — usada só pro dirty-check
  // do blur (ver handleBlurLoja abaixo), NUNCA lida pelo render. É um ref (não state) de
  // propósito: mudar não deve re-renderizar a tela, só orientar se um blur vira POST ou não.
  // Populada na carga inicial/reload (mesmos valores de construirValoresIniciais, incluindo
  // '' quando a API mandou null) e atualizada após cada POST bem-sucedido, pra não reenviar
  // no próximo blur se nada mudou depois do save.
  const valoresSalvosRef = useRef({});

  // filtro por Diretor (item 1) e aba ativa (item 5) — sem diretor selecionado a tela mostra
  // um estado vazio orientando a escolher um, em vez de listar tudo de uma vez (resolve o
  // scroll infinito relatado pelo usuário).
  const [diretorId, setDiretorId] = useState('');
  const [aba, setAba] = useState('marketing');

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

  // `loading`/`error` só são resetados de forma síncrona nos handlers de evento que
  // disparam este efeito (handleMesAnoChange/handleRetry, abaixo) — nunca dentro do
  // próprio corpo do efeito, mesmo padrão de RankingPage.jsx/MargensPage.jsx.
  useEffect(() => {
    if (!periodoValido) return;
    let cancelled = false;
    const anterior = periodoAnterior(ano, mes);
    // Promise.all busca os dois períodos em paralelo (não serializa as duas chamadas). O
    // fetch do mês ANTERIOR é só apoio de comparação (linha de TOTAL / dashboard) — se ele
    // falhar, resolve pra [] em vez de propagar o erro, pra não derrubar a tela principal
    // (loading/error continuam refletindo só o fetch do mês atual, que é o obrigatório).
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
        // referência "salvo" nasce igual ao estado editável recém-carregado — é o que a API
        // já tem gravado (ou '' quando não tem lançamento nenhum).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // dispara quando o foco sai do CARD inteiro de uma loja (consolidado em
  // LojaMarketingCard.jsx via relatedTarget/debounce — ver comentário lá), em QUALQUER uma
  // das duas abas (ver CONTRATO-MARKETING-API.md, seções 2 e 3, e item 2 do redesign) —
  // sempre lê os 3 valores atuais do estado ÚNICO da loja, não só o campo que perdeu foco,
  // pra nunca mandar POST/DELETE com base num valor desatualizado (mesmo se o valor veio de
  // uma edição feita na outra aba).
  //
  // Bugfix histórico: antes disparava POST incondicionalmente a cada blur, então só encostar
  // num campo e dar Tab sem digitar nada (loja nunca lançada) gravava uma linha zerada no
  // banco (numOrZero('') === 0). Isso continua coberto pelo dirty-check abaixo (só prossegue
  // se pelo menos um dos 3 valores atuais é diferente do último valor conhecido como salvo,
  // `valoresSalvosRef`, populado na carga inicial e após cada save/exclusão bem-sucedidos) —
  // se nada mudou, não faz NENHUMA chamada de rede (nem POST, nem DELETE).
  //
  // Com o DELETE idempotente do backend (seção 3 do contrato), a escolha de rota passou a
  // ser: quando os 3 valores atuais ficam todos zero/vazios (`numOrZero` de cada um dá 0),
  // chama `removerEntrada` — exclui de fato a linha em vez de persistir um lançamento
  // zerado (idempotente: sem problema chamar mesmo se a loja nunca teve lançamento nenhum,
  // só não faz nada no banco). Em qualquer outro caso (pelo menos um dos 3 é diferente de
  // zero) é POST normal — isso substitui o antigo gate `preenchidosNaAba`, que bloqueava
  // envio quando algum campo da aba ativa ainda estava vazio: o cenário que esse gate existia
  // pra evitar (persistir zerado sem querer) agora tem tratamento próprio no branch de
  // DELETE, então não faz mais sentido bloquear "usuário preencheu só 1 dos 3 campos e
  // saiu" — zero pode ser um dado real num dos outros campos (ex.: nenhum retorno/indicação
  // naquele mês), e o contrato (seção 2) trata isso como POST normal.
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
          // volta a linha pro shape "sem lançamento" que a API devolve pra loja nunca
          // lançada (ver seção 1 do contrato) — todos os campos de valor/percentual/
          // comparacao/atualizadoEm em null, preservando id/nome da loja.
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
        // Atualiza só a linha salva (percentuais recalculados aqui mesmo, com a mesma
        // fórmula do backend) em vez de refazer o GET inteiro — evitar refetch aqui é
        // proposital: um refetch completo sobrescreveria o campo que o usuário já esteja
        // digitando em outra linha/campo nesse meio-tempo. `comparacao` (subiu/caiu/igual)
        // fica com o valor anterior até o próximo carregamento do período — não dá pra
        // recalculá-la no cliente sem os valores crus do mês anterior, que a API não
        // devolve (mesma limitação de antes do redesign).
        setBlocos(prev => atualizarLojaNosBlocos(prev, lojaId, loja => ({
          ...loja,
          faturamentoGeral: payload.faturamentoGeral,
          faturamentoMarketing: payload.faturamentoMarketing,
          faturamentoRetornoIndicacao: payload.faturamentoRetornoIndicacao,
          percentualMarketing: calcularPercentual(payload.faturamentoMarketing, payload.faturamentoGeral),
          percentualRetornoIndicacao: calcularPercentual(payload.faturamentoRetornoIndicacao, payload.faturamentoGeral),
          atualizadoEm: entrada?.atualizadoEm ?? loja.atualizadoEm,
        })));
        // referência "salvo" acompanha o que acabou de ser persistido, pra não reenviar no
        // próximo blur se nada mudar depois deste save.
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

  // se o diretor selecionado sumir da lista (ex.: trocou de mês e por algum motivo os dados
  // vieram diferentes, ou a seleção ficou "presa" de uma sessão anterior), trata como
  // "nenhum selecionado" — derivado no próprio render, sem efeito, pra não disparar
  // setState em cascata (o <select> também usa esse id "efetivo" como value).
  const diretorIdEfetivo = diretorId !== '' && diretores.some(d => d.id === diretorId) ? diretorId : '';
  const diretorAtual = diretorIdEfetivo === '' ? null : diretores.find(d => d.id === diretorIdEfetivo) || null;
  const labelParte = aba === 'marketing' ? 'MARKETING' : 'RETORNO/INDICAÇÃO';

  // lojas do diretor selecionado, achatadas (mês atual e mês anterior) — alimentam
  // TotalGeralRow (item 1); recalculadas só quando blocos/blocosAnteriores/diretor mudam.
  const lojasAtualDiretor = useMemo(
    () => lojasDoDiretor(blocos, diretorIdEfetivo),
    [blocos, diretorIdEfetivo],
  );
  const lojasAnteriorDiretor = useMemo(
    () => lojasDoDiretor(blocosAnteriores, diretorIdEfetivo),
    [blocosAnteriores, diretorIdEfetivo],
  );

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] antialiased p-6 min-h-screen">
      <div className="max-w-[1180px] mx-auto">
        <div className="flex justify-between items-end flex-wrap gap-4 border-b border-[var(--border)] pb-[18px] mb-[22px]">
          <div>
            <div className="text-[11px] tracking-[.14em] uppercase text-[var(--teal)] font-semibold">Painel de Marketing</div>
            <h1 className="font-display text-[34px] font-extrabold mt-0.5 leading-none">Lançamento mensal</h1>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[var(--muted)] font-semibold" id="marketing-diretor-label">Diretor</span>
              <select
                aria-labelledby="marketing-diretor-label"
                value={diretorIdEfetivo}
                onChange={e => setDiretorId(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={loading || !!error || aba === 'resumo'}
                className={`${input} min-w-[180px]`}
              >
                <option value="">Selecione...</option>
                {diretores.map(d => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
              {/* aba "Resumo Geral" (item 2) mostra todos os diretores consolidados de
                  propósito — filtro fica desabilitado nela em vez de escondido, pra deixar
                  claro que ele existe mas não se aplica, e reaparece já com a seleção
                  preservada ao voltar pra Marketing/Retorno-Indicação. */}
              {aba === 'resumo' ? (
                <span className="text-[11px] text-[var(--muted)]">Não se aplica ao Resumo Geral</span>
              ) : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[var(--muted)] font-semibold" id="marketing-mes-label">Mês/Ano</span>
              <input
                type="month"
                aria-labelledby="marketing-mes-label"
                value={mesAno}
                onChange={e => handleMesAnoChange(e.target.value)}
                className={input}
              />
            </label>
          </div>
        </div>

        <div role="tablist" aria-label="Tipo de indicador" className="flex gap-2 mb-4">
          {ABAS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`marketing-tab-${id}`}
              aria-selected={aba === id}
              aria-controls="marketing-tabpanel"
              className={`${tabBase} ${aba === id ? tabAtiva : tabInativa}`}
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
                    {/* linha de TOTAL do diretor (item 1) — abaixo da lista de redes/lojas,
                        dentro do mesmo diretor selecionado; some junto com a lista quando
                        nenhum diretor está selecionado (branch acima). */}
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
