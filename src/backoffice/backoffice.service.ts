import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmartLogger } from '../common/logger.util';
import { EmailService } from '../email/email.service';
import { PAGAMENTO_STATUS } from '../common/contants';

const ROLE_NAME_TO_ENUM: Record<string, string> = {
  SystemAdmin: 'SYSTEM_ADMIN',
  SystemManager: 'SYSTEM_MANAGER',
  BarbershopOwner: 'BARBERSHOP_OWNER',
  BarbershopManager: 'BARBERSHOP_MANAGER',
  BarbershopEmployee: 'BARBERSHOP_EMPLOYEE',
};

@Injectable()
export class BackofficeService {
  private readonly logger = new SmartLogger('BackofficeService');

  constructor(private prisma: PrismaService, private emailService: EmailService) {}

  // Roles vindas de dados corrompidos/nulos caem no `fallback` em vez de quebrar o gráfico/enum
  private mapRoleNameToEnum(roleName: string | undefined | null, fallback: string): string {
    const mapped = roleName ? ROLE_NAME_TO_ENUM[roleName] : undefined;
    if (mapped) return mapped;
    this.logger.warn(`Unrecognized or missing role name "${roleName}", defaulting to ${fallback}`);
    return fallback;
  }

  async getStats() {
    const [totalUsers, activeUsers, newUsersThisMonth, totalRevenue] = await Promise.all([
      this.getTotalUsers(),
      this.getActiveUsers(),
      this.getNewUsersThisMonth(),
      this.getTotalRevenue(),
    ]);

    return {
      totalUsers,
      activeUsers,
      newUsersThisMonth,
      revenue: totalRevenue,
    };
  }

  async getUserGrowth() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    let users: any[] = [];
    try {
      users = await this.prisma.user.findMany({
        where: {
          createdAt: {
            gte: sixMonthsAgo,
          },
        },
        select: {
          createdAt: true,
        },
      });
    } catch (e) {
      this.logger.error('Error fetching users for growth chart:', e);
    }

    // Agrupar por mês
    const monthlyStats = new Map();
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    if (users && Array.isArray(users)) {
      users.forEach((item) => {
        const month = months[item.createdAt.getMonth()];
        const year = item.createdAt.getFullYear();
        const key = `${month} ${year}`;
        monthlyStats.set(key, (monthlyStats.get(key) || 0) + 1);
      });
    }

