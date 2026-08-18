// style-system: n/a (módulo utilitário puro, sem JSX)
// Funções de formatação/máscara e o texto de observação (item 3 do redesign),
// extraídas pra um arquivo à parte porque são usadas tanto por MarketingPage.jsx
// (monta o payload/estado) quanto por LojaMarketingCard.jsx (renderiza os campos)
// — mantê-las dentro de MarketingPage.jsx faria LojaMarketingCard.jsx importar de
// volta a própria página que o renderiza (import circular).

// ---------- máscara monetária BR (mesma lógica de RankingPage.jsx/MargensPage.jsx —
// ainda não há um util compartilhado entre TODOS os módulos, ver CLAUDE.md) ----------
// interpreta texto digitado/colado no formato brasileiro (ex: "1.730,00" ou "1730,5")
// como número — inputs de valor são type="text" justamente para não deixar o navegador
// truncar a vírgula decimal como faria um type="number" nativo.
export function parseValorBR(texto) {
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
export function extrairDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}
// formata a base de dígitos (centavos) no padrão BR: "173000" -> "1.730,00"
export function formatarDigitosBR(digitos) {
  if (!digitos) return '';
  const n = parseInt(digitos, 10) || 0;
  const centavos = String(n % 100).padStart(2, '0');
  const inteiro = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${centavos}`;
}
// base de dígitos -> valor float guardado no estado (nunca a string formatada); base
// vazia representa campo vazio, não zero — preserva a distinção "sem lançamento" (null
// vindo da API) vs "digitou 0", exigida pelo contrato.
export function digitosParaValor(digitos) {
  if (!digitos) return '';
  return (parseInt(digitos, 10) || 0) / 100;
}
// caminho inverso: reconstrói a base de dígitos a partir do valor float guardado —
// usado a cada render pra formatar o input e pelo backspace pra saber o que remover
export function valorParaDigitos(valor) {
  if (valor === '' || valor === undefined || valor === null) return '';
  const n = Math.round(Number(valor) * 100);
  return Number.isFinite(n) ? String(n) : '';
}
// força o cursor pro final do campo após a formatação reescrever o texto — mantém o
// comportamento "digita da direita pra esquerda" de uma máscara de app bancário
export function moveCaretToEnd(el) {
  requestAnimationFrame(() => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}
// campo vazio/indefinido vira 0 só na hora de montar o payload pro backend — os 3
// campos de faturamento são obrigatórios em POST /api/marketing/entradas (ver
// CONTRATO-MARKETING-API.md, seção 2), então uma linha nunca digitada em algum dos
// 3 campos ainda assim precisa enviar 0 nesse campo pra completar o payload.
export function numOrZero(v) {
  return v === '' || v === undefined || v === null ? 0 : (Number(v) || 0);
}
// string manual "48,07%" (vírgula decimal, sem depender de toLocaleString pro símbolo)
export function formatPercentualBR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Number(n).toFixed(2).replace('.', ',') + '%';
}
export function formatDataHoraPt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dia = String(d.getDate()).padStart(2, '0');
  const mesN = String(d.getMonth() + 1).padStart(2, '0');
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mesN} ${hora}:${min}`;
}

