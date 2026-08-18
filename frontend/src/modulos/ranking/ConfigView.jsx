import { useEffect, useMemo, useState } from 'react';
import {
  fetchResponsaveis, criarResponsavel, removerResponsavel,
  fetchRedes, criarLoja, atualizarLoja,
} from '../../lib/cadastrosApi.js';

const btn = "bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110";
const toggleBtn = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-full px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-110";
const removeBtn = "bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-full w-[18px] h-[18px] text-[11px] cursor-pointer leading-none flex-shrink-0";

export default function ConfigView({
  config,
  removeDiretor, addDiretor, updateDiretorNome,
  removeRede, addRede, updateRedeNome, updateRedeEmoji,
  addCategoria, updateCategoriaVisivel, removeCategoria, isAdmin,
  toggleRedeVisivel, toggleRedeAtivo, updateRedeResponsavel, updateRedeDiretor,
  flash,
}) {
  const [newDiretorNome, setNewDiretorNome] = useState('');
  const [novaRedeDiretorId, setNovaRedeDiretorId] = useState('');
  const [novaRedeEmoji, setNovaRedeEmoji] = useState('');
  const [novaRedeNome, setNovaRedeNome] = useState('');
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('');

  const todasRedesFlat = useMemo(() => (
    config.diretores.flatMap(d => d.redes.map(r => ({ id: r.id, label: `${d.nome} — ${r.nome}` })))
  ), [config.diretores]);


  const [responsaveis, setResponsaveis] = useState([]);
  const [loadingResponsaveis, setLoadingResponsaveis] = useState(true);
  const [responsaveisError, setResponsaveisError] = useState(null);
  const [novoResponsavelNome, setNovoResponsavelNome] = useState('');
  const [responsavelFormError, setResponsavelFormError] = useState(null);

  useEffect(() => {
    fetchResponsaveis()
      .then(lista => setResponsaveis(lista || []))
      .catch(err => setResponsaveisError(err.message || 'Erro ao carregar GGs.'))
      .finally(() => setLoadingResponsaveis(false));
  }, []);

  function handleAddResponsavel() {
    const nome = novoResponsavelNome.trim();
    if (!nome) {
      setResponsavelFormError('Informe um nome para o GG.');
      return;
    }
    setResponsavelFormError(null);
    criarResponsavel({ nome })
      .then(responsavelCriado => {
        setResponsaveis(prev => [...prev, responsavelCriado]);
        setNovoResponsavelNome('');
      })
      .catch(err => setResponsavelFormError(err.message || 'Erro ao criar GG'));
  }

  function handleRemoveResponsavel(id) {
    setResponsavelFormError(null);
    removerResponsavel(id)
      .then(() => setResponsaveis(prev => prev.filter(r => r.id !== id)))
      .catch(err => setResponsavelFormError(err.message || 'Erro ao remover GG'));
  }

  const [redesComLojas, setRedesComLojas] = useState([]);
  const [loadingLojas, setLoadingLojas] = useState(true);
  const [lojasError, setLojasError] = useState(null);
  const [novaLojaNomePorRede, setNovaLojaNomePorRede] = useState({});

  useEffect(() => {
    fetchRedes()
      .then(lista => setRedesComLojas(lista || []))
      .catch(err => setLojasError(err.message || 'Erro ao carregar lojas.'))
      .finally(() => setLoadingLojas(false));
  }, []);

  const lojasPorRedeId = useMemo(() => {
    const map = new Map();
    redesComLojas.forEach(r => map.set(r.id, r.lojas || []));
    return map;
  }, [redesComLojas]);

  function updateLojaLocal(redeIdAtual, lojaId, lojaAtualizada) {
    setRedesComLojas(prev => prev.map(r => {
      if (r.id === lojaAtualizada.rede_id) {
        const jaTinha = r.lojas.some(l => l.id === lojaId);
        return {
          ...r,
          lojas: jaTinha ? r.lojas.map(l => (l.id === lojaId ? lojaAtualizada : l)) : [...r.lojas, lojaAtualizada],
        };
      }
      if (r.id === redeIdAtual) {
        return { ...r, lojas: r.lojas.filter(l => l.id !== lojaId) };
      }
      return r;
    }));
  }

  function toggleLojaAtivo(redeId, lojaId, novoValor) {
    atualizarLoja(lojaId, { ativo: novoValor })
      .then(lojaAtualizada => updateLojaLocal(redeId, lojaId, lojaAtualizada))
      .catch(err => flash(err.message || 'Erro ao atualizar status da loja', 'error'));
  }

  function updateLojaRede(redeIdAtual, lojaId, novaRedeId) {
    atualizarLoja(lojaId, { redeId: novaRedeId })
      .then(lojaAtualizada => updateLojaLocal(redeIdAtual, lojaId, lojaAtualizada))
      .catch(err => flash(err.message || 'Erro ao mover loja de rede', 'error'));
  }

  function handleAddLoja(redeId) {
    const nome = (novaLojaNomePorRede[redeId] || '').trim();
    if (!nome) return;
    criarLoja({ redeId, nome })
      .then(lojaCriada => {
        setRedesComLojas(prev => prev.map(r => (r.id === redeId ? { ...r, lojas: [...r.lojas, lojaCriada] } : r)));
        setNovaLojaNomePorRede(prev => ({ ...prev, [redeId]: '' }));
      })
      .catch(err => flash(err.message || 'Erro ao criar loja', 'error'));
  }

  return (
    <div>
      <div className="mb-[22px]">
        <h3 className="font-display text-[19px] mb-3 font-bold">Diretores e redes</h3>
        {lojasError ? <div className="text-[var(--danger)] text-[13px] mb-2">Não foi possível carregar as lojas: {lojasError}</div> : null}
        {config.diretores.map(diretor => (
          <div key={diretor.id} className="border border-[var(--border)] rounded-xl px-4 py-3.5 mb-3 bg-[var(--panel-alt)]">
            <div className="flex gap-2.5 items-center mb-2.5">
              <input
                key={`diretor-nome-${diretor.id}`}
                defaultValue={diretor.nome}
                aria-label={`Nome do diretor ${diretor.nome}`}
                readOnly={!isAdmin}
                onBlur={e => updateDiretorNome(diretor.id, e.target.value)}
                className="font-display text-[var(--text)] text-[19px] font-bold px-1 py-0.5 flex-1 bg-transparent border border-transparent rounded-lg focus:outline-none focus:border-[var(--teal)] focus:bg-[#12151b]"
              />
              {isAdmin ? (
                <button
                  className="bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110"
                  onClick={() => removeDiretor(diretor.id)}
                >
                  Remover diretor
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              {diretor.redes.length
                ? diretor.redes.map(r => {
                  const lojas = lojasPorRedeId.get(r.id) || [];
                  return (
                    <div
                      key={r.id}
                      className={`border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[#12151b] ${r.ativo === false ? 'opacity-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          key={`rede-emoji-${r.id}`}
                          defaultValue={r.emoji || ''}
                          maxLength={2}
                          aria-label={`Emoji da rede ${r.nome}`}
                          readOnly={!isAdmin}
                          onBlur={e => updateRedeEmoji(r.id, e.target.value)}
                          className="w-9 text-center bg-transparent border border-transparent rounded px-1 py-0.5 focus:outline-none focus:border-[var(--teal)]"
                        />
                        <input
                          key={`rede-nome-${r.id}`}
                          defaultValue={r.nome}
                          aria-label={`Nome da rede ${r.nome}`}
                          readOnly={!isAdmin}
                          onBlur={e => updateRedeNome(r.id, e.target.value)}
                          className="w-[120px] bg-transparent border border-transparent rounded px-1 py-0.5 focus:outline-none focus:border-[var(--teal)]"
                        />
                        {isAdmin ? (
                          <select
                            aria-label={`Diretor da rede ${r.nome}`}
                            value={diretor.id}
                            onChange={e => updateRedeDiretor(r.id, Number(e.target.value))}
                            className="text-[12px] font-medium text-[var(--muted)] flex-none w-32 bg-transparent border border-[var(--border)] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[var(--teal)]"
                          >
                            {config.diretores.map(d => (
                              <option key={d.id} value={d.id}>{d.nome}</option>
                            ))}
                          </select>
                        ) : null}
                        {isAdmin ? (
                          <select
                            aria-label={`GG da rede ${r.nome}`}
                            value={r.responsavel?.id ?? ''}
                            onChange={e => updateRedeResponsavel(r.id, e.target.value === '' ? null : Number(e.target.value))}
                            className="text-[12px] font-medium text-[var(--muted)] flex-none w-28 bg-transparent border border-[var(--border)] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[var(--teal)]"
                          >
                            <option value="">Nenhum</option>
                            {responsaveis.map(resp => (
                              <option key={resp.id} value={resp.id}>{resp.nome}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[12px] font-medium text-[var(--muted)] flex-none">
                            {r.responsavel?.nome ?? 'sem GG'}
                          </span>
                        )}
                        {r.visivel === false ? <span className="text-[11px] text-[var(--muted)] font-semibold">(oculta)</span> : null}
                        {r.ativo === false ? <span className="text-[11px] text-[var(--muted)] font-semibold">(inativa)</span> : null}
                        {isAdmin ? (
                          <>
                            <button
                              onClick={() => toggleRedeVisivel(r.id, r.visivel === false ? true : false)}
                              aria-label={`${r.visivel === false ? 'Mostrar' : 'Ocultar'} rede ${r.nome} no relatório`}
                              className={toggleBtn}
                            >
                              {r.visivel === false ? 'Mostrar' : 'Ocultar'}
                            </button>
                            <button
                              onClick={() => toggleRedeAtivo(r.id, r.ativo === false ? true : false)}
                              aria-label={`${r.ativo === false ? 'Reativar' : 'Desativar'} rede ${r.nome}`}
                              className={toggleBtn}
                            >
                              {r.ativo === false ? 'Reativar' : 'Desativar'}
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={() => removeRede(diretor.id, r.id)}
                          aria-label={`Remover rede ${r.nome}`}
                          className={removeBtn}
                        >
                          ✕
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-[var(--border)]">
                        <span className="text-[11px] text-[var(--muted)] font-semibold uppercase tracking-[.04em]">Lojas:</span>
                        {loadingLojas ? <span className="text-[11px] text-[var(--muted)]">Carregando...</span> : null}
                        {!loadingLojas && !lojas.length ? <span className="text-[11px] text-[var(--muted)]">Nenhuma loja ainda</span> : null}
                        {lojas.map(loja => (
                          <span
                            key={loja.id}
                            className={`inline-flex items-center gap-1 bg-[var(--panel-alt)] border border-[var(--border)] rounded-full pl-2.5 pr-1.5 py-1 text-[11px] ${loja.ativo === false ? 'opacity-50' : ''}`}
                          >
                            {loja.nome}
                            {loja.ativo === false ? <span className="text-[var(--muted)] font-semibold">(inativa)</span> : null}
                            {isAdmin ? (
                              <>
                                <select
                                  aria-label={`Mover loja ${loja.nome} para outra rede`}
                                  value={r.id}
                                  onChange={e => updateLojaRede(r.id, loja.id, Number(e.target.value))}
                                  className="text-[11px] font-medium text-[var(--muted)] bg-transparent border border-[var(--border)] rounded-full px-1 py-0.5 focus:outline-none focus:border-[var(--teal)]"
                                >
                                  {todasRedesFlat.map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => toggleLojaAtivo(r.id, loja.id, loja.ativo === false ? true : false)}
                                  aria-label={`${loja.ativo === false ? 'Reativar' : 'Desativar'} loja ${loja.nome}`}
                                  className={toggleBtn}
                                >
                                  {loja.ativo === false ? 'Reativar' : 'Desativar'}
                                </button>
                              </>
                            ) : null}
                          </span>
                        ))}
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              placeholder="Nova loja"
                              aria-label={`Nome da nova loja da rede ${r.nome}`}
                              value={novaLojaNomePorRede[r.id] || ''}
                              onChange={e => setNovaLojaNomePorRede(prev => ({ ...prev, [r.id]: e.target.value }))}
                              className="w-24 bg-transparent border border-[var(--border)] rounded-full px-2 py-1 text-[11px] focus:outline-none focus:border-[var(--teal)]"
                            />
                            <button onClick={() => handleAddLoja(r.id)} className={toggleBtn}>Adicionar loja</button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
                : <span className="text-[var(--muted)] text-[13px]">Nenhuma rede ainda</span>
              }
            </div>
          </div>
        ))}

        {isAdmin ? (
          <div className="flex gap-2 mt-1 flex-wrap items-center">
            <select
              aria-label="Diretor pai da nova rede"
              value={novaRedeDiretorId}
              onChange={e => setNovaRedeDiretorId(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Selecione o diretor...</option>
              {config.diretores.map(d => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
            <input
              placeholder="🏆" maxLength={2} value={novaRedeEmoji} onChange={e => setNovaRedeEmoji(e.target.value)}
              className="w-11 text-center bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-2.5 py-2 text-sm"
            />
            <input
              placeholder="Nome da rede (ex: Delta)" value={novaRedeNome} onChange={e => setNovaRedeNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            />
            <button
              className={btn}
              onClick={() => {
                addRede(novaRedeDiretorId, novaRedeEmoji, novaRedeNome);
                setNovaRedeEmoji('');
                setNovaRedeNome('');
              }}
            >
              Adicionar rede
            </button>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="flex gap-2 mt-2.5">
            <input placeholder="Nome do diretor (ex: Victor Hugo)" value={newDiretorNome} onChange={e => setNewDiretorNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm" />
            <button className={btn} onClick={() => { addDiretor(newDiretorNome); setNewDiretorNome(''); }}>Adicionar diretor</button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="font-display text-[19px] mb-3 font-bold">Categorias</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {config.categorias.map(c => (
            <div key={c.id} className="inline-flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-full pl-4 pr-2 py-2 text-[13px]">
              <span>{c.nome}</span>
              {c.principal ? <span className="text-[var(--teal)] text-[11px]">(principal)</span> : null}
              {c.padrao ? <span className="text-[var(--muted)] text-[11px]">(padrão)</span> : null}
              {c.visivel === false ? <span className="text-[11px] text-[var(--muted)] font-semibold">(oculta)</span> : null}
              {isAdmin ? (
                <button
                  onClick={() => updateCategoriaVisivel(c.id, c.visivel === false ? true : false)}
                  aria-label={`${c.visivel === false ? 'Mostrar' : 'Ocultar'} categoria ${c.nome}`}
                  className={toggleBtn}
                >
                  {c.visivel === false ? 'Mostrar' : 'Ocultar'}
                </button>
              ) : null}
              {}
              {isAdmin && !c.padrao ? (
                <button
                  onClick={() => removeCategoria(c.id)}
                  aria-label={`Remover categoria ${c.nome}`}
                  className={removeBtn}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {isAdmin ? (
          <div className="flex gap-2 items-center flex-wrap">
            <input
              placeholder="Nome da categoria (ex: Frete, Trocas...)" value={novaCategoriaNome}
              onChange={e => setNovaCategoriaNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            />
            <button
              className={btn}
              onClick={() => { addCategoria(novaCategoriaNome); setNovaCategoriaNome(''); }}
            >
              Adicionar categoria
            </button>
          </div>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="mt-[22px]">
          <h3 className="font-display text-[19px] mb-3 font-bold">GGs</h3>
          {loadingResponsaveis ? (
            <div className="text-[var(--muted)] text-sm">Carregando GGs...</div>
          ) : responsaveisError ? (
            <div className="text-[var(--danger)] text-[13px] mb-2">{responsaveisError}</div>
          ) : (
            <div className="flex flex-wrap mb-2">
              {responsaveis.length
                ? responsaveis.map(r => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 bg-[#12151b] border border-[var(--border)] rounded-full pl-3 pr-1.5 py-1 mr-1 mb-1 text-[13px]">
                    {r.nome}
                    <button
                      onClick={() => handleRemoveResponsavel(r.id)}
                      aria-label={`Remover GG ${r.nome}`}
                      className={removeBtn}
                    >
                      ✕
                    </button>
                  </span>
                ))
                : <span className="text-[var(--muted)] text-[13px]">Nenhum GG cadastrado ainda</span>
              }
            </div>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <input
              placeholder="Nome do GG" value={novoResponsavelNome}
              onChange={e => setNovoResponsavelNome(e.target.value)}
              className="bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 text-sm"
            />
            <button className={btn} onClick={handleAddResponsavel}>Adicionar GG</button>
            {responsavelFormError ? <span className="text-[var(--danger)] text-[13px]">{responsavelFormError}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
