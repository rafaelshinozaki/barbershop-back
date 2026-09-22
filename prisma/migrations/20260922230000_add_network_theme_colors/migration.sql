-- Cores do app por franquia (definidas pelo dono, herdadas pela equipe).
-- null = padrão do app.
ALTER TABLE "Network" ADD COLUMN IF NOT EXISTS "accentColor" TEXT,
ADD COLUMN IF NOT EXISTS "grayColor" TEXT;
