-- País da unidade sempre como código ISO de duas letras (item 267). Unidade
-- gravada com o nome ("Brasil") ficava sem WhatsApp (DDI desconhecido) e com
-- os e-mails em inglês. Os nomes que o cadastro aceitava viram o código.
UPDATE "Barbershop" SET country = CASE lower(trim(country))
    WHEN 'brasil' THEN 'BR'
    WHEN 'brazil' THEN 'BR'
    WHEN 'portugal' THEN 'PT'
    WHEN 'mexico' THEN 'MX'
    WHEN 'méxico' THEN 'MX'
    WHEN 'espanha' THEN 'ES'
    WHEN 'spain' THEN 'ES'
    WHEN 'españa' THEN 'ES'
    WHEN 'argentina' THEN 'AR'
    WHEN 'colombia' THEN 'CO'
    WHEN 'colômbia' THEN 'CO'
    WHEN 'eua' THEN 'US'
    WHEN 'estados unidos' THEN 'US'
    WHEN 'united states' THEN 'US'
    WHEN 'chile' THEN 'CL'
    WHEN 'peru' THEN 'PE'
    WHEN 'uruguay' THEN 'UY'
    WHEN 'uruguai' THEN 'UY'
    WHEN 'paraguay' THEN 'PY'
    WHEN 'paraguai' THEN 'PY'
    ELSE country
  END
  WHERE lower(trim(country)) IN (
    'brasil', 'brazil', 'portugal', 'mexico', 'méxico', 'espanha', 'spain', 'españa',
    'argentina', 'colombia', 'colômbia', 'eua', 'estados unidos', 'united states',
    'chile', 'peru', 'uruguay', 'uruguai', 'paraguay', 'paraguai');

-- Código em minúsculas ou com espaço ("br ")
UPDATE "Barbershop" SET country = upper(trim(country))
  WHERE trim(country) ~ '^[A-Za-z]{2}$' AND country <> upper(trim(country));
