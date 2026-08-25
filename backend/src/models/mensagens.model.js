const { sql, getPool } = require('../config/db');

/**
 * Acesso a dados de `Mensagens` — tabela nova da Central de Mensagens (ver
 * CONTRATO-CONTROLE-LIGACOES-API.md, seção "Central de Mensagens (v7)").
 * Schema criado por `backend/src/scripts/MIGRATION-MENSAGENS.sql` (ainda não
 * executado — ver aviso no topo desse arquivo).
 *
 * Erros de driver `mssql` para violação de UNIQUE/PK: `err.number === 2627`
 * (violação de constraint, inclusive PK) ou `2601` (índice único
 * duplicado) — os dois códigos são tratados como equivalentes aqui.
 */
function isViolacaoDeUnique(err) {
  return err && (err.number === 2627 || err.number === 2601);
}

/**
 * Insere uma mensagem recebida de um contato (remetente='cliente'), com o
 * `baileys_message_id` do evento `messages.upsert` que a originou — usada
 * pelo listener em `baileysSession.service.js: handleMessagesUpsert`.
 *
 * `ePrimeiraRespostaCliente` (boolean) grava a coluna
 * `e_primeira_resposta_cliente` — sinaliza que esta é a PRIMEIRA mensagem de
 * cliente já recebida daquele contato desde sempre (o momento de handoff
 * IA→humano), usada pelo sino de notificações do frontend
 * (`contarNotificacoesNaoVistas` abaixo). Quem chama esta função é
 * responsável por checar isso ANTES do insert (ver
 * `existeMensagemClienteAnterior` abaixo) — a ordem importa, checar depois
 * do insert sempre encontraria a própria linha recém-gravada.
 *
 * Se o mesmo evento já tiver sido gravado antes para este número (violação
 * do índice único filtrado `UQ_Mensagens_baileysId`, que ignora linhas com
 * `baileys_message_id IS NULL` — ver nota de design no contrato sobre por
 * que isso não é uma UNIQUE CONSTRAINT simples), o erro é capturado e
 * ignorado em silêncio — é dedup esperado de um evento duplicado do
 * Baileys, não uma falha. Retorna a mensagem inserida, ou `null` quando
 * ignorada por dedup.
 */
async function inserirMensagemRecebida({ contatoId, numeroRemetenteId, corpo, baileysMessageId, ePrimeiraRespostaCliente }) {
  const pool = await getPool();

  try {
    const result = await pool
      .request()
      .input('contatoId', sql.Int, contatoId)
      .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
      .input('corpo', sql.NVarChar(sql.MAX), corpo)
      .input('baileysMessageId', sql.VarChar(100), baileysMessageId ?? null)
      .input('ePrimeiraRespostaCliente', sql.Bit, Boolean(ePrimeiraRespostaCliente))
      .query(`
        INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, lida, e_primeira_resposta_cliente, criado_em)
        OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.criado_em, inserted.e_primeira_resposta_cliente
        VALUES (@contatoId, @numeroRemetenteId, 'cliente', @corpo, @baileysMessageId, 0, @ePrimeiraRespostaCliente, SYSUTCDATETIME())
      `);
    return result.recordset[0];
  } catch (err) {
    if (isViolacaoDeUnique(err)) {
      console.log(
        `[mensagens.model] mensagem duplicada ignorada (dedup) — numeroRemetenteId=${numeroRemetenteId}, ` +
        `baileysMessageId=${baileysMessageId}.`
      );
      return null;
    }
    throw err;
  }
}

/**
 * Checa se um contato já teve alguma mensagem de cliente (`remetente =
 * 'cliente'`) gravada ANTES de agora — usada por
 * `baileysSession.service.js: handleMessagesUpsert` para decidir se a
 * mensagem que está prestes a ser inserida é a primeira resposta daquele
 * contato (handoff IA→humano). Precisa ser chamada antes do `INSERT` de
 * `inserirMensagemRecebida`, nunca depois (senão encontraria a própria
 * linha recém-gravada). Retorna boolean.
 */
