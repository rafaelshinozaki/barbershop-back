-- A lista negra de JWT não era lida: a estratégia não recebia o request.
-- Quem revoga a sessão é a ActiveSession.
DROP TABLE "InvalidatedToken";
