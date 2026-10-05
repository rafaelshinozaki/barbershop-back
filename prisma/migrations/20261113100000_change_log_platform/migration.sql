-- Histórico (R3): tabelas que a equipe da plataforma altera e que não são
-- de uma unidade (conta, conta de cliente, perfil profissional, suporte e
-- denúncia). Escopo vazio: sem barbershopId/networkId, então não aparecem
-- no Histórico do dono; o registro de ações do backoffice liga a ação a
-- estas linhas pelo id do request.

CREATE TRIGGER change_log_user AFTER INSERT OR UPDATE OR DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('User', 'none', 'fullName',
  'fullName,email,phone,isActive,roleId,membership,proUntil,twoFactorEnabled,identityVerifiedAt,deleted_at',
  'email,phone', '');

CREATE TRIGGER change_log_client_account AFTER INSERT OR UPDATE OR DELETE ON "ClientAccount"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('ClientAccount', 'none', 'name',
  'name,email,phone,suspendedAt,suspendedReason,deletedAt',
  'email,phone', '');

CREATE TRIGGER change_log_professional AFTER INSERT OR UPDATE OR DELETE ON "Professional"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Professional', 'none', 'slug',
  'slug,isPublic,visibility,suspendedAt,featuredUntil',
  '', '');

CREATE TRIGGER change_log_support_ticket AFTER INSERT OR UPDATE OR DELETE ON "SupportTicket"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('SupportTicket', 'none', 'subject',
  'status,closedAt',
  '', '');

CREATE TRIGGER change_log_content_report AFTER INSERT OR UPDATE OR DELETE ON "ContentReport"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('ContentReport', 'none', 'targetType',
  'status,resolvedAt',
  '', '');