async function existeMensagemClienteAnterior(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) 1 AS ok
      FROM Mensagens
      WHERE contato_id = @contatoId AND remetente = 'cliente'
    `);
  return result.recordset.length > 0;
}

/**
 * Conta quantas mensagens são "primeira resposta de cliente" (handoff
 * IA→humano) e ainda não foram vistas (`lida = 0`) — usada pelo sino de
 * notificações do frontend, `GET /api/controle-ligacoes/notificacoes`.
 * Retorna o número total.
 */
async function contarNotificacoesNaoVistas() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`
      SELECT COUNT(*) AS total
      FROM Mensagens
      WHERE e_primeira_resposta_cliente = 1 AND lida = 0
    `);
  return result.recordset[0]?.total ?? 0;
}

/**
 * Trunca `texto` para no máximo `tamanho` caracteres, acrescentando "…" no
 * final quando de fato corta algo — usada para montar o `preview` de
 * `listNotificacoesPendentes` abaixo. Textos com `tamanho` caracteres ou
 * menos voltam inalterados (sem reticências).
 */
function truncarTexto(texto, tamanho) {
  if (typeof texto !== 'string' || texto.length <= tamanho) {
    return texto;
  }
  return `${texto.slice(0, tamanho)}…`;
}

/**
 * Lista as `limite` notificações pendentes mais recentes (mesmo filtro de
 * `contarNotificacoesNaoVistas`: `e_primeira_resposta_cliente = 1 AND lida =
 * 0`), ordenadas por `criado_em DESC` — usada por
 * `GET /api/controle-ligacoes/notificacoes` para alimentar o dropdown do
 * sino no frontend (nome do contato + preview da mensagem + horário). A
 * contagem total continua vindo de `contarNotificacoesNaoVistas`, que pode
 * ser maior que o tamanho desta lista quando houver mais de `limite`
 * pendentes — o dropdown mostra só as mais recentes, de propósito. Default
 * de `limite` é 10 (sem paginação nesta fase); `preview` é truncado para no
 * máximo 80 caracteres, com "…" no final quando corta.
 */
async function listNotificacoesPendentes(limite = 10) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('limite', sql.Int, limite)
    .query(`
      SELECT TOP (@limite)
        m.contato_id,
        c.nome,
        c.telefone,
        m.corpo,
        m.criado_em
      FROM Mensagens m
      JOIN Contatos c ON c.id = m.contato_id
      WHERE m.e_primeira_resposta_cliente = 1 AND m.lida = 0
      ORDER BY m.criado_em DESC
    `);

  return result.recordset.map((row) => ({
    contatoId: row.contato_id,
    nomeContato: row.nome,
    telefone: row.telefone,
    preview: truncarTexto(row.corpo, 80),
    criado_em: row.criado_em,
  }));
}

/**
 * Insere uma mensagem enviada por nós (`remetente` = 'ia' | 'colaboradora'),
 * sem `baileys_message_id` (`NULL` — não conflita com a constraint UNIQUE,
 * ver nota de design no topo da migration). Usada pelo worker de envio
 * (`workers/envioDisparos.worker.js`, remetente='ia') e pela rota de
 * resposta manual (`conversas.service.js`, remetente='colaboradora').
 */
async function inserirMensagemEnviada({ contatoId, numeroRemetenteId, remetente, corpo }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .input('remetente', sql.VarChar(20), remetente)
    .input('corpo', sql.NVarChar(sql.MAX), corpo)
    .query(`
      INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, criado_em)
      OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.criado_em
      VALUES (@contatoId, @numeroRemetenteId, @remetente, @corpo, NULL, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}

/**
 * Busca o id de um Contato entre uma lista de telefones candidatos (só
 * dígitos, formato `55DDDNNNNNNNNN`, mesmo formato de `Contatos.telefone`) —
 * usada por `baileysSession.service.js: handleMessagesUpsert` para tentar o
 * telefone recebido do WhatsApp E a variante com/sem o 9º dígito (ver
 * `gerarVariantesTelefoneBr`), numa única query, já que o servidor do
 * WhatsApp às vezes representa a conta sem o 9º dígito do celular
 * brasileiro mesmo quando o número real tem o 9. Cada candidato é bindado
 * por posição como `sql.VarChar(20)` (nunca concatenado em string) e a
 * query usa `IN (...)`; como `Contatos.telefone` é `UNIQUE` globalmente, no
 * máximo uma linha pode bater com qualquer candidato da lista. Retorna
 * `null` se nenhum candidato encontrar um Contato, ou se `telefones` vier
 * vazio.
 */
async function findContatoIdPorTelefoneComVariantes(telefones) {
  const candidatos = Array.isArray(telefones) ? telefones.filter(Boolean) : [];
  if (candidatos.length === 0) {
    return null;
  }

  const pool = await getPool();
  const request = pool.request();
  const placeholders = candidatos.map((telefone, index) => {
    const paramName = `telefone${index}`;
    request.input(paramName, sql.VarChar(20), telefone);
    return `@${paramName}`;
  });

  const result = await request.query(
    `SELECT TOP (1) id FROM Contatos WHERE telefone IN (${placeholders.join(', ')})`
  );
  return result.recordset[0]?.id ?? null;
}

