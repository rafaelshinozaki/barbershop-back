import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientTokenPayload } from '../interfaces/client-token-payload.interface';
import { clientClaims } from '../../auth/session-claims';
import { clientSessionAlive, renewClientSessionIfStale } from '../client-session';

@Injectable()
export class GraphQLClientJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const gqlContext = GqlExecutionContext.create(context);
    const { req, res } = gqlContext.getContext();

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
      // Só sessão do cliente: o token da equipe (ou o state do OAuth) não vale
      const claims = clientClaims(decoded);
      if (!claims) throw new UnauthorizedException('Sessão de cliente inválida.');

      const account = await this.prisma.clientAccount.findUnique({
        where: { id: claims.clientAccountId },
      });
      // Suspensa pelo admin da plataforma: nenhuma sessão vale
      if (!account || account.deletedAt || account.suspendedAt) {
        throw new UnauthorizedException('Conta de cliente não encontrada.');
      }
      // Senha trocada (ou conta retomada pelo dono do e-mail) derruba os
      // cookies emitidos antes
      if (claims.v !== account.sessionVersion) {
        throw new UnauthorizedException('Sessão de cliente encerrada.');
      }
      // "Sair" apagou esta sessão: o token copiado não entra mais (item 272)
      if (!(await clientSessionAlive(this.prisma, account.id, claims.sid))) {
        throw new UnauthorizedException('Sessão de cliente encerrada.');
      }
      // Em uso: o prazo se renova (antes caía em uma hora mesmo em uso)
      await renewClientSessionIfStale(
        this.prisma,
        this.jwtService,
        res,
        decoded as never,
        this.configService.get<string>('NODE_ENV') === 'production',
      );

      req.clientUser = { id: account.id, email: account.email, name: account.name };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão de cliente inválida.');
    }
  }
}
