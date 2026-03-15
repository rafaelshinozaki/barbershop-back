// src\auth\users\models\address.schema.ts
export class AddressSchema {
  zipcode: string;
  street: string;
  city: string;
  neighborhood: string;
  state: string;
  country: string;
  complement1?: string;
  complement2?: string;
}
