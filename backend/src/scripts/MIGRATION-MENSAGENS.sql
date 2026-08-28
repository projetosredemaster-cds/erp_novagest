-- Migration: cria a tabela Mensagens (Central de Mensagens)
-- Ver CONTRATO-CONTROLE-LIGACOES-API.md, seção "Central de Mensagens (v7)"
-- para o contrato completo da API/listener/worker que usam esta tabela.
--
-- ATENÇÃO: este arquivo foi RECONSTRUÍDO a partir do schema documentado no
-- contrato (a versão original foi perdida do disco antes de ser commitada —
-- era um arquivo novo/untracked, nunca chegou a ser executada contra nenhum
-- banco, local ou produção). O `CREATE TABLE`/`CREATE UNIQUE INDEX` abaixo
-- são cópia fiel do bloco `sql` documentado no contrato; o passo de remoção
-- de constraint antiga é uma reconstrução de boa-fé da correção descrita em
-- prosa lá (não havia SQL literal salvo para essa parte) — revise antes de
-- rodar, sobretudo esse segundo passo.
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev) antes
-- de usar o listener/worker/rotas de /api/controle-ligacoes/conversas*. NÃO
-- rode contra o Azure SQL de produção sem confirmação explícita.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'Mensagens'
)
BEGIN
  CREATE TABLE Mensagens (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    contato_id             INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    numero_remetente_id    INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    remetente              VARCHAR(20) NOT NULL,   -- 'cliente' | 'ia' | 'colaboradora'
    corpo                  NVARCHAR(MAX) NOT NULL,
    baileys_message_id     VARCHAR(100) NULL,      -- só preenchido em mensagens recebidas ('cliente')
    lida                   BIT NOT NULL DEFAULT 0,
    criado_em              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );

  PRINT 'Tabela Mensagens criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela Mensagens já existe — nada a fazer.';
END
GO

-- Correção (reconstrução — ver aviso no topo do arquivo): se este banco já
-- tiver rodado uma versão anterior desta migration com uma UNIQUE CONSTRAINT
-- simples em (numero_remetente_id, baileys_message_id) em vez do índice
-- único FILTRADO abaixo, remove a constraint antiga primeiro. Motivo (ver
-- "Contexto e decisões de design" no contrato): uma UNIQUE CONSTRAINT simples
-- trata só UM NULL por combinação das demais colunas como válido, o que
-- bloqueava a 2ª mensagem nossa (`baileys_message_id = NULL`) para o mesmo
-- número remetente. Busca dinamicamente pelo nome real da constraint em vez
-- de presumir um nome fixo, já que o nome original não foi preservado.
DECLARE @nomeConstraintAntiga NVARCHAR(128);
SELECT @nomeConstraintAntiga = kc.name
FROM sys.key_constraints kc
JOIN sys.tables t ON t.object_id = kc.parent_object_id
WHERE t.name = 'Mensagens' AND kc.type = 'UQ';

IF @nomeConstraintAntiga IS NOT NULL
BEGIN
  DECLARE @sqlDropConstraint NVARCHAR(300) = N'ALTER TABLE Mensagens DROP CONSTRAINT ' + QUOTENAME(@nomeConstraintAntiga);
  EXEC sp_executesql @sqlDropConstraint;
  PRINT 'Constraint antiga ' + @nomeConstraintAntiga + ' removida.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'UQ_Mensagens_baileysId' AND object_id = OBJECT_ID('Mensagens')
)
BEGIN
  CREATE UNIQUE INDEX UQ_Mensagens_baileysId
  ON Mensagens (numero_remetente_id, baileys_message_id)
  WHERE baileys_message_id IS NOT NULL;

  PRINT 'Índice único filtrado UQ_Mensagens_baileysId criado com sucesso.';
END
ELSE
BEGIN
  PRINT 'Índice UQ_Mensagens_baileysId já existe — nada a fazer.';
END
GO
