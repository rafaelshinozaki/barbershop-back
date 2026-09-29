import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../auth/interfaces/roles';
import { BACKOFFICE_AREAS } from '../auth/backoffice-areas';

/**
 * Equipe do sistema: o admin (mestre) libera áreas do backoffice para cada
 * SystemManager. Quem vira SystemManager começa sem área nenhuma.
 */
@Injectable()
export class BackofficeTeamService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins e equipe do sistema, com as áreas de cada um. */
  async team() {
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        role: { name: { in: [Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER] } },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        twoFactorEnabled: true,
        backofficeAreas: true,
        role: { select: { name: true } },
      },
      orderBy: [{ fullName: 'asc' }],
    });
    return users.map((u) => ({
      ...u,
      role: u.role.name,
      // O admin vê tudo; a lista mostra isso em vez de um array vazio
      backofficeAreas:
        u.role.name === Role.SYSTEM_ADMIN ? [...BACKOFFICE_AREAS] : u.backofficeAreas,
    }));
  }

  async setAreas(userId: number, areas: string[]) {
    const invalid = areas.filter((a) => !BACKOFFICE_AREAS.includes(a));
    if (invalid.length) {
      throw new BadRequestException(`Área desconhecida: ${invalid.join(', ')}`);
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      select: { role: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role.name !== Role.SYSTEM_MANAGER) {
      throw new BadRequestException('Áreas só valem para a equipe do sistema (SystemManager).');
    }
    // Na ordem da lista, sem repetir
    const next = BACKOFFICE_AREAS.filter((a) => areas.includes(a));
    await this.prisma.user.update({ where: { id: userId }, data: { backofficeAreas: next } });
    return next;
  }
}
