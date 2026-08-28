IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('Mensagens') AND name = 'status_entrega'
)
BEGIN
  ALTER TABLE Mensagens ADD status_entrega VARCHAR(20) NULL;
  PRINT 'Coluna Mensagens.status_entrega adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna Mensagens.status_entrega já existe — nada a fazer.';
END
GO