// ---------- texto de observação (item 3 do redesign) ----------
// Tabela literal de combinações, pra evitar bug de "fórmula genérica" — a ordem gramatical
// muda dependendo de qual lado é "igual" (ver pedido original): quando só um lado é "igual"
// ele vira "ESTÁVEL" na posição do próprio lado (label ANTES de "ESTÁVEL" quando é o lado
// direito que empatou, "FATURAMENTO ESTÁVEL" quando é o lado esquerdo); quando os DOIS são
// "igual", o lado direito também inverte pra "ESTÁVEL {LABEL}". Chave: "<faturamentoGeral>|<parte>".
const TEXTOS_OBSERVACAO = {
  'subiu|subiu': label => `SUBIU FATURAMENTO E SUBIU ${label}`,
  'subiu|caiu': label => `SUBIU FATURAMENTO E CAIU ${label}`,
  'caiu|subiu': label => `CAIU FATURAMENTO E SUBIU ${label}`,
  'caiu|caiu': label => `CAIU FATURAMENTO E CAIU ${label}`,
  'igual|subiu': label => `FATURAMENTO ESTÁVEL E SUBIU ${label}`,
  'igual|caiu': label => `FATURAMENTO ESTÁVEL E CAIU ${label}`,
  'igual|igual': label => `FATURAMENTO ESTÁVEL E ESTÁVEL ${label}`,
  'subiu|igual': label => `SUBIU FATURAMENTO E ${label} ESTÁVEL`,
  'caiu|igual': label => `CAIU FATURAMENTO E ${label} ESTÁVEL`,
};
// mapeia o rótulo da 2ª parte pro campo correspondente dentro de `comparacao` — os dois
// únicos rótulos usados hoje pelas duas abas (Marketing / Cliente Retorno-Indicação).
const CAMPO_COMPARACAO_POR_LABEL = {
  MARKETING: 'faturamentoMarketing',
  'RETORNO/INDICAÇÃO': 'faturamentoRetornoIndicacao',
};
// função pura, testável isoladamente: recebe `comparacao` (objeto {faturamentoGeral,
// faturamentoMarketing, faturamentoRetornoIndicacao} cada um "subiu"/"caiu"/"igual", ou
// `null` quando não há mês anterior pra comparar — ver CONTRATO-MARKETING-API.md, seção 1)
// e o rótulo da 2ª parte ("MARKETING" ou "RETORNO/INDICAÇÃO"); retorna o texto de
// observação pronto pro card (maiúsculo, mesmo texto que a planilha original digitava à
// mão — ver origem no topo do contrato).
export function buildObservacao(comparacao, label) {
  if (!comparacao) return 'SEM DADO DO MÊS ANTERIOR';
  const campoParte = CAMPO_COMPARACAO_POR_LABEL[label];
  const geral = comparacao.faturamentoGeral;
  const parte = campoParte ? comparacao[campoParte] : undefined;
  const builder = TEXTOS_OBSERVACAO[`${geral}|${parte}`];
  return builder ? builder(label) : 'SEM DADO DO MÊS ANTERIOR';
}

// seta pequena ao lado de um percentual/variação (item 4 do redesign original) — cores
// fixas verde/laranja. Mora aqui (módulo utilitário puro, não um arquivo de componente)
// porque LojaMarketingCard.jsx, TotalGeralRow.jsx e DashboardMarketing.jsx (item 1/2 do
// incremento) reaproveitam a mesma constante; exportar de um arquivo de componente
// quebraria o Fast Refresh (regra `react-refresh/only-export-components` do ESLint).
export const SETA_PERCENTUAL = {
  subiu: { icone: '▲', classe: 'text-emerald-400' },
  caiu: { icone: '▼', classe: 'text-orange-400' },
};

// cor do card/linha amarrada só a um trend "subiu/caiu/igual" (no card de loja, sempre
// `comparacao.faturamentoGeral`, nunca o indicador de marketing/retorno — decisão do
// redesign original). Tons escuros sutis, compatíveis com o tema (`--panel`/`--border`/
// `--danger-bg` em frontend/src/index.css); não existe uma variável CSS "laranja" pronta
// no tema, então uso Tailwind arbitrário (orange-9xx) em vez de criar uma paleta nova.
// Mesmo motivo do SETA_PERCENTUAL acima pra morar num módulo utilitário e não num
// componente: TotalGeralRow.jsx e DashboardMarketing.jsx (item 1/2 do incremento)
// reaproveitam esta mesma paleta pra manter consistência visual com o card de loja.
export function corCardPorFaturamentoGeral(estadoGeral) {
  if (estadoGeral === 'subiu') return 'border-emerald-800/60 bg-emerald-950/25';
  if (estadoGeral === 'caiu') return 'border-orange-800/60 bg-orange-950/25';
  return 'border-[var(--border)] bg-[var(--panel-alt)]';
}

// ---------- linha de TOTAL por diretor (item 1) e dashboard "Resumo Geral" (item 2) ----------
// A API nunca devolve soma/total pronto (só comparação POR LOJA) — estas funções puras
// fazem client-side o que a planilha original fazia com fórmula (e quebrava com #REF!
// na linha de total): soma SOMA/SOMA em vez de média de percentuais individuais.

// soma um campo de faturamento (faturamentoGeral/Marketing/RetornoIndicacao) de um array
// flat de lojas. Lojas com o campo null/undefined (sem lançamento no período) são
// IGNORADAS — não entram como zero na soma. Numericamente dá no mesmo resultado de somar
// 0 pra elas (soma não muda), mas a distinção importa conceitualmente: uma loja sem
// lançamento não "faturou zero de verdade", só não foi preenchida ainda (ver contagem
// separada de lojas sem lançamento no dashboard, que usa esse mesmo critério de null).
export function somarCampoLojas(lojas, campo) {
  return (lojas || []).reduce((soma, loja) => {
    const v = loja?.[campo];
    if (v === null || v === undefined) return soma;
    return soma + (Number(v) || 0);
  }, 0);
}

