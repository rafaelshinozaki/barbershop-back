import { TreatmentCategory } from '@prisma/client';
import {
  acceptsNewClient,
  canViewProfile,
  isIndexable,
  parseProfessionalSignup,
  parseProfilePatch,
  presentPublicProfile,
  ProfilePrivacyError,
} from './profile-privacy';

const shop = { name: 'Casa', slug: 'casa' };

describe('cadastro de profissional', () => {
  it('exige um papel', () => {
    expect(() => parseProfessionalSignup({ roles: [] })).toThrow(ProfilePrivacyError);
    expect(parseProfessionalSignup({ roles: ['barber', 'barber', 'reception'] }).roles).toEqual([
      'barber',
      'reception',
    ]);
  });

  it('disponível para contratação pede vínculo e cargo', () => {
    expect(() => parseProfessionalSignup({ roles: ['manager'], openToWork: true })).toThrow(
      ProfilePrivacyError,
    );
    expect(
      parseProfessionalSignup({
        roles: ['manager'],
        openToWork: true,
        engagements: ['freelance'],
        acceptedRoles: ['manager'],
        cities: [' Campinas ', 'campinas'],
        specialties: [TreatmentCategory.HAIR],
      }),
    ).toMatchObject({
      openToWork: true,
      cities: ['Campinas'],
      specialties: [TreatmentCategory.HAIR],
    });
  });
});

describe('privacidade do perfil', () => {
  it('só o público entra no sitemap', () => {
    expect(canViewProfile('public', null)).toBe(true);
    expect(canViewProfile('platform', null)).toBe(false);
    expect(canViewProfile('platform', 4)).toBe(true);
    expect(canViewProfile('hidden', 4)).toBe(false);
    expect(isIndexable('public')).toBe(true);
    expect(isIndexable('platform')).toBe(false);
  });

  it('fechar para clientes novos deixa passar quem já teve horário', () => {
    expect(acceptsNewClient(true, 0)).toBe(true);
    expect(acceptsNewClient(false, 0)).toBe(false);
    expect(acceptsNewClient(false, 2)).toBe(true);
  });

  it('desligar a contratação limpa vínculo e cargo', () => {
    expect(parseProfilePatch({ openToWork: false, engagements: ['fixed'] })).toMatchObject({
      openToWork: false,
      engagements: [],
      acceptedRoles: [],
    });
  });

  it('campo a campo: contato some, o estabelecimento de que é dono fica', () => {
    expect(
      presentPublicProfile({
        fullName: 'Ana',
        photoKey: 'users/1.jpg',
        phone: '+5511999999999',
        email: 'ana@example.com',
        completedAppointments: 12,
        worksAt: [shop],
        workedAt: [{ name: 'Antiga', slug: 'antiga' }],
        owns: [shop],
        choices: {
          visibility: 'public',
          showPhoto: false,
          showAppointmentCount: false,
          showWorkHistory: false,
          showLocations: true,
          showContact: false,
        },
      }),
    ).toEqual({
      fullName: 'Ana',
      visibility: 'public',
      photoKey: null,
      phone: null,
      email: null,
      completedAppointments: null,
      worksAt: [shop],
      workedAt: [],
      owns: [shop],
    });
  });
});
