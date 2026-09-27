import { TreatmentCategory } from '@prisma/client';

/** hidden: a página não existe para os outros. platform: só conta logada. public: busca e sitemap. */
export const PROFILE_VISIBILITIES = ['hidden', 'platform', 'public'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/** Papel que a pessoa oferece. O cargo em cada unidade continua no vínculo. */
export const PROFILE_ROLES = ['barber', 'manager', 'reception'] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const WORK_ENGAGEMENTS = ['fixed', 'freelance', 'chair_rent'] as const;
export type WorkEngagement = (typeof WORK_ENGAGEMENTS)[number];

const CATEGORIES = new Set<string>(Object.values(TreatmentCategory));

export class ProfilePrivacyError extends Error {}

export type ProfileChoices = {
  visibility: ProfileVisibility;
  roles: ProfileRole[];
  specialties: TreatmentCategory[];
  cities: string[];
  openToWork: boolean;
  engagements: WorkEngagement[];
  acceptedRoles: ProfileRole[];
  acceptingClients: boolean;
  showPhoto: boolean;
  showRating: boolean;
  showAppointmentCount: boolean;
  showReviews: boolean;
  showWorkHistory: boolean;
  showLocations: boolean;
  showContact: boolean;
};

export type ProfileChoicePatch = Partial<ProfileChoices>;

type SignupInput = {
  roles?: string[] | null;
  specialties?: string[] | null;
  cities?: string[] | null;
  openToWork?: boolean | null;
  engagements?: string[] | null;
  acceptedRoles?: string[] | null;
};

export type PublicShopLink = { name: string; slug: string };

function unique<T extends string>(
  values: readonly string[] | null | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  const out: T[] = [];
  for (const value of values ?? []) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new ProfilePrivacyError(`${label} inválido`);
    }
    const picked = value as T;
    if (!out.includes(picked)) out.push(picked);
  }
  return out;
}

function parseCities(values?: string[] | null): string[] {
  const out: string[] = [];
  for (const raw of values ?? []) {
    const city = raw.trim().replace(/\s+/g, ' ');
    if (!city) continue;
    if (city.length > 80) throw new ProfilePrivacyError('Cidade longa demais');
    if (!out.some((item) => item.toLowerCase() === city.toLowerCase())) out.push(city);
    if (out.length > 20) throw new ProfilePrivacyError('No máximo 20 cidades');
  }
  return out;
}

function parseSpecialties(values?: string[] | null): TreatmentCategory[] {
  const out: TreatmentCategory[] = [];
  for (const value of values ?? []) {
    if (!CATEGORIES.has(value)) throw new ProfilePrivacyError('Especialidade inválida');
    const category = value as TreatmentCategory;
    if (!out.includes(category)) out.push(category);
  }
  return out;
}

/** Cadastro de profissional: pelo menos um papel. Domicílio fica para o horizonte 5. */
export function parseProfessionalSignup(input: SignupInput | null | undefined) {
  const roles = unique(input?.roles, PROFILE_ROLES, 'Papel');
  if (roles.length === 0) throw new ProfilePrivacyError('Escolha pelo menos um papel');
  const openToWork = input?.openToWork === true;
  const engagements = openToWork
    ? unique(input?.engagements, WORK_ENGAGEMENTS, 'Tipo de vínculo')
    : [];
  const acceptedRoles = openToWork ? unique(input?.acceptedRoles, PROFILE_ROLES, 'Cargo') : [];
  if (openToWork && engagements.length === 0) {
    throw new ProfilePrivacyError('Escolha o tipo de vínculo');
  }
  if (openToWork && acceptedRoles.length === 0) {
    throw new ProfilePrivacyError('Escolha os cargos que aceita');
  }
  return {
    roles,
    specialties: parseSpecialties(input?.specialties),
    cities: parseCities(input?.cities),
    openToWork,
    engagements,
    acceptedRoles,
  };
}