// percentual "SOMA/SOMA" (nunca média de percentuais individuais — bug conhecido da
// planilha original, que dava #REF! na linha de total). null quando o total geral é 0
// (sem faturamento geral não existe percentual de participação a calcular).
export function percentualSobreTotal(totalParte, totalGeral) {
  if (!totalGeral) return null;
  return (totalParte / totalGeral) * 100;
}

// compara dois totais numéricos (mês atual vs mês anterior) com a MESMA regra que o
// backend já usa por loja (`>` -> "subiu", `<` -> "caiu", `===` -> "igual") — usada pra
// montar um objeto `comparacao` sintético (soma vs soma) pra reaproveitar `buildObservacao`
// na linha de TOTAL e nos cards do dashboard, já que a API só devolve comparação por loja.
// null quando falta um dos dois lados (ex.: fetch do mês anterior falhou).
export function compararTotais(atual, anterior) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return null;
  if (atual > anterior) return 'subiu';
  if (atual < anterior) return 'caiu';
  return 'igual';
}

// variação percentual RELATIVA entre dois valores absolutos (ex.: faturamento total do
// mês vs mês anterior: "+18,4%"). null se o anterior for 0/null/undefined (sem base
// válida pra dividir) — diferente de `variacaoPontosPercentuais` abaixo, que compara dois
// percentuais já calculados em pontos percentuais, não em variação relativa.
export function variacaoPercentual(atual, anterior) {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  if (atual === null || atual === undefined) return null;
  return ((atual - anterior) / anterior) * 100;
}

// diferença em PONTOS PERCENTUAIS entre dois percentuais já calculados (ex.: 41,2% ->
// 43,8% é "+2,6 p.p.") — NÃO é variação relativa (essa é a conta que a planilha original
// costumava confundir; ver pedido do item 2 do redesign). null se qualquer um dos dois
// lados for null (sem percentual válido pra comparar).
export function variacaoPontosPercentuais(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) return null;
  if (percentualAnterior === null || percentualAnterior === undefined) return null;
  return percentualAtual - percentualAnterior;
}

// valor absoluto em BR com prefixo "R$" (mesmo padrão de `toBRL` em RankingPage.jsx) —
// usado nos totais/dashboard/ranking desta página; os helpers de máscara acima
// (formatarDigitosBR etc.) são só pro campo de INPUT editável, não servem pra exibir um
// valor já calculado (soma, não vem de dígitos digitados).
export function formatMoedaBR(n) {
  const v = Number(n) || 0;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// variação com sinal explícito (+/-) e 1 casa decimal, formato BR (vírgula) — usada nos
// cards/ranking do dashboard, onde o pedido pede sinal sempre visível (ex. "+18,4%",
// "-9,2%", "+2,6 p.p." com sufixo customizado). Diferente de `formatPercentualBR` (sem
// sinal, 2 casas, usada nos cards de loja/linha de total já existentes, onde o valor
// nunca é negativo). null/undefined/NaN -> null (mesmo contrato de formatPercentualBR).
export function formatVariacaoBR(n, sufixo = '%') {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n).toFixed(1).replace('.', ',');
  return `${sinal}${abs}${sufixo}`;
}

// monta o ranking Top 5 de maiores altas/quedas percentuais (item 2b) a partir de uma
// lista já pareada `{ atual, anterior, ...contexto }` (um item por loja, com os valores
// crus de faturamentoGeral dos dois meses). Só entram lojas com dado NOS DOIS meses
// (atual e anterior não-null) e anterior !== 0 (variação % não existe sem base) — função
// pura, sem depender de React, testável isolada do componente que busca/agrupa os dados.
export function calcularRankingVariacao(itens) {
  const comVariacao = (itens || [])
    .filter(it => it.atual !== null && it.atual !== undefined && it.anterior !== null && it.anterior !== undefined && it.anterior !== 0)
    .map(it => ({ ...it, variacao: variacaoPercentual(it.atual, it.anterior) }))
    .filter(it => it.variacao !== null);

  const altas = comVariacao.filter(it => it.variacao > 0).sort((a, b) => b.variacao - a.variacao).slice(0, 5);
  const quedas = comVariacao.filter(it => it.variacao < 0).sort((a, b) => a.variacao - b.variacao).slice(0, 5);
  return { altas, quedas };
}
