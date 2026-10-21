import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';

const ANSWERS = JSON.stringify({ alergias: 'Amônia' });

describe('ficha de saúde', () => {
  function build(level: string, hasAppointment: boolean) {
    const updates: { id: number; data: Record<string, unknown> }[] = [];
    const deleted: number[] = [];
    let appointmentWhere: { barberId?: number; customerId?: number; status?: unknown } | null =
      null;
    const forms = [
      {
        id: 1,
        barbershopId: 10,
        customerId: 4,
        formType: 'ANAMNESIS',
        answers: ANSWERS,
        status: 'SIGNED',
        signedAt: new Date('2026-10-01'),
        expiresAt: null,
        healthConsentAt: new Date('2026-10-01'),
        healthConsentRevokedAt: null,
      },
      {
        id: 2,
        barbershopId: 10,
        customerId: 4,
        formType: 'PHOTO_CONSENT',
        answers: '{"usarFotos":true}',
        status: 'PENDING',
        signedAt: null,
        expiresAt: null,
        healthConsentAt: null,
        healthConsentRevokedAt: null,
      },
    ];
    const prisma = {
      consentForm: {
        findMany: async () => forms,
        findFirst: async ({ where }: { where: { id: number } }) =>
          forms.find((form) => form.id === where.id) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          return { ...forms.find((form) => form.id === where.id), ...data };
        },
        delete: async ({ where }: { where: { id: number } }) => {
          deleted.push(where.id);
        },
        create: async ({ data }: { data: Record<string, unknown> }) => data,
      },
      customer: { findFirst: async () => ({ id: 4 }) },
      appointment: {
        findFirst: async ({ where }: { where: typeof appointmentWhere }) => {
          appointmentWhere = where;
          return hasAppointment ? { id: 9 } : null;
        },
      },
    };
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma,
      ensureBarbershopAccess: async () => ({ id: 10, accessLevel: level }),
      ensureModuleAccess: async () => undefined,
      ownBarberIdIfBarber: async () => (level === 'barber' || level === 'basic' ? 7 : null),
    });
    return { service, updates, deleted, forms, appointmentWhere: () => appointmentWhere };
  }

  it('barbeiro sem horário com o cliente não lê a ficha de saúde dele', async () => {
    const { service, appointmentWhere } = build('barber', false);
    const forms = await service.getConsentForms(3, 10, 4);
    expect(forms.map((form) => form.formType)).toEqual(['PHOTO_CONSENT']);
    expect(JSON.stringify(forms)).not.toContain('Amônia');
    expect(appointmentWhere()).toMatchObject({
      barberId: 7,
      customerId: 4,
      status: { not: 'CANCELLED' },
    });
  });

  it('barbeiro com horário recente lê as respostas', async () => {
    const { service } = build('barber', true);
    const forms = await service.getConsentForms(3, 10, 4);
    expect(forms.find((form) => form.formType === 'ANAMNESIS')?.answers).toBe(ANSWERS);
  });

  it('recepção vê que a ficha existe e se está assinada, sem as respostas', async () => {
    const { service } = build('reception', false);
    const forms = await service.getConsentForms(3, 10, 4);
    const health = forms.find((form) => form.formType === 'ANAMNESIS');
    expect(health).toMatchObject({ status: 'SIGNED', answers: null });
    expect(forms.find((form) => form.formType === 'PHOTO_CONSENT')?.answers).toContain('usarFotos');
  });

  it('não assina de novo nem ficha com consentimento revogado', async () => {
    const signed = build('manager', false);
    await expect(signed.service.signConsentForm(1, 10, 1, 'Ana')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const revoked = build('manager', false);
    Object.assign(revoked.forms[1], {
      healthConsentRevokedAt: new Date(),
      formType: 'ANAMNESIS',
    });
    await expect(revoked.service.signConsentForm(1, 10, 2, 'Ana')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('ficha assinada é arquivada e a pendente ainda pode ser excluída', async () => {
    const { service, updates, deleted } = build('manager', false);
    await expect(service.deleteConsentForm(1, 10, 1)).resolves.toBe(true);
    expect(updates).toEqual([{ id: 1, data: { status: 'ARCHIVED' } }]);
    expect(deleted).toEqual([]);
    await expect(service.deleteConsentForm(1, 10, 2)).resolves.toBe(true);
    expect(deleted).toEqual([2]);
  });

  it('barbeiro sem horário não grava respostas de saúde', async () => {
    const { service } = build('barber', false);
    await expect(
      service.createConsentForm(3, 10, {
        customerId: 4,
        formType: 'ANAMNESIS',
        answers: ANSWERS,
        healthConsent: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