/** Atualização parcial. Campo ausente não mexe no que já está salvo. */
export function parseProfilePatch(input: {
  visibility?: string | null;
  roles?: string[] | null;
  specialties?: string[] | null;
  cities?: string[] | null;
  openToWork?: boolean | null;
  engagements?: string[] | null;
  acceptedRoles?: string[] | null;
  acceptingClients?: boolean | null;
  showPhoto?: boolean | null;
  showRating?: boolean | null;
  showAppointmentCount?: boolean | null;
  showReviews?: boolean | null;
  showWorkHistory?: boolean | null;
  showLocations?: boolean | null;
  showContact?: boolean | null;
}): ProfileChoicePatch {
  const patch: ProfileChoicePatch = {};
  if (input.visibility != null) {
    if (!(PROFILE_VISIBILITIES as readonly string[]).includes(input.visibility)) {
      throw new ProfilePrivacyError('Visibilidade inválida');
    }
    patch.visibility = input.visibility as ProfileVisibility;
  }
  if (input.roles != null) {
    const roles = unique(input.roles, PROFILE_ROLES, 'Papel');
    if (roles.length === 0) throw new ProfilePrivacyError('Escolha pelo menos um papel');
    patch.roles = roles;
  }
  if (input.specialties != null) patch.specialties = parseSpecialties(input.specialties);
  if (input.cities != null) patch.cities = parseCities(input.cities);
  if (input.openToWork != null) patch.openToWork = input.openToWork;
  if (input.engagements != null)
    patch.engagements = unique(input.engagements, WORK_ENGAGEMENTS, 'Tipo de vínculo');
  if (input.acceptedRoles != null)
    patch.acceptedRoles = unique(input.acceptedRoles, PROFILE_ROLES, 'Cargo');
  if (patch.openToWork === false) {
    patch.engagements = [];
    patch.acceptedRoles = [];
  }
  if (patch.openToWork === true && patch.engagements && patch.engagements.length === 0) {
    throw new ProfilePrivacyError('Escolha o tipo de vínculo');
  }
  if (patch.openToWork === true && patch.acceptedRoles && patch.acceptedRoles.length === 0) {
    throw new ProfilePrivacyError('Escolha os cargos que aceita');
  }
  if (input.acceptingClients != null) patch.acceptingClients = input.acceptingClients;
  if (input.showPhoto != null) patch.showPhoto = input.showPhoto;
  if (input.showRating != null) patch.showRating = input.showRating;
  if (input.showAppointmentCount != null) patch.showAppointmentCount = input.showAppointmentCount;
  if (input.showReviews != null) patch.showReviews = input.showReviews;
  if (input.showWorkHistory != null) patch.showWorkHistory = input.showWorkHistory;
  if (input.showLocations != null) patch.showLocations = input.showLocations;
  if (input.showContact != null) patch.showContact = input.showContact;
  return patch;
}

/** Conta de cliente ainda é outro login: "na plataforma" vale para quem entrou como equipe. */
export function canViewProfile(
  visibility: ProfileVisibility,
  viewerUserId?: number | null,
): boolean {
  if (visibility === 'public') return true;
  if (visibility === 'platform') return viewerUserId != null;
  return false;
}

export function isIndexable(visibility: ProfileVisibility): boolean {
  return visibility === 'public';
}

/** Agenda fechada para gente nova. Quem já teve horário com a pessoa continua. */
export function acceptsNewClient(acceptingClients: boolean, priorAppointments: number): boolean {
  return acceptingClients || priorAppointments > 0;
}

/** O que a página mostra. Esconder não apaga: só tira do que sai. */
export function presentPublicProfile<T extends PublicShopLink>(source: {
  fullName: string;
  photoKey: string | null;
  phone: string | null;
  email: string | null;
  completedAppointments: number;
  worksAt: T[];
  workedAt: T[];
  owns: T[];
  choices: Pick<
    ProfileChoices,
    | 'visibility'
    | 'showPhoto'
    | 'showAppointmentCount'
    | 'showWorkHistory'
    | 'showLocations'
    | 'showContact'
  >;
}) {
  const { choices } = source;
  return {
    fullName: source.fullName,
    visibility: choices.visibility,
    photoKey: choices.showPhoto ? source.photoKey : null,
    phone: choices.showContact ? source.phone : null,
    email: choices.showContact ? source.email : null,
    completedAppointments: choices.showAppointmentCount ? source.completedAppointments : null,
    worksAt: choices.showLocations ? source.worksAt : [],
    workedAt: choices.showWorkHistory ? source.workedAt : [],
    owns: source.owns,
  };
}
