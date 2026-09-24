export type ClientAccountDTO = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** false = conta só de login social (confirma a exclusão digitando o e-mail) */
  hasPassword: boolean;
};
