import { Injectable } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { parseSheet, phoneMatchKey, sheetKey, SheetAppointment } from './import-sheet';
import { PrismaService } from '../prisma/prisma.service';
import { TreatmentCategory } from '@prisma/client';
import { takesAppointments } from './staff-roles';

export type ShopImportResult = {
  customersCreated: number;
  customersReused: number;
  servicesCreated: number;
  servicesReused: number;
  appointmentsCreated: number;
  appointmentsSkipped: number;
  errors: string[];
};

function messageOf(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'não foi possível importar';
}

const EMPTY: ShopImportResult = {
  customersCreated: 0,
  customersReused: 0,
  servicesCreated: 0,
  servicesReused: 0,
  appointmentsCreated: 0,
  appointmentsSkipped: 0,
  errors: [],
};

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: BarbershopService,
  ) {}

  preview(userId: number, barbershopId: number, csv: string) {
    return this.run(userId, barbershopId, csv, false);
  }

  apply(userId: number, barbershopId: number, csv: string) {
    return this.run(userId, barbershopId, csv, true);
  }

  private async run(userId: number, barbershopId: number, csv: string, apply: boolean): Promise<ShopImportResult> {
    const shop = await this.shops.ensureAccess(userId, barbershopId, 'manager');
    const parsed = parseSheet(csv, shop.timezone);
    const result: ShopImportResult = { ...EMPTY, errors: [...parsed.errors] };
    const pushError = (message: string) => {
      if (result.errors.length < 30) result.errors.push(message);
    };

    const [customers, services, barbers] = await Promise.all([
      this.prisma.customer.findMany({
        where: { networkId: shop.networkId },
        select: { id: true, phone: true },
      }),
      this.prisma.barbershopService.findMany({
        where: { barbershopId, isActive: true },
        select: { id: true, name: true, durationMinutes: true, price: true },
      }),
      this.prisma.barber.findMany({
        where: { barbershopId, isActive: true },
        select: { id: true, name: true, staffType: true, takesAppointments: true },
      }),
    ]);
    const phones = new Map(customers.map((customer) => [phoneMatchKey(customer.phone), customer.id]));
    const catalog = new Map(
      services.map((service) => [
        sheetKey(service.name),
        { id: service.id, durationMinutes: service.durationMinutes, price: Number(service.price) },
      ]),
    );
    const bookable = barbers.filter((barber) => takesAppointments(barber));

    for (const row of parsed.customers) {
      if (phones.has(phoneMatchKey(row.phone))) {
        result.customersReused++;
        continue;
      }
      if (!apply) {
        phones.set(phoneMatchKey(row.phone), 0);
        result.customersCreated++;
        continue;
      }
      try {
        const created = await this.shops.createCustomer(userId, barbershopId, {
          name: row.name,
          phone: row.phone,
          email: row.email,
          notes: row.notes,
        });
        phones.set(phoneMatchKey(row.phone), created.id);
        result.customersCreated++;
      } catch (error) {
        pushError(`Linha ${row.line}: ${messageOf(error)}`);
      }
    }

    for (const row of parsed.appointments) {
      if (phones.has(phoneMatchKey(row.phone))) continue;
      if (!apply) {
        phones.set(phoneMatchKey(row.phone), 0);
        result.customersCreated++;
        continue;
      }
      try {
        const created = await this.shops.createCustomer(userId, barbershopId, {
          name: row.name,
          phone: row.phone,
        });
        phones.set(phoneMatchKey(row.phone), created.id);
        result.customersCreated++;
      } catch (error) {
        pushError(`Linha ${row.line}: ${messageOf(error)}`);
      }
    }

    const needed = new Map<string, { line: number; name: string; durationMinutes: number; price: number }>();
    for (const row of parsed.services) needed.set(sheetKey(row.name), row);
    for (const row of parsed.appointments) {
      const key = sheetKey(row.serviceName);
      if (!catalog.has(key) && !needed.has(key)) {
        needed.set(key, {
          line: row.line,
          name: row.serviceName,
          durationMinutes: row.durationMinutes,
          price: row.price,
        });
      }
    }
    for (const [key, row] of needed) {
      const current = catalog.get(key);
      if (current?.id) {
        result.servicesReused++;
        continue;
      }
      if (!apply) {
        catalog.set(key, { id: 0, durationMinutes: row.durationMinutes, price: row.price });
        result.servicesCreated++;
        continue;
      }
      try {
        const created = await this.shops.createService(userId, barbershopId, {
          name: row.name,
          durationMinutes: row.durationMinutes,
          price: row.price,
          category: TreatmentCategory.OTHER,
        });
        catalog.set(key, { id: created.id, durationMinutes: created.durationMinutes, price: Number(created.price) });
        result.servicesCreated++;
      } catch (error) {
        pushError(`Linha ${row.line}: ${messageOf(error)}`);
      }
    }

    for (const row of parsed.appointments) {
      const outcome = await this.importAppointment(userId, barbershopId, row, phones, catalog, bookable, apply);
      if (outcome === 'created') result.appointmentsCreated++;
      else {
        result.appointmentsSkipped++;
        pushError(outcome);
      }
    }
    return result;
  }

  private async importAppointment(
    userId: number,
    barbershopId: number,
    row: SheetAppointment,
    phones: Map<string, number>,
    catalog: Map<string, { id: number; durationMinutes: number; price: number }>,
    bookable: Array<{ id: number; name: string }>,
    apply: boolean,
  ): Promise<'created' | string> {
    const customerId = phones.get(phoneMatchKey(row.phone));
    if (!customerId && customerId !== 0) return `Linha ${row.line}: cliente sem telefone conhecido.`;
    const service = catalog.get(sheetKey(row.serviceName));
    if (!service) return `Linha ${row.line}: serviço "${row.serviceName}" não encontrado.`;
    const barber = this.matchBarber(row.barberName, bookable);
    if (!barber) {
      return bookable.length > 1
        ? `Linha ${row.line}: informe o profissional.`
        : `Linha ${row.line}: não há profissional para este horário.`;
    }
    if (!apply || customerId === 0 || service.id === 0) return 'created';
    try {
      await this.shops.createAppointment(
        userId,
        barbershopId,
        {
          customerId,
          barberId: barber.id,
          startAt: row.start,
          endAt: new Date(row.start.getTime() + row.durationMinutes * 60_000),
          status: row.status,
          source: row.source,
          services: [{ serviceId: service.id, quantity: 1, unitPrice: row.price || service.price }],
        },
        { notify: false },
      );
      return 'created';
    } catch (error) {
      return `Linha ${row.line}: ${messageOf(error)}`;
    }
  }

  private matchBarber(name: string | undefined, bookable: Array<{ id: number; name: string }>) {
    if (bookable.length === 0) return null;
    if (!name) return bookable.length === 1 ? bookable[0] : null;
    const wanted = sheetKey(name);
    return (
      bookable.find((barber) => {
        const current = sheetKey(barber.name);
        return current.includes(wanted) || wanted.includes(current);
      }) ?? null
    );
  }
}
