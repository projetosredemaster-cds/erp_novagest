-- Migration: Worker de Envio de Disparos — MensagensTemplates,
-- ConfiguracoesEnvio, NumerosRemetentes.nome_colaboradora e as colunas novas
-- de DisparoContatos (status/template_usado_id/mensagem_enviada/enviado_em/erro).
-- Ver CONTRATO-CONTROLE-LIGACOES-API.md, seção "Envio de Disparos (v6)"
-- para o contrato completo (rota GET /disparos/:id + comportamento do
-- worker que consome esta fila).
--
-- Idempotente (IF NOT EXISTS / IF COL_LENGTH), mesmo padrão de
-- MIGRATION-DISPAROS.sql e MIGRATION-LOTE-IMPORTACAO-ERROS.sql.
--
-- NÃO existe hoje nenhuma rota de CRUD para MensagensTemplates nem para
-- editar NumerosRemetentes.nome_colaboradora — a única forma de popular
-- essas colunas/tabela, por ora, é SQL direto contra o banco (lacuna
-- conhecida, decisão consciente de não implementar isso agora).
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev)
-- antes de usar o worker de envio (backend/src/workers/envioDisparos.worker.js)
-- e a rota GET /api/controle-ligacoes/disparos/:id. NÃO rode contra o Azure
-- SQL de produção sem confirmação explícita.

-- 1) MensagensTemplates: os textos-modelo usados na rotação round-robin.
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'MensagensTemplates'
)
BEGIN
  CREATE TABLE MensagensTemplates (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    corpo      NVARCHAR(MAX) NOT NULL,
    ordem      INT NOT NULL,
    ativo      BIT NOT NULL DEFAULT 1,
    criado_em  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );

  PRINT 'Tabela MensagensTemplates criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela MensagensTemplates já existe — nada a fazer.';
END
GO

-- 2) ConfiguracoesEnvio: linha única, guarda o ponteiro da rotação de
-- template (qual foi o último usado com sucesso).
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'ConfiguracoesEnvio'
)
BEGIN
  CREATE TABLE ConfiguracoesEnvio (
    id                        INT IDENTITY(1,1) PRIMARY KEY,
    ultimo_template_usado_id  INT NULL FOREIGN KEY REFERENCES MensagensTemplates(id)
  );

  PRINT 'Tabela ConfiguracoesEnvio criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela ConfiguracoesEnvio já existe — nada a fazer.';
END
GO

-- Garante exatamente 1 linha em ConfiguracoesEnvio — o worker sempre espera
-- encontrar no máximo 1 linha lá (ver mensagensTemplates.model.js:
-- getUltimoTemplateUsadoId/setUltimoTemplateUsadoId, que usam TOP(1)). Só
-- insere se a tabela ainda estiver vazia — idempotente.
IF NOT EXISTS (SELECT 1 FROM ConfiguracoesEnvio)
BEGIN
  INSERT INTO ConfiguracoesEnvio (ultimo_template_usado_id) VALUES (NULL);
  PRINT 'Linha única de ConfiguracoesEnvio inserida (ultimo_template_usado_id = NULL).';
END
ELSE
BEGIN
  PRINT 'ConfiguracoesEnvio já tem ao menos uma linha — nada a fazer.';
END
GO

-- 3) NumerosRemetentes.nome_colaboradora — nome usado para preencher o
-- placeholder {nomeColaboradora} nos templates. Sem forma de editar via API
-- ainda (ver aviso no topo deste arquivo) — precisa ser preenchido via SQL
-- direto para o worker ter o que enviar.
IF COL_LENGTH('NumerosRemetentes', 'nome_colaboradora') IS NULL
BEGIN
  ALTER TABLE NumerosRemetentes ADD nome_colaboradora NVARCHAR(150) NULL;
  PRINT 'Coluna NumerosRemetentes.nome_colaboradora adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna NumerosRemetentes.nome_colaboradora já existe — nada a fazer.';
END
GO

-- 4) DisparoContatos ganha o rastro de envio individual de cada contato.
IF COL_LENGTH('DisparoContatos', 'status') IS NULL
BEGIN
  ALTER TABLE DisparoContatos ADD status VARCHAR(20) NOT NULL DEFAULT 'pendente';
  PRINT 'Coluna DisparoContatos.status adicionada com sucesso (default ''pendente'').';
END
ELSE
BEGIN
  PRINT 'Coluna DisparoContatos.status já existe — nada a fazer.';
END
GO

IF COL_LENGTH('DisparoContatos', 'template_usado_id') IS NULL
BEGIN
  ALTER TABLE DisparoContatos ADD template_usado_id INT NULL;
  ALTER TABLE DisparoContatos ADD CONSTRAINT FK_DisparoContatos_MensagensTemplates
    FOREIGN KEY (template_usado_id) REFERENCES MensagensTemplates(id);
  PRINT 'Coluna DisparoContatos.template_usado_id adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna DisparoContatos.template_usado_id já existe — nada a fazer.';
END
GO

IF COL_LENGTH('DisparoContatos', 'mensagem_enviada') IS NULL
BEGIN
  ALTER TABLE DisparoContatos ADD mensagem_enviada NVARCHAR(MAX) NULL;
  PRINT 'Coluna DisparoContatos.mensagem_enviada adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna DisparoContatos.mensagem_enviada já existe — nada a fazer.';
END
GO

IF COL_LENGTH('DisparoContatos', 'enviado_em') IS NULL
BEGIN
  ALTER TABLE DisparoContatos ADD enviado_em DATETIME2 NULL;
  PRINT 'Coluna DisparoContatos.enviado_em adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna DisparoContatos.enviado_em já existe — nada a fazer.';
END
GO

IF COL_LENGTH('DisparoContatos', 'erro') IS NULL
BEGIN
  ALTER TABLE DisparoContatos ADD erro NVARCHAR(500) NULL;
  PRINT 'Coluna DisparoContatos.erro adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna DisparoContatos.erro já existe — nada a fazer.';
END
GO
