-- Migration: cria as tabelas Disparos e DisparoContatos (Painel de Disparo)
-- Ver CONTRATO-CONTROLE-LIGACOES-API.md, seção "Painel de Disparo (v3)" para
-- o contrato completo da API que consome estas tabelas.
--
-- Fila de intenção de disparo manual (até 10 contatos por vez, por Estado)
-- registrada pela Lívia. Envio real via Baileys/Gemini é trabalho futuro —
-- nenhum worker/processador consome esta fila ainda; status fica travado em
-- 'pendente_envio' nesta fase.
--
-- Decisão de negócio importante (ver contrato): um Contato pertence a um
-- Estado fixo, mas NÃO fica travado a um número remetente específico — em
-- disparos diferentes, o mesmo contato pode ser contatado por qualquer
-- número ativo do seu Estado. Por isso Disparos.numero_remetente_id é o
-- número escolhido NAQUELE disparo, não uma trava permanente do contato.
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev)
-- antes de usar as rotas de /api/controle-ligacoes/painel-disparo,
-- /api/controle-ligacoes/estados/:estadoId/contatos-disponiveis e
-- /api/controle-ligacoes/disparos. NÃO rode contra o Azure SQL de produção
-- sem confirmação explícita.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'Disparos'
)
BEGIN
  CREATE TABLE Disparos (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    estado_id              INT NOT NULL FOREIGN KEY REFERENCES Estados(id),
    numero_remetente_id    INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    usuario_id             INT NOT NULL FOREIGN KEY REFERENCES Usuarios(id),
    status                 VARCHAR(30) NOT NULL DEFAULT 'pendente_envio',
    criado_em              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );

  PRINT 'Tabela Disparos criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela Disparos já existe — nada a fazer.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'DisparoContatos'
)
BEGIN
  CREATE TABLE DisparoContatos (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    disparo_id   INT NOT NULL FOREIGN KEY REFERENCES Disparos(id),
    contato_id   INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    CONSTRAINT UQ_DisparoContatos UNIQUE (disparo_id, contato_id)
  );

  PRINT 'Tabela DisparoContatos criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela DisparoContatos já existe — nada a fazer.';
END
GO
