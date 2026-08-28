-- Migration: coluna `e_primeira_resposta_cliente` em Mensagens — contador do
-- sino de notificações do Controle de Ligações (Central de Mensagens, v7).
--
-- Propósito: marcar, em `Mensagens`, a mensagem que representa a PRIMEIRA
-- resposta de um contato desde sempre (o momento de handoff IA→humano) —
-- não "primeira do dia" nem "primeira de uma sessão/janela de tempo". O sino
-- de notificações do frontend conta quantas dessas mensagens ainda estão
-- `lida = 0` (ver `mensagens.model.js: contarNotificacoesNaoVistas` e
-- `GET /api/controle-ligacoes/notificacoes`), em vez de notificar a cada
-- mensagem nova recebida.
--
-- Idempotente (IF NOT EXISTS via sys.columns), mesmo padrão de
-- MIGRATION-ENVIO-DISPAROS.sql/MIGRATION-DISPAROS.sql.
--
-- Rode este script contra o banco de destino (local: erp-novagest-dev) antes
-- de usar as rotas/lógica que dependem desta coluna (listener
-- `messages.upsert` em `baileysSession.service.js` e
-- `GET /api/controle-ligacoes/notificacoes`). NÃO rode contra o Azure SQL de
-- produção sem confirmação explícita. Pré-requisito: `MIGRATION-MENSAGENS.sql`
-- já deve ter rodado (a tabela `Mensagens` precisa existir).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('Mensagens') AND name = 'e_primeira_resposta_cliente'
)
BEGIN
  ALTER TABLE Mensagens ADD e_primeira_resposta_cliente BIT NOT NULL DEFAULT 0;
  PRINT 'Coluna Mensagens.e_primeira_resposta_cliente adicionada com sucesso.';
END
ELSE
BEGIN
  PRINT 'Coluna Mensagens.e_primeira_resposta_cliente já existe — nada a fazer.';
END
GO
