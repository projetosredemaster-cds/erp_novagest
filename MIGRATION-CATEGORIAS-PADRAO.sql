-- Rode no banco LOCAL (erp-novagest-dev). Adiciona os campos que faltam
-- pra Categorias ter CRUD real com proteção das 3 categorias padrão.

ALTER TABLE Categorias ADD padrao BIT NOT NULL DEFAULT 0;
ALTER TABLE Categorias ADD visivel BIT NOT NULL DEFAULT 1;

UPDATE Categorias SET padrao = 1 WHERE nome IN ('Receita Bruta', 'Correção', 'Acessórios');

-- Confirma
SELECT id, nome, principal, padrao, visivel FROM Categorias ORDER BY id;
