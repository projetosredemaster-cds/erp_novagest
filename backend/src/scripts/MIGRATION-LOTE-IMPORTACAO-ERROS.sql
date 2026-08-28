-- Migration: cria a tabela LoteImportacaoErros (Importação v3)
-- Ver CONTRATO-CONTROLE-LIGACOES-API.md, seção "Importação (v3)" para o
-- contrato completo da API que consome esta tabela.
--
-- A partir da v3, a escolha de número remetente por Estado deixou de
-- acontecer na importação (isso agora é feito no Painel de Disparo, no
-- momento do disparo). A importação passou a gravar, linha a linha, todo
-- registro rejeitado por erro de formato ou por telefone duplicado — antes
-- essa informação só existia como contagem agregada
-- (LotesImportacao.total_erro/total_duplicado), sem detalhe por linha.
--
-- `lote_importacao_id` referencia o lote que gerou o erro; `contato_existente_id`
-- (nullable) referencia o Contato já existente quando tipo = 'duplicado' — fica
-- NULL quando a duplicata é dentro do próprio arquivo (2ª ocorrência de um
-- telefone no mesmo upload), porque a 1ª ocorrência só ganha um Contatos.id
-- ao final da mesma transação de importação (limitação documentada no
-- contrato, não um bug).
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev)
-- antes de usar a rota POST /api/controle-ligacoes/contatos/importar (v3) e
-- GET /api/controle-ligacoes/contatos/importar/:loteId. NÃO rode contra o
-- Azure SQL de produção sem confirmação explícita.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'LoteImportacaoErros'
)
BEGIN
  CREATE TABLE LoteImportacaoErros (
      id                     INT IDENTITY(1,1) PRIMARY KEY,
      lote_importacao_id     INT NOT NULL FOREIGN KEY REFERENCES LotesImportacao(id),
      linha                  INT NULL,
      tipo                   VARCHAR(20) NOT NULL,
      nome_planilha          NVARCHAR(150) NULL,
      contato_planilha       VARCHAR(30) NULL,
      motivo                 NVARCHAR(255) NOT NULL,
      contato_existente_id   INT NULL FOREIGN KEY REFERENCES Contatos(id),
      criado_em              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_LoteImportacaoErros_LoteImportacaoId ON LoteImportacaoErros (lote_importacao_id);

  PRINT 'Tabela LoteImportacaoErros criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela LoteImportacaoErros já existe — nada a fazer.';
END
GO