/**
 * Checa só a existência de um Contato pelo id — usada pelas rotas de
 * conversas para devolver 404 explícito (`GET`/`POST .../:contatoId/...`)
 * quando o contato não existe, em vez de confiar em "veio vazio = 404".
 */
async function existeContato(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query('SELECT 1 AS ok FROM Contatos WHERE id = @contatoId');
  return result.recordset.length > 0;
}

/**
 * Telefone normalizado de um Contato pelo id — usado por
 * `conversas.service.js: responder` para chamar `sock.onWhatsApp(telefone)`
 * antes de enviar a resposta manual. Retorna `null` se o contato não
 * existir.
 */
async function findTelefoneContato(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query('SELECT telefone FROM Contatos WHERE id = @contatoId');
  return result.recordset[0]?.telefone ?? null;
}

/**
 * Lista as conversas (contatos com pelo menos 1 mensagem em `Mensagens`),
 * ordenadas pela mensagem mais recente DESC — usada por
 * `GET /api/controle-ligacoes/conversas`. `busca` (opcional) filtra por
 * nome OU telefone do contato (LIKE); `apenasNaoLidas` (opcional) filtra só
 * contatos com pelo menos 1 mensagem `remetente='cliente' AND lida=0`.
 *
 * Para cada contato, devolve também o `numero_remetente_id` da mensagem
 * mais recente (para resolver `numeroRemetenteAtual`), o da mensagem mais
 * antiga (para resolver `numeroRemetenteInicial` — pode ser um número
 * diferente do atual) e a contagem de mensagens não lidas.
 */
async function listConversas({ busca, apenasNaoLidas } = {}) {
  const pool = await getPool();
  const request = pool.request();

  let whereBusca = '';
  if (busca) {
    request.input('busca', sql.NVarChar, `%${busca}%`);
    whereBusca = 'AND (c.nome LIKE @busca OR c.telefone LIKE @busca)';
  }

  let havingNaoLidas = '';
  if (apenasNaoLidas) {
    havingNaoLidas = `
      HAVING SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) > 0
    `;
  }

  const result = await request.query(`
    SELECT
      c.id AS contato_id,
      c.nome AS contato_nome,
      c.telefone AS contato_telefone,
      MAX(m.criado_em) AS ultima_mensagem_em,
      SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) AS nao_lidas
    FROM Mensagens m
    JOIN Contatos c ON c.id = m.contato_id
    WHERE 1 = 1
    ${whereBusca}
    GROUP BY c.id, c.nome, c.telefone
    ${havingNaoLidas}
    ORDER BY MAX(m.criado_em) DESC
  `);

  const conversas = result.recordset;
  if (conversas.length === 0) {
    return [];
  }

  // Busca, numa segunda query, a última mensagem de fato (corpo/remetente/
  // numero_remetente_id) de cada contato encontrado — evita depender de
  // agregações como MAX(corpo) (que não são deterministas em T-SQL) para
  // saber qual foi a última mensagem de verdade.
  const contatoIds = conversas.map((row) => row.contato_id);
  const idsRequest = pool.request();
  const placeholders = contatoIds.map((id, index) => {
    const paramName = `id${index}`;
    idsRequest.input(paramName, sql.Int, id);
    return `@${paramName}`;
  });

  const ultimasResult = await idsRequest.query(`
    SELECT m.contato_id, m.remetente, m.corpo, m.criado_em, m.numero_remetente_id, n.apelido
    FROM Mensagens m
    INNER JOIN (
      SELECT contato_id, MAX(id) AS ultimo_id
      FROM Mensagens
      WHERE contato_id IN (${placeholders.join(', ')})
      GROUP BY contato_id
    ) ultimas ON ultimas.ultimo_id = m.id
    JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
  `);

  const ultimaPorContato = new Map(ultimasResult.recordset.map((row) => [row.contato_id, row]));

  // Espelha a query de "ultimas" acima, só que com MIN(id) em vez de MAX(id)
  // — busca a PRIMEIRA mensagem de cada contato (a que iniciou a conversa),
  // para resolver `numeroRemetenteInicial`. Um contato pode ter sido
  // iniciado por um número remetente e respondido mais recentemente por
  // outro — os dois campos podem divergir de propósito (ver
  // CONTRATO-CONTROLE-LIGACOES-API.md, seção "Central de Mensagens (v7)").
  const primeirasRequest = pool.request();
  const placeholdersPrimeiras = contatoIds.map((id, index) => {
    const paramName = `pid${index}`;
    primeirasRequest.input(paramName, sql.Int, id);
    return `@${paramName}`;
  });

  const primeirasResult = await primeirasRequest.query(`
    SELECT m.contato_id, m.numero_remetente_id, n.apelido
    FROM Mensagens m
    INNER JOIN (
      SELECT contato_id, MIN(id) AS primeiro_id
      FROM Mensagens
      WHERE contato_id IN (${placeholdersPrimeiras.join(', ')})
      GROUP BY contato_id
    ) primeiras ON primeiras.primeiro_id = m.id
    JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
  `);

  const primeiraPorContato = new Map(primeirasResult.recordset.map((row) => [row.contato_id, row]));

  return conversas.map((row) => {
    const ultima = ultimaPorContato.get(row.contato_id);
    const primeira = primeiraPorContato.get(row.contato_id);
    return {
      contato: { id: row.contato_id, nome: row.contato_nome, telefone: row.contato_telefone },
      numeroRemetenteAtual: ultima ? { id: ultima.numero_remetente_id, apelido: ultima.apelido } : null,
      numeroRemetenteInicial: primeira ? { id: primeira.numero_remetente_id, apelido: primeira.apelido } : null,
      ultimaMensagem: ultima
        ? { corpo: ultima.corpo, remetente: ultima.remetente, criado_em: ultima.criado_em }
        : null,
      naoLidas: row.nao_lidas || 0,
    };
  });
}