    // Pegar os últimos 6 meses
    const monthlyLabels = [];
    const monthlyValues = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const month = months[date.getMonth()];
      const year = date.getFullYear();
      const key = `${month} ${year}`;
      monthlyLabels.push(month);
      monthlyValues.push(monthlyStats.get(key) || 0);
    }

    // Weekly: contagem real dos últimos 7 dias (já incluídos em `users`, buscado desde 6 meses atrás)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyLabels: string[] = [];
    const weeklyValues: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const count = users.filter(
        (u) =>
          u.createdAt.getFullYear() === date.getFullYear() &&
          u.createdAt.getMonth() === date.getMonth() &&
          u.createdAt.getDate() === date.getDate(),
      ).length;
      weeklyLabels.push(dayNames[date.getDay()]);
      weeklyValues.push(count);
    }

    return {
      monthly: { labels: monthlyLabels, data: monthlyValues },
      weekly: { labels: weeklyLabels, data: weeklyValues },
    };
  }

  async getRoleDistribution() {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          deleted_at: null,
        },
        include: {
          role: true,
        },
      });

      const roleCounts = new Map<string, number>();
      users.forEach((user) => {
        const roleEnum = this.mapRoleNameToEnum(user.role?.name, 'UNKNOWN');
        roleCounts.set(roleEnum, (roleCounts.get(roleEnum) || 0) + 1);
      });

      const labels = Array.from(roleCounts.keys());
      const data = Array.from(roleCounts.values());

      return { roles: { labels, data } };
    } catch (error) {
      this.logger.error('Error in getRoleDistribution:', error);
      throw error;
    }
  }

  async getStatusDistribution() {
    const statusStats = await this.prisma.user.groupBy({
      by: ['isActive'],
      _count: {
        id: true,
      },
    });

    const labels = statusStats.map((stat) => (stat.isActive ? 'ACTIVE' : 'INACTIVE'));
    const data = statusStats.map((stat) => stat._count.id);

    return { status: { labels, data } };
  }

  async getPlanDistribution() {
    // `User.membership` é um campo legado que nunca é atualizado quando uma
    // assinatura é criada/trocada (fica sempre 'FREE' no seed) — a fonte real
    // do plano atual do usuário é a assinatura mais recente dele.
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
      },
      select: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { plan: { select: { name: true } } },
        },
      },
    });

    const planCounts = new Map<string, number>();
    users.forEach((user) => {
      const planName = user.subscriptions[0]?.plan.name || 'Basic';
      planCounts.set(planName, (planCounts.get(planName) || 0) + 1);
    });

    return {
      plans: {
        labels: Array.from(planCounts.keys()),
        data: Array.from(planCounts.values()),
      },
    };
  }

  private async getTotalUsers(): Promise<number> {
    const result = await this.prisma.user.count({
      where: {
        deleted_at: null,
      },
    });
    return result;
  }

  private async getActiveUsers(): Promise<number> {
    const result = await this.prisma.user.count({
      where: {
        isActive: true,
        deleted_at: null,
      },
    });
    return result;
  }

  private async getNewUsersThisMonth(): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await this.prisma.user.count({
      where: {
        createdAt: {
          gte: startOfMonth,
        },
        deleted_at: null,
      },
    });
    return result;
  }

  private async getTotalRevenue(): Promise<number> {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PAGAMENTO_STATUS.COMPLETED,
      },
      select: {
        amount: true,
      },
    });

    const totalRevenue = payments.reduce((sum, payment) => {
      return sum + Number(payment.amount);
    }, 0);

    return totalRevenue;
  }

  async getGeographicAnalysis() {
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
      },
      include: {
        address: true,
      },
    });

    // Agrupar por estado
    const stateCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();

    users.forEach((user) => {
      if (user.address) {
        // Contagem por estado
        const state = user.address.state || 'Não informado';
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);

        // Contagem por cidade
        const city = user.address.city || 'Não informado';
        cityCounts.set(city, (cityCounts.get(city) || 0) + 1);

        // Contagem por país
        const country = user.address.country || 'Não informado';
        countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
      }
    });

    // Pegar os top 10 estados
    const topStates = Array.from(stateCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Pegar os top 10 cidades
    const topCities = Array.from(cityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      states: {
        labels: topStates.map(([state]) => state),
        data: topStates.map(([, count]) => count),
      },
      cities: {
        labels: topCities.map(([city]) => city),
        data: topCities.map(([, count]) => count),
      },
      countries: {
        labels: Array.from(countryCounts.keys()),
        data: Array.from(countryCounts.values()),
      },
    };
  }

  async getDemographicAnalysis() {
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
      },
      select: {
        gender: true,
        birthdate: true,
      },
    });

    // Análise por gênero
    const genderCounts = new Map<string, number>();
    users.forEach((user) => {
      const gender = user.gender || 'Não informado';
      genderCounts.set(gender, (genderCounts.get(gender) || 0) + 1);
    });

    // Análise por faixa etária
    const ageRanges = {
      '18-25': 0,
      '26-35': 0,
      '36-45': 0,
      '46-55': 0,
      '56-65': 0,
      '65+': 0,
    };

    const currentYear = new Date().getFullYear();
    users.forEach((user) => {
      if (user.birthdate) {
        const age = currentYear - user.birthdate.getFullYear();
        if (age >= 18 && age <= 25) ageRanges['18-25']++;
        else if (age >= 26 && age <= 35) ageRanges['26-35']++;
        else if (age >= 36 && age <= 45) ageRanges['36-45']++;
        else if (age >= 46 && age <= 55) ageRanges['46-55']++;
        else if (age >= 56 && age <= 65) ageRanges['56-65']++;
        else if (age > 65) ageRanges['65+']++;
      }
    });

    return {
      gender: {
        labels: Array.from(genderCounts.keys()),
        data: Array.from(genderCounts.values()),
      },
      ageRanges: {
        labels: Object.keys(ageRanges),
        data: Object.values(ageRanges),
      },
    };
  }

  async getProfessionalSegmentAnalysis() {
    this.logger.log('Starting getProfessionalSegmentAnalysis');

    try {
      const users = await this.prisma.user.findMany({
        where: {
          deleted_at: null,
        },
        select: {
          professionalSegment: true,
          jobTitle: true,
          department: true,
        },
      });

      this.logger.log(`Found ${users.length} users for analysis`);

      // Log alguns exemplos de usuários
      const sampleUsers = users.slice(0, 5);
      this.logger.log('Sample users:', sampleUsers);

      // Análise por segmento profissional
      const segmentCounts = new Map<string, number>();
      const jobTitleCounts = new Map<string, number>();
      const departmentCounts = new Map<string, number>();

      users.forEach((user) => {
        // Segmento profissional
        const segment = user.professionalSegment || 'Não informado';
        segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1);

        // Cargo - usar valor padrão se estiver vazio
        const jobTitle = user.jobTitle || 'Não informado';
        jobTitleCounts.set(jobTitle, (jobTitleCounts.get(jobTitle) || 0) + 1);

        // Departamento - usar valor padrão se estiver vazio
        const department = user.department || 'Não informado';
        departmentCounts.set(department, (departmentCounts.get(department) || 0) + 1);
      });

      this.logger.log(`Segment counts: ${Array.from(segmentCounts.entries())}`);
      this.logger.log(`Job title counts: ${Array.from(jobTitleCounts.entries())}`);
      this.logger.log(`Department counts: ${Array.from(departmentCounts.entries())}`);

      // Pegar os top 10 cargos
      const topJobTitles = Array.from(jobTitleCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Pegar os top 10 departamentos
      const topDepartments = Array.from(departmentCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      this.logger.log(`Top job titles: ${topJobTitles}`);
      this.logger.log(`Top departments: ${topDepartments}`);

      const result = {
        segments: {
          labels: Array.from(segmentCounts.keys()),
          data: Array.from(segmentCounts.values()),
        },
        jobTitles: {
          labels: topJobTitles.map(([title]) => title),
          data: topJobTitles.map(([, count]) => count),
        },
        departments: {
          labels: topDepartments.map(([dept]) => dept),
          data: topDepartments.map(([, count]) => count),
        },
      };

      this.logger.log('Final result:', result);
      return result;
    } catch (error) {
      this.logger.error('Error in getProfessionalSegmentAnalysis:', error);
      throw error;
    }
  }

  async getCompanyAnalysis() {
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
      },
      select: {
        company: true,
      },
    });

    // Análise por empresa
    const companyCounts = new Map<string, number>();
    const companySizeRanges = {
      '1-10': 0,
      '11-50': 0,
      '51-200': 0,
      '201-1000': 0,
      '1000+': 0,
    };

    users.forEach((user) => {
      const company = user.company || 'Não informado';
      companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
    });

    // Simular tamanho da empresa baseado no número de usuários da mesma empresa
    companyCounts.forEach((count, company) => {
      if (count >= 1 && count <= 10) companySizeRanges['1-10']++;
      else if (count >= 11 && count <= 50) companySizeRanges['11-50']++;
      else if (count >= 51 && count <= 200) companySizeRanges['51-200']++;
      else if (count >= 201 && count <= 1000) companySizeRanges['201-1000']++;
      else if (count > 1000) companySizeRanges['1000+']++;
    });

    // Pegar as top 10 empresas
    const topCompanies = Array.from(companyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      companies: {
        labels: topCompanies.map(([company]) => company),
        data: topCompanies.map(([, count]) => count),
      },
      companySizes: {
        labels: Object.keys(companySizeRanges),
        data: Object.values(companySizeRanges),
      },
    };
  }

  async getUsersDetailed(filters: {
    page: number;
    limit: number;
    name?: string;
    email?: string;
    country?: string;
    city?: string;
    role?: string;
    plan?: string;
    status?: string;
    gender?: string;
    ageRange?: string;
    professionalSegment?: string;
    company?: string;
  }) {
    const { page, limit, ...filterParams } = filters;
    const skip = (page - 1) * limit;

    // Debug logs para filtros
    this.logger.log('Filters received', filterParams);
    this.logger.log('Professional segment filter', filterParams.professionalSegment);
    this.logger.log('Role filter', filterParams.role);

    // Construir where clause
    const where: any = {
      deleted_at: null,
    };

    // Filtros de texto
    if (filterParams.name) {
      where.fullName = {
        contains: filterParams.name,
      };
    }

    if (filterParams.email) {
      where.email = {
        contains: filterParams.email,
      };
    }

    if (filterParams.company) {
      where.company = {
        contains: filterParams.company,
      };
    }

    if (filterParams.professionalSegment && filterParams.professionalSegment !== 'all') {
      where.professionalSegment = filterParams.professionalSegment;
    }

    if (filterParams.role && filterParams.role !== 'all') {
      where.role = {
        name: filterParams.role,
      };
    }

    if (filterParams.gender && filterParams.gender !== 'all') {
      where.gender = filterParams.gender;
    }

    if (filterParams.plan && filterParams.plan !== 'all') {
      where.membership = filterParams.plan;
    }

    if (filterParams.status && filterParams.status !== 'all') {
      if (filterParams.status === 'ACTIVE') {
        where.isActive = true;
      } else if (filterParams.status === 'INACTIVE') {
        where.isActive = false;
      }
    }

    // Filtros de endereço
    if (filterParams.country || filterParams.city) {
      where.address = {};
      if (filterParams.country) {
        where.address.country = {
          contains: filterParams.country,
        };
      }
      if (filterParams.city) {
        where.address.city = {
          contains: filterParams.city,
        };
      }
    }

    // Filtro de faixa etária
    if (filterParams.ageRange && filterParams.ageRange !== 'all') {
      const currentYear = new Date().getFullYear();
      const [minAge, maxAge] = filterParams.ageRange.split('-').map(Number);

      if (maxAge) {
        where.birthdate = {
          gte: new Date(currentYear - maxAge - 1, 0, 1),
          lte: new Date(currentYear - minAge, 11, 31),
        };
      } else {
        // Para 65+
        where.birthdate = {
          lte: new Date(currentYear - 65, 11, 31),
        };
      }
    }

    // Buscar usuários com dados relacionados
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          address: true,
          role: true,
          subscriptions: {
            include: {
              plan: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.user.count({
        where: {
          deleted_at: null,
          ...(filterParams.name && {
            fullName: {
              contains: filterParams.name,
            },
          }),
          ...(filterParams.email && {
            email: {
              contains: filterParams.email,
            },
          }),
          ...(filterParams.company && {
            company: {
              contains: filterParams.company,
            },
          }),
          ...(filterParams.professionalSegment &&
            filterParams.professionalSegment !== 'all' && {
              professionalSegment: filterParams.professionalSegment,
            }),
          ...(filterParams.role &&
            filterParams.role !== 'all' && {
              role: {
                name: filterParams.role,
              },
            }),
          ...(filterParams.gender &&
            filterParams.gender !== 'all' && {
              gender: filterParams.gender,
            }),
          ...(filterParams.plan &&
            filterParams.plan !== 'all' && {
              membership: filterParams.plan,
            }),
          ...(filterParams.status &&
            filterParams.status !== 'all' && {
              isActive: filterParams.status === 'ACTIVE',
            }),
          ...((filterParams.country || filterParams.city) && {
            address: {
              ...(filterParams.country && {
                country: {
                  contains: filterParams.country,
                },
              }),
              ...(filterParams.city && {
                city: {
                  contains: filterParams.city,
                },
              }),
            },
          }),
          ...(filterParams.ageRange &&
            filterParams.ageRange !== 'all' &&
            (() => {
              const currentYear = new Date().getFullYear();
              const [minAge, maxAge] = filterParams.ageRange.split('-').map(Number);

              if (maxAge) {
                return {
                  birthdate: {
                    gte: new Date(currentYear - maxAge - 1, 0, 1),
                    lte: new Date(currentYear - minAge, 11, 31),
                  },
                };
              } else {
                return {
                  birthdate: {
                    lte: new Date(currentYear - 65, 11, 31),
                  },
                };
              }
            })()),
        },
      }),
    ]);

    // Processar dados dos usuários
    const processedUsers = users.map((user) => {
      const currentYear = new Date().getFullYear();
      const age = user.birthdate ? currentYear - user.birthdate.getFullYear() : null;

      // Determinar faixa etária
      let ageRange = 'Não informado';
      if (age) {
        if (age >= 18 && age <= 25) ageRange = '18-25';
        else if (age >= 26 && age <= 35) ageRange = '26-35';
        else if (age >= 36 && age <= 45) ageRange = '36-45';
        else if (age >= 46 && age <= 55) ageRange = '46-55';
        else if (age >= 56 && age <= 65) ageRange = '56-65';
        else if (age > 65) ageRange = '65+';
      }

      // DetailedUser.role é um enum GraphQL estrito (UserRole), então o
      // fallback aqui precisa ser um membro válido do enum, diferente do
      // 'UNKNOWN' usado em getRoleDistribution (que só popula labels de um gráfico)
      const roleEnum = this.mapRoleNameToEnum(user.role?.name, 'BARBERSHOP_OWNER');

      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender || 'Não informado',
        age: age,
        ageRange: ageRange,
        birthdate: user.birthdate,
        country: user.address?.country || 'Não informado',
        city: user.address?.city || 'Não informado',
        state: user.address?.state || 'Não informado',
        company: user.company || 'Não informado',
        professionalSegment: user.professionalSegment || 'Não informado',
        jobTitle: user.jobTitle || 'Não informado',
        department: user.department || 'Não informado',
        plan: user.membership || 'FREE',
        status: user.isActive ? 'ACTIVE' : 'INACTIVE',
        role: roleEnum,
        createdAt: user.createdAt,
        lastLogin: user.updatedAt, // Usar updatedAt como aproximação
      };
    });

    return {
      data: processedUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async sendEmailNotification(input: {
    userIds: number[];
    subject: string;
    message: string;
    actionUrl?: string;
    actionText?: string;
    type?: string;
  }) {
    // Busca os usuários
    const users = await this.prisma.user.findMany({
      where: { id: { in: input.userIds } },
      select: {
        id: true,
        email: true,
        fullName: true,
        userSystemConfig: { select: { language: true } },
      },
    });
    for (const user of users) {
      const lang = user.userSystemConfig?.language?.toLowerCase() || 'pt';
      await this.emailService.sendTemplateEmail(
        user.id,
        'admin_notification',
        {
          title: input.subject,
          message: input.message,
          actionUrl: input.actionUrl,
          actionText: input.actionText,
          type: input.type || 'info',
          fullName: user.fullName,
        },
        input.subject,
        'admin_notification',
        user.email,
      );
    }
    return true;
  }

  async getEmailHistory(filters: {
    page?: number;
    limit?: number;
    user?: string;
    subject?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page = 1, limit = 20, user, subject, dateFrom, dateTo } = filters;
    const skip = (page - 1) * limit;

    // Construir condições de filtro
    const whereConditions: any = {};

    if (user) {
      whereConditions.user = {
        OR: [{ fullName: { contains: user } }, { email: { contains: user } }],
      };
    }

    if (subject) {
      whereConditions.subject = { contains: subject };
    }

    if (dateFrom || dateTo) {
      whereConditions.createdAt = {};
      if (dateFrom) {
        whereConditions.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        whereConditions.createdAt.lte = new Date(dateTo);
      }
    }

    // Buscar emails e total
    const [emails, total] = await Promise.all([
      this.prisma.emailLogger.findMany({
        where: whereConditions,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.emailLogger.count({
        where: whereConditions,
      }),
    ]);

    // Processar dados
    const processedEmails = emails.map((email) => ({
      id: email.id,
      sentTo: email.sentTo,
      subject: email.subject,
      body: email.body,
      meta: email.meta,
      createdAt: email.createdAt.toISOString(),
      userId: email.userId,
      userName: email.user.fullName,
      userEmail: email.user.email,
    }));

    return {
      data: processedEmails,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
