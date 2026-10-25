import { Country, State } from 'country-state-city';
import { DEFAULT_TIMEZONE, safeTimeZone } from './timezone.util';

/**
 * Moeda e fuso a partir do país (e do estado, quando o país tem vários fusos).
 * O fuso do navegador vale quando é um fuso daquele país — é mais preciso que
 * o estado em países que cortam o estado ao meio.
 */

const NAME_TO_ISO: Record<string, string> = {
  brasil: 'BR',
  brazil: 'BR',
  portugal: 'PT',
  mexico: 'MX',
  méxico: 'MX',
  espanha: 'ES',
  spain: 'ES',
  argentina: 'AR',
  colombia: 'CO',
  colômbia: 'CO',
  eua: 'US',
  'estados unidos': 'US',
  'united states': 'US',
};

/** Fuso principal quando o estado não diz qual (o primeiro da lista costuma ser um território pequeno). */
const PRIMARY_ZONE: Record<string, string> = {
  AU: 'Australia/Sydney',
  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',
  MX: 'America/Mexico_City',
  PT: 'Europe/Lisbon',
  RU: 'Europe/Moscow',
  US: 'America/New_York',
};

/** Código do estado (ISO da country-state-city) → fuso. */
const STATE_ZONE: Record<string, Record<string, string>> = {
  BR: {
    AC: 'America/Rio_Branco',
    AL: 'America/Maceio',
    AM: 'America/Manaus',
    AP: 'America/Belem',
    BA: 'America/Bahia',
    CE: 'America/Fortaleza',
    DF: 'America/Sao_Paulo',
    ES: 'America/Sao_Paulo',
    GO: 'America/Sao_Paulo',
    MA: 'America/Fortaleza',
    MG: 'America/Sao_Paulo',
    MS: 'America/Campo_Grande',
    MT: 'America/Cuiaba',
    PA: 'America/Belem',
    PB: 'America/Fortaleza',
    PE: 'America/Recife',
    PI: 'America/Fortaleza',
    PR: 'America/Sao_Paulo',
    RJ: 'America/Sao_Paulo',
    RN: 'America/Fortaleza',
    RO: 'America/Porto_Velho',
    RR: 'America/Boa_Vista',
    RS: 'America/Sao_Paulo',
    SC: 'America/Sao_Paulo',
    SE: 'America/Maceio',
    SP: 'America/Sao_Paulo',
    TO: 'America/Araguaina',
  },
  PT: {
    '20': 'Atlantic/Azores',
    '30': 'Atlantic/Madeira',
  },
  MX: {
    BCN: 'America/Tijuana',
    BCS: 'America/Mazatlan',
    CHH: 'America/Chihuahua',
    NAY: 'America/Mazatlan',
    NLE: 'America/Monterrey',
    ROO: 'America/Cancun',
    SIN: 'America/Mazatlan',
    SON: 'America/Hermosillo',
    TAM: 'America/Matamoros',
  },
  US: {
    AK: 'America/Anchorage',
    AL: 'America/Chicago',
    AR: 'America/Chicago',
    AZ: 'America/Phoenix',
    CA: 'America/Los_Angeles',
    CO: 'America/Denver',
    CT: 'America/New_York',
    DC: 'America/New_York',
    DE: 'America/New_York',
    FL: 'America/New_York',
    GA: 'America/New_York',
    HI: 'Pacific/Honolulu',
    IA: 'America/Chicago',
    ID: 'America/Denver',
    IL: 'America/Chicago',
    IN: 'America/New_York',
    KS: 'America/Chicago',
    KY: 'America/New_York',
    LA: 'America/Chicago',
    MA: 'America/New_York',
    MD: 'America/New_York',
    ME: 'America/New_York',
    MI: 'America/New_York',
    MN: 'America/Chicago',
    MO: 'America/Chicago',
    MS: 'America/Chicago',
    MT: 'America/Denver',
    NC: 'America/New_York',
    ND: 'America/Chicago',
    NE: 'America/Chicago',
    NH: 'America/New_York',
    NJ: 'America/New_York',
    NM: 'America/Denver',
    NV: 'America/Los_Angeles',
    NY: 'America/New_York',
    OH: 'America/New_York',
    OK: 'America/Chicago',
    OR: 'America/Los_Angeles',
    PA: 'America/New_York',
    RI: 'America/New_York',
    SC: 'America/New_York',
    SD: 'America/Chicago',
    TN: 'America/Chicago',
    TX: 'America/Chicago',
    UT: 'America/Denver',
    VA: 'America/New_York',
    VT: 'America/New_York',
    WA: 'America/Los_Angeles',
    WI: 'America/Chicago',
    WV: 'America/New_York',
    WY: 'America/Denver',
  },
  CA: {
    AB: 'America/Edmonton',
    BC: 'America/Vancouver',
    MB: 'America/Winnipeg',
    NB: 'America/Moncton',
    NL: 'America/St_Johns',
    NS: 'America/Halifax',
    NT: 'America/Yellowknife',
    NU: 'America/Iqaluit',
    ON: 'America/Toronto',
    PE: 'America/Halifax',
    QC: 'America/Toronto',
    SK: 'America/Regina',
    YT: 'America/Whitehorse',
  },
  AU: {
    ACT: 'Australia/Sydney',
    NSW: 'Australia/Sydney',
    NT: 'Australia/Darwin',
    QLD: 'Australia/Brisbane',
    SA: 'Australia/Adelaide',
    TAS: 'Australia/Hobart',
    VIC: 'Australia/Melbourne',
    WA: 'Australia/Perth',
  },
};

