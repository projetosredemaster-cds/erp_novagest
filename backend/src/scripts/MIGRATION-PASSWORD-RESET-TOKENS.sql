-- Migration: cria a tabela PasswordResetTokens (recuperação de senha)
-- Ver CONTRATO-AUTH-API-RECUPERACAO-SENHA.md para o contrato completo
-- da API que consome esta tabela.
--
-- Token de uso único, válido por 1 hora, guardado só como hash SHA-256
-- (nunca em texto puro). Sem UNIQUE em usuario_id — um usuário pode ter
-- vários pedidos de recuperação em aberto.
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev)
-- antes de usar as rotas de /api/auth/esqueci-senha e
-- /api/auth/redefinir-senha. NÃO rode contra o Azure SQL de produção
-- sem confirmação explícita.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'PasswordResetTokens'
)
BEGIN
  CREATE TABLE PasswordResetTokens (
    id INT IDENTITY(1,1) PRIMARY KEY,
    usuario_id INT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expira_em DATETIME2 NOT NULL,
    usado BIT NOT NULL DEFAULT 0,
    criado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PasswordResetTokens_Usuarios FOREIGN KEY (usuario_id) REFERENCES Usuarios(id)
  );

  CREATE INDEX IX_PasswordResetTokens_TokenHash ON PasswordResetTokens (token_hash);

  PRINT 'Tabela PasswordResetTokens criada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Tabela PasswordResetTokens já existe — nada a fazer.';
END
