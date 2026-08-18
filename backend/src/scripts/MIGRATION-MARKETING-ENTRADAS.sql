-- Migration: cria a tabela MarketingEntradas (módulo Marketing)
-- Ver CONTRATO-MARKETING-API.md para o contrato completo da API que
-- consome esta tabela.
--
-- Granularidade: mensal, por Loja física (data_ref sempre dia 1 do mês).
-- v1 = só faturamento geral / marketing / retorno-indicação, sem
-- detalhamento por canal (fica para uma v2 futura, em tabela separada).
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev)
-- antes de usar as rotas de /api/marketing. NÃO rode contra o Azure SQL
-- de produção sem confirmação explícita.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'MarketingEntradas'
)
BEGIN
  CREATE TABLE MarketingEntradas (
    id INT IDENTITY(1,1) PRIMARY KEY,
    data_ref DATE NOT NULL,
    loja_id INT NOT NULL,
    faturamento_geral DECIMAL(18,2) NOT NULL DEFAULT 0,
    faturamento_marketing DECIMAL(18,2) NOT NULL DEFAULT 0,
    faturamento_retorno_indicacao DECIMAL(18,2) NOT NULL DEFAULT 0,
    atualizado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_MarketingEntradas_Lojas FOREIGN KEY (loja_id) REFERENCES Lojas(id),
    CONSTRAINT UQ_MarketingEntradas_Data_Loja UNIQUE (data_ref, loja_id),
    CONSTRAINT CK_MarketingEntradas_FaturamentoGeral CHECK (faturamento_geral >= 0),
    CONSTRAINT CK_MarketingEntradas_FaturamentoMarketing CHECK (faturamento_marketing >= 0),
    CONSTRAINT CK_MarketingEntradas_FaturamentoRetornoIndicacao CHECK (faturamento_retorno_indicacao >= 0)
  );

  PRINT 'Tabela MarketingEntradas criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela MarketingEntradas já existe — nada a fazer.';
END
