import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { CalendarService } from './calendar.service';

/**
 * Arquivos de calendário, sem login: o link assinado do agendamento (cliente)
 * ou o token secreto do feed (equipe) é que dá acesso.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** "Adicionar à agenda" (Apple, celular e qualquer app): .ics do agendamento */
  @Get('appointment.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="agendamento.ics"')
  @Header('Cache-Control', 'no-store')
  async appointment(@Query('t') token: string) {
    return this.calendar.appointmentIcs(token);
  }

  /** Agenda assinável da equipe (Google Agenda, Apple, Outlook buscam daqui) */
  @Get('feed/:file')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async feed(@Param('file') file: string) {
    return this.calendar.feedIcs(file.replace(/\.ics$/, ''));
  }
}
