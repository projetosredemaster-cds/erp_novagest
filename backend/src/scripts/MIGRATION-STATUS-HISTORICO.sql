IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'StatusHistorico'
)
BEGIN
  CREATE TABLE StatusHistorico (
    id INT IDENTITY(1,1) PRIMARY KEY,
    contato_id INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    numero_remetente_id INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    status_anterior VARCHAR(20) NULL,
    status_novo VARCHAR(20) NOT NULL,
    origem VARCHAR(20) NOT NULL,
    motivo VARCHAR(30) NULL,
    motivo_detalhe NVARCHAR(255) NULL,
    alterado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  PRINT 'Tabela StatusHistorico criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela StatusHistorico já existe — nada a fazer.';
END
GO
