import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PLANO_STATUS } from '@/common';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) {
      return false;
    }

    if (!user.isActive) {
      return false;
    }

    const sub = await this.prisma.subscription.findFirst({
      where: { userId: user.userId, status: PLANO_STATUS.ACTIVE },
    });

    return !!sub;
  }
}
