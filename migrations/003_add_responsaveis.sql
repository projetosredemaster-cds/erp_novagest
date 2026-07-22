-- migrations/003_add_responsaveis.sql
--
-- Objetivo: transformar o campo `Redes.responsavel` (texto livre) em uma
-- entidade própria `Responsaveis`, com atribuição N:1 (vários responsáveis
-- cadastrados, cada rede aponta para no máximo 1 responsável via FK).
--
-- IMPORTANTE: este script NAO remove a coluna antiga `Redes.responsavel`.
-- Ela é mantida propositalmente como histórico até uma limpeza futura (uma
-- migration separada, só depois que o código novo estiver validado
-- end-to-end em produção). A partir desta migração, o código da aplicação
-- deve ler/escrever exclusivamente `Redes.responsavel_id` — não crie
-- dependência de leitura na coluna antiga em código novo.
--
-- Idempotente onde razoável (IF NOT EXISTS / NOT EXISTS), para permitir
-- reexecução segura em caso de execução parcial.

-- 1. Tabela Responsaveis
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Responsaveis')
BEGIN
    CREATE TABLE Responsaveis (
        id INT IDENTITY PRIMARY KEY,
        nome NVARCHAR(150) NOT NULL UNIQUE,
        criado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 2. Popula Responsaveis com os valores DISTINCT e não vazios/não nulos já
-- existentes em Redes.responsavel (trim, ignora string vazia/NULL).
-- NOT EXISTS evita duplicar em reexecuções.
INSERT INTO Responsaveis (nome)
SELECT DISTINCT LTRIM(RTRIM(r.responsavel))
FROM Redes r
WHERE r.responsavel IS NOT NULL
  AND LTRIM(RTRIM(r.responsavel)) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM Responsaveis resp
      WHERE resp.nome = LTRIM(RTRIM(r.responsavel))
  );
GO

-- 3. Coluna responsavel_id em Redes + FK para Responsaveis
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Redes') AND name = 'responsavel_id'
)
BEGIN
    ALTER TABLE Redes ADD responsavel_id INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Redes_Responsaveis'
)
BEGIN
    ALTER TABLE Redes
    ADD CONSTRAINT FK_Redes_Responsaveis
    FOREIGN KEY (responsavel_id) REFERENCES Responsaveis(id);
END
GO

-- 4. Preenche Redes.responsavel_id casando pelo nome (trim) com
-- Responsaveis.nome. Só atualiza linhas ainda não migradas
-- (responsavel_id IS NULL), para reexecução segura.
UPDATE r
SET r.responsavel_id = resp.id
FROM Redes r
INNER JOIN Responsaveis resp
    ON LTRIM(RTRIM(r.responsavel)) = resp.nome
WHERE r.responsavel IS NOT NULL
  AND LTRIM(RTRIM(r.responsavel)) <> ''
  AND r.responsavel_id IS NULL;
GO