/**
 * Todas as mensagens de um contato, ordenadas por `criado_em ASC` — usada
 * por `GET /api/controle-ligacoes/conversas/:contatoId/mensagens`. Na mesma
 * chamada, marca como lida toda mensagem `remetente='cliente' AND lida=0`
 * daquele contato (efeito colateral esperado: "abrir a conversa = marcar
 * como lida").
 */
async function listMensagensEMarcarLidas(contatoId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT id, remetente, corpo, criado_em
      FROM Mensagens
      WHERE contato_id = @contatoId
      ORDER BY criado_em ASC
    `);

  await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      UPDATE Mensagens
      SET lida = 1
      WHERE contato_id = @contatoId AND remetente = 'cliente' AND lida = 0
    `);

  return result.recordset;
}

/**
 * `numero_remetente_id` da mensagem mais recente de um contato (desempate
 * por `id DESC`) — usada por `POST /conversas/:contatoId/mensagens` para
 * decidir por qual número remetente a resposta deve ser enviada. Retorna
 * `null` se o contato nunca teve nenhuma mensagem.
 */
async function findUltimoNumeroRemetenteDaConversa(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) numero_remetente_id
      FROM Mensagens
      WHERE contato_id = @contatoId
      ORDER BY criado_em DESC, id DESC
    `);
  return result.recordset[0]?.numero_remetente_id ?? null;
}

/**
 * `{ id, apelido }` do número remetente da mensagem MAIS ANTIGA (a que
 * iniciou a conversa) de um contato — usada por
 * `GET /conversas/:contatoId/mensagens` para expor `numeroRemetenteInicial`
 * na resposta. Diferente de `findUltimoNumeroRemetenteDaConversa` (mesma
 * ordenação invertida, `ASC` em vez de `DESC`), já junta `NumerosRemetentes`
 * pra devolver o objeto pronto para exibição — este propósito é de
 * exibição, não de decidir por qual socket enviar uma resposta (esse
 * continua sendo o "último", não o "primeiro"). Retorna `null` se o contato
 * nunca teve nenhuma mensagem.
 */
async function findPrimeiroNumeroRemetenteDaConversa(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) m.numero_remetente_id, n.apelido
      FROM Mensagens m
      JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
      WHERE m.contato_id = @contatoId
      ORDER BY m.criado_em ASC, m.id ASC
    `);

  const row = result.recordset[0];
  return row ? { id: row.numero_remetente_id, apelido: row.apelido } : null;
}

module.exports = {
  inserirMensagemRecebida,
  existeMensagemClienteAnterior,
  contarNotificacoesNaoVistas,
  listNotificacoesPendentes,
  inserirMensagemEnviada,
  findContatoIdPorTelefoneComVariantes,
  existeContato,
  findTelefoneContato,
  listConversas,
  listMensagensEMarcarLidas,
  findUltimoNumeroRemetenteDaConversa,
  findPrimeiroNumeroRemetenteDaConversa,
};
