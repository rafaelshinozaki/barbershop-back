import { Controller, Get, Query, Res, UseGuards, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/auth/current-user.decorator';
import { UserDTO } from '@/auth/users/dto/user.dto';
import { SocialService } from './social.service';

// Endpoints REST (não GraphQL) porque OAuth precisa de navegação real do
// navegador — redirect pro diálogo da Meta e depois de volta pra cá — não
// dá pra fazer isso numa mutation. Mesmo padrão de /auth/facebook e
// /client-auth/facebook, só que pra permissões de Página/Instagram em vez
// de login de usuário.
@ApiTags('social')
@Controller('social')
export class SocialController {
  private readonly logger = new Logger(SocialController.name);

  constructor(
    private readonly socialService: SocialService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  @ApiExcludeEndpoint()
  async connect(
    @Query('barbershopId') barbershopId: string,
    @CurrentUser() user: UserDTO,
    @Res() res: Response,
  ) {
    const url = await this.socialService.getConnectUrl(user.id, parseInt(barbershopId, 10));
    return res.redirect(url);
  }

  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    if (!code || !state) {
      return res.redirect(`${frontendUrl}/barbershops?socialError=1`);
    }
    const { barbershopId, error } = await this.socialService.handleOAuthCallback(code, state);
    const target = `${frontendUrl}/barbershops/${barbershopId}/social`;
    return res.redirect(
      error ? `${target}?socialError=${encodeURIComponent(error)}` : `${target}?socialConnected=1`,
    );
  }
}
