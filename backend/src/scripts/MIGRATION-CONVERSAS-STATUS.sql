IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'ConversasStatus'
)
BEGIN
  CREATE TABLE ConversasStatus (
    id INT IDENTITY(1,1) PRIMARY KEY,
    contato_id INT NOT NULL FOREIGN KEY REFERENCES Contatos(id),
    numero_remetente_id INT NOT NULL FOREIGN KEY REFERENCES NumerosRemetentes(id),
    status VARCHAR(20) NOT NULL,
    atualizado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_ConversasStatus_Thread UNIQUE (contato_id, numero_remetente_id)
  );
  PRINT 'Tabela ConversasStatus criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela ConversasStatus já existe — nada a fazer.';
END
GO
