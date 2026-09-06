import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientTokenPayload } from '../interfaces/client-token-payload.interface';

@Injectable()
export class GraphQLClientJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const gqlContext = GqlExecutionContext.create(context);
    const { req } = gqlContext.getContext();

    // Mensagens em pt-BR e sem as palavras 'token'/'authentication'/'Unauthorized' —
    // o errorLink do Apollo no front desloga a sessão de STAFF (useAuthStore.clear())
    // quando vê essas palavras em qualquer erro GraphQL, então uma mensagem em inglês
    // aqui derrubaria por engano a sessão de dono/gerente/funcionário logada ao lado.
    const cookieToken = req.cookies?.ClientAuthentication;
    if (!cookieToken) {
      throw new UnauthorizedException('Cliente não autenticado.');
    }

    try {
      const decoded = this.jwtService.verify(cookieToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as ClientTokenPayload;

      const account = await this.prisma.clientAccount.findUnique({
        where: { id: decoded.clientAccountId },
      });
      if (!account) {
        throw new UnauthorizedException('Conta de cliente não encontrada.');
      }

      req.clientUser = { id: account.id, email: account.email, name: account.name };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão de cliente inválida.');
    }
  }
}
