// Módulo utilitário puro (sem JSX) — carregamento lazy do corretor ortográfico usado no campo de
// resposta manual de `ConversasPage.jsx`.
//
// Biblioteca: `typo-js` (BSD-3-Clause), um verificador estilo Hunspell 100% em JS.
// Dicionário: `hunspell-dict-pt-br` (LGPL-2.1) — dicionário Hunspell pt-BR "puro" (arquivos
// `pt-br.aff`/`pt-br.dic` do projeto BrOffice/VERO, de Raimundo Santos Moura), publicado como
// pacote npm sem nenhuma dependência de runtime. Foi escolhido em vez de `dictionary-pt`
// (também avaliado): `dictionary-pt` é o dicionário genérico "Portuguese" do projeto
// wooorm/dictionaries (licença dupla LGPL-3.0/MPL-2.0) — o próprio pacote `dictionary-pt-br`
// (agora deprecated) recomenda usá-lo no lugar para pt-BR, mas seu `index.js` lê os arquivos via
// `node:fs/promises` + `import.meta.url`, pensado para Node, não para bundle de navegador; já
// `hunspell-dict-pt-br` só publica os arquivos `.aff`/`.dic` crus (sem JS de carregamento), o que
// permite importá-los diretamente como texto via Vite (`?raw`) sem nenhuma dependência de `fs`.
// Os dois são redistribuíveis (licenças permissivas/copyleft fraco, comuns em dicionários
// Hunspell) — nenhuma das duas exige que o código deste projeto também seja LGPL/MPL, só que a
// própria biblioteca/dicionário, se modificados, tenham as modificações liberadas; aqui os dois
// são usados sem nenhuma modificação.
//
// A instância do `Typo` é cara de montar (o `.dic` tem ~4,4MB) — por isso é criada só uma vez por
// sessão do navegador: `getSpellchecker()` memoiza a Promise numa variável de módulo, então
// chamar a função várias vezes (ex.: de re-renders de `ConversasPage.jsx`) sempre devolve a
// mesma promise/instância, sem reconstruir o dicionário.

let spellcheckerPromise = null;

export function getSpellchecker() {
  if (!spellcheckerPromise) {
    spellcheckerPromise = Promise.all([
      import('typo-js'),
      import('hunspell-dict-pt-br/pt-br.aff?raw'),
      import('hunspell-dict-pt-br/pt-br.dic?raw'),
    ]).then(([typoModule, affModule, dicModule]) => {
      const Typo = typoModule.default;
      return new Typo('pt_BR', affModule.default, dicModule.default);
    });
  }
  return spellcheckerPromise;
}

// Token que representa um placeholder inteiro entre chaves, ex.: "{nomeColaboradora}".
const PLACEHOLDER_REGEX = /^\{.*\}$/;

// Remove pontuação (aspas, vírgula, ponto, parênteses...) das pontas do token, preservando
// letras (inclusive acentuadas) e números no meio/pontas da palavra.
function limparPalavra(token) {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function ehIgnoravel(token) {
  if (!token) return true;
  if (PLACEHOLDER_REGEX.test(token)) return true;
  const limpa = limparPalavra(token);
  if (!limpa) return true; // token era só pontuação
  if (/^\d+$/.test(limpa)) return true; // token era só números
  return false;
}

/**
 * Verifica a ortografia de um texto livre usando uma instância já carregada de `Typo`.
 * Divide o texto por espaços, ignora tokens só de pontuação/números/placeholders `{...}`, e
 * devolve uma lista deduplicada (por palavra, na ordem de primeira aparição) de
 * `{ palavra, sugestoes }` para cada palavra não reconhecida pelo dicionário — no máximo 3
 * sugestões por palavra.
 */
export function verificarOrtografia(texto, typo) {
  if (!texto || !typo) return [];

  const tokens = texto.split(/\s+/).filter(Boolean);
  const vistas = new Set();
  const resultado = [];

  for (const token of tokens) {
    if (ehIgnoravel(token)) continue;
    const palavra = limparPalavra(token);
    if (!palavra || vistas.has(palavra)) continue;
    vistas.add(palavra);

    if (typo.check(palavra)) continue;
    resultado.push({ palavra, sugestoes: typo.suggest(palavra).slice(0, 3) });
  }

  return resultado;
}

function escapeRegExp(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Substitui a PRIMEIRA ocorrência de `palavra` (respeitando limites de palavra — inclusive
 * acentuação pt-BR, via `\p{L}`/`\p{N}` unicode) por `substituta`, preservando o resto do texto.
 * Ocorrências repetidas da mesma palavra em outros pontos do texto não são alteradas.
 */
export function substituirPrimeiraOcorrencia(texto, palavra, substituta) {
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(palavra)}(?![\\p{L}\\p{N}_])`, 'u');
  return texto.replace(regex, substituta);
}
