import { BadRequestException, Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { City, State } from 'country-state-city';

// Estados e cidades pros formulários de endereço (cadastro, convite de
// funcionário, editar conta). Antes o front empacotava a biblioteca inteira
// (todas as cidades do mundo, ~8,5 MB) e o cadastro baixava ~14 MB de JS;
// agora busca aqui só o país/estado escolhido. Público (o cadastro é antes
// do login) e com cache longo: esses dados não mudam.
const ISO2 = /^[A-Z]{2}$/;
const STATE_CODE = /^[A-Z0-9-]{1,10}$/;

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  @Get('states')
  @Header('Cache-Control', 'public, max-age=86400')
  states(@Query('country') country = '') {
    const code = country.toUpperCase();
    if (!ISO2.test(code)) throw new BadRequestException('country inválido');
    return State.getStatesOfCountry(code).map((s) => ({ code: s.isoCode, name: s.name }));
  }

  @Get('cities')
  @Header('Cache-Control', 'public, max-age=86400')
  cities(@Query('country') country = '', @Query('state') state = '') {
    const code = country.toUpperCase();
    const stateCode = state.toUpperCase();
    if (!ISO2.test(code) || !STATE_CODE.test(stateCode)) {
      throw new BadRequestException('country/state inválidos');
    }
    return City.getCitiesOfState(code, stateCode).map((c) => c.name);
  }
}
