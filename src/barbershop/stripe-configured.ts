/** Chave do Stripe configurada de verdade (não o exemplo do .env.example) */
export function stripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return key.startsWith('sk_') && !key.includes('sua_chave');
}
