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
export function extrairDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}
export function formatarDigitosBR(digitos) {
  if (!digitos) return '';
  const n = parseInt(digitos, 10) || 0;
  const centavos = String(n % 100).padStart(2, '0');
  const inteiro = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${centavos}`;
}
export function digitosParaValor(digitos) {
  if (!digitos) return '';
  return (parseInt(digitos, 10) || 0) / 100;
}
export function valorParaDigitos(valor) {
  if (valor === '' || valor === undefined || valor === null) return '';
  const n = Math.round(Number(valor) * 100);
  return Number.isFinite(n) ? String(n) : '';
}
export function moveCaretToEnd(el) {
  requestAnimationFrame(() => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}
export function numOrZero(v) {
  return v === '' || v === undefined || v === null ? 0 : (Number(v) || 0);
}
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
const CAMPO_COMPARACAO_POR_LABEL = {
  MARKETING: 'faturamentoMarketing',
  'RETORNO/INDICAÇÃO': 'faturamentoRetornoIndicacao',
};
const TEXTO_EXIBICAO_POR_LABEL = {
  MARKETING: 'RENDIMENTO',
  'RETORNO/INDICAÇÃO': 'RETORNO/INDICAÇÃO',
};
export function buildObservacao(comparacao, label) {
  if (!comparacao) return 'SEM DADO DO MÊS ANTERIOR';
  const campoParte = CAMPO_COMPARACAO_POR_LABEL[label];
  const geral = comparacao.faturamentoGeral;
  const parte = campoParte ? comparacao[campoParte] : undefined;
  const builder = TEXTOS_OBSERVACAO[`${geral}|${parte}`];
  const textoExibicao = TEXTO_EXIBICAO_POR_LABEL[label] ?? label;
  return builder ? builder(textoExibicao) : 'SEM DADO DO MÊS ANTERIOR';
}

export const SETA_PERCENTUAL = {
  subiu: { icone: '▲', classe: 'text-emerald-400' },
  caiu: { icone: '▼', classe: 'text-orange-400' },
};

export function corCardPorFaturamentoGeral(estadoGeral) {
  if (estadoGeral === 'subiu') return 'border-emerald-800/60 bg-emerald-950/25';
  if (estadoGeral === 'caiu') return 'border-orange-800/60 bg-orange-950/25';
  return 'border-[var(--border)] bg-[var(--panel-alt)]';
}

export function somarCampoLojas(lojas, campo) {
  return (lojas || []).reduce((soma, loja) => {
    const v = loja?.[campo];
    if (v === null || v === undefined) return soma;
    return soma + (Number(v) || 0);
  }, 0);
}

export function percentualSobreTotal(totalParte, totalGeral) {
  if (!totalGeral) return null;
  return (totalParte / totalGeral) * 100;
}

export function compararTotais(atual, anterior) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return null;
  if (atual > anterior) return 'subiu';
  if (atual < anterior) return 'caiu';
  return 'igual';
}

export function variacaoPercentual(atual, anterior) {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  if (atual === null || atual === undefined) return null;
  return ((atual - anterior) / anterior) * 100;
}

export function variacaoPontosPercentuais(percentualAtual, percentualAnterior) {
  if (percentualAtual === null || percentualAtual === undefined) return null;
  if (percentualAnterior === null || percentualAnterior === undefined) return null;
  return percentualAtual - percentualAnterior;
}

export function formatMoedaBR(n) {
  const v = Number(n) || 0;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatVariacaoBR(n, sufixo = '%') {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const sinal = n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n).toFixed(1).replace('.', ',');
  return `${sinal}${abs}${sufixo}`;
}

export function periodoAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

function parseMesAno(mesAno) {
  if (!mesAno || typeof mesAno !== 'string') return null;
  const partes = mesAno.split('-');
  if (partes.length !== 2) return null;
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

export function enumerarPeriodos(mesAnoInicio, mesAnoFim) {
  const inicio = parseMesAno(mesAnoInicio);
  const fim = parseMesAno(mesAnoFim);
  if (!inicio || !fim) return [];
  const chaveInicio = inicio.ano * 12 + inicio.mes;
  const chaveFim = fim.ano * 12 + fim.mes;
  if (chaveFim < chaveInicio) return [];

  const periodos = [];
  let ano = inicio.ano;
  let mes = inicio.mes;
  for (let chave = chaveInicio; chave <= chaveFim; chave += 1) {
    periodos.push({ ano, mes });
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return periodos;
}

export function calcularRankingVariacao(itens) {
  const comVariacao = (itens || [])
    .filter(it => it.atual !== null && it.atual !== undefined && it.anterior !== null && it.anterior !== undefined && it.anterior !== 0)
    .map(it => ({ ...it, variacao: variacaoPercentual(it.atual, it.anterior) }))
    .filter(it => it.variacao !== null);

  const altas = comVariacao.filter(it => it.variacao > 0).sort((a, b) => b.variacao - a.variacao).slice(0, 5);
  const quedas = comVariacao.filter(it => it.variacao < 0).sort((a, b) => a.variacao - b.variacao).slice(0, 5);
  return { altas, quedas };
}
