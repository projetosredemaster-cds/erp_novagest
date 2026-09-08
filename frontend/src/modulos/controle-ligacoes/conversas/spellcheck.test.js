import { describe, it, expect } from 'vitest';
import { verificarOrtografia, substituirPrimeiraOcorrencia } from './spellcheck.js';

// Dublê simples de `Typo` — controlamos exatamente quais palavras são "corretas" e quais
// sugestões cada palavra errada devolve, sem precisar carregar o dicionário Hunspell real
// (~4,4MB) nem depender de import() dinâmico dentro do teste.
function criarTypoFake({ corretas = [], sugestoesPorPalavra = {} } = {}) {
  const setCorretas = new Set(corretas);
  return {
    check(palavra) {
      return setCorretas.has(palavra);
    },
    suggest(palavra) {
      return sugestoesPorPalavra[palavra] || [];
    },
  };
}

describe('verificarOrtografia', () => {
  it('palavra correta não aparece na lista de erros', () => {
    const typo = criarTypoFake({ corretas: ['Olá', 'tudo', 'bem'] });

    const resultado = verificarOrtografia('Olá tudo bem', typo);

    expect(resultado).toEqual([]);
  });

  it('palavra errada aparece com sugestões (no máximo 3)', () => {
    const typo = criarTypoFake({
      corretas: ['Olá'],
      sugestoesPorPalavra: { mundoo: ['mundo', 'mundos', 'mundial', 'mundança'] },
    });

    const resultado = verificarOrtografia('Olá mundoo', typo);

    expect(resultado).toEqual([
      { palavra: 'mundoo', sugestoes: ['mundo', 'mundos', 'mundial'] },
    ]);
  });

  it('placeholder "{algumaCoisa}" é ignorado', () => {
    const typo = criarTypoFake({ corretas: ['Olá'] });

    const resultado = verificarOrtografia('Olá {nomeColaboradora}', typo);

    expect(resultado).toEqual([]);
  });

  it('pontuação sozinha é ignorada', () => {
    const typo = criarTypoFake({ corretas: ['Olá', 'tudo', 'bem'] });

    const resultado = verificarOrtografia('Olá, tudo bem?! ... -- ()', typo);

    expect(resultado).toEqual([]);
  });

  it('número sozinho é ignorado', () => {
    const typo = criarTypoFake({ corretas: [] });

    const resultado = verificarOrtografia('123 4567', typo);

    expect(resultado).toEqual([]);
  });

  it('mesma palavra errada repetida aparece só 1x (dedup, na ordem de primeira aparição)', () => {
    const typo = criarTypoFake({
      corretas: ['foi', 'de', 'novo'],
      sugestoesPorPalavra: { erradaa: ['errada'] },
    });

    const resultado = verificarOrtografia('erradaa foi erradaa de novo, erradaa!', typo);

    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toEqual({ palavra: 'erradaa', sugestoes: ['errada'] });
  });

  it('retorna [] quando texto está vazio/ausente', () => {
    const typo = criarTypoFake({ corretas: [] });

    expect(verificarOrtografia('', typo)).toEqual([]);
    expect(verificarOrtografia(null, typo)).toEqual([]);
    expect(verificarOrtografia(undefined, typo)).toEqual([]);
  });

  it('retorna [] quando typo está ausente', () => {
    expect(verificarOrtografia('mundoo', null)).toEqual([]);
    expect(verificarOrtografia('mundoo', undefined)).toEqual([]);
  });

  it('pontuação nas pontas da palavra é removida antes de checar/reportar', () => {
    const typo = criarTypoFake({
      corretas: [],
      sugestoesPorPalavra: { casaa: ['casa'] },
    });

    const resultado = verificarOrtografia('"casaa", (casaa)', typo);

    expect(resultado).toEqual([{ palavra: 'casaa', sugestoes: ['casa'] }]);
  });
});

describe('substituirPrimeiraOcorrencia', () => {
  it('substitui só a primeira ocorrência da palavra', () => {
    const resultado = substituirPrimeiraOcorrencia('mundoo é grande, mundoo enorme', 'mundoo', 'mundo');

    expect(resultado).toBe('mundo é grande, mundoo enorme');
  });

  it('não substitui substring parcial de outra palavra (ex.: "casa" dentro de "casamento")', () => {
    const resultado = substituirPrimeiraOcorrencia('Fui no casamento ontem, foi numa casa linda', 'casa', 'lar');

    expect(resultado).toBe('Fui no casamento ontem, foi numa lar linda');
  });

  it('lida com acentuação (palavra e limites acentuados)', () => {
    const resultado = substituirPrimeiraOcorrencia('Já fui lá e não vi ninguém', 'não', 'nao');

    expect(resultado).toBe('Já fui lá e nao vi ninguém');
  });

  it('não substitui quando a palavra acentuada é prefixo de outra palavra maior (plural)', () => {
    const resultado = substituirPrimeiraOcorrencia('Meus pés doem, mas um pé só dói mais', 'pé', 'joelho');

    expect(resultado).toBe('Meus pés doem, mas um joelho só dói mais');
  });

  it('retorna o texto original quando a palavra não é encontrada', () => {
    const resultado = substituirPrimeiraOcorrencia('Olá tudo bem', 'inexistente', 'x');

    expect(resultado).toBe('Olá tudo bem');
  });
});