function countryOf(raw: string) {
  const text = raw.trim();
  if (!text) return undefined;
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return Country.getCountryByCode(upper) ?? undefined;
  const alias = NAME_TO_ISO[text.toLowerCase()];
  if (alias) return Country.getCountryByCode(alias) ?? undefined;
  return Country.getAllCountries().find((c) => c.name.toLowerCase() === text.toLowerCase());
}

/**
 * Código ISO de duas letras do país, a partir do código ou do nome
 * ("Brasil", "Brazil", "br"). null se não for um país (item 267).
 */
export function countryIso(raw?: string | null): string | null {
  const found = countryOf(raw ?? '');
  return found?.isoCode ? found.isoCode.toUpperCase() : null;
}

function stateCode(countryIso: string, stateRaw: string): string {
  const text = stateRaw.trim();
  if (!text) return '';
  const states = State.getStatesOfCountry(countryIso);
  const upper = text.toUpperCase();
  const byCode = states.find((s) => s.isoCode.toUpperCase() === upper);
  if (byCode) return byCode.isoCode.toUpperCase();
  const byName = states.find((s) => s.name.toLowerCase() === text.toLowerCase());
  return (byName?.isoCode ?? text).toUpperCase();
}

function isKnownZone(zone: string): boolean {
  return safeTimeZone(zone) === zone;
}

/** ISO 4217 do país. Sem país reconhecido, real. */
export function currencyForCountry(country: string): string {
  const currency = countryOf(country)?.currency?.toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) return currency;
  return 'BRL';
}

/**
 * Fuso da agenda. O do navegador entra se for um fuso válido daquele país.
 * Senão, o estado; senão, o fuso principal do país.
 */
export function timezoneForPlace(
  country: string,
  state: string,
  browserTz?: string | null,
): string {
  const found = countryOf(country);
  const zones = (found?.timezones ?? []).map((z) => z.zoneName).filter(Boolean);
  const browser = browserTz?.trim();
  if (browser && isKnownZone(browser) && (zones.length === 0 || zones.includes(browser))) {
    return browser;
  }
  const iso = found?.isoCode;
  if (iso) {
    const mapped = STATE_ZONE[iso]?.[stateCode(iso, state)];
    if (mapped && isKnownZone(mapped)) return mapped;
    const primary = PRIMARY_ZONE[iso];
    if (primary && isKnownZone(primary)) return primary;
  }
  const single = zones.length === 1 ? zones[0] : undefined;
  if (single && isKnownZone(single)) return single;
  return DEFAULT_TIMEZONE;
}
