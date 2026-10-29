import * as Joi from 'joi';

/** Em produção o endereço do site é obrigatório: e-mail com link pra localhost não sai. */
export const frontendUrlSchema = Joi.string()
  .uri()
  .when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().uri().default('http://localhost:5173'),
  });
