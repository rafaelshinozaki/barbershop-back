import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

export interface IpLocationData {
  city?: string;
  region?: string;
  country_name?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

@Injectable()
export class IpLocationService {
  private readonly logger = new Logger(IpLocationService.name);

  // Cache para localização de IPs
  private locationCache = new Map<string, { data: string; timestamp: number }>();

  // Tempo de cache: 1 hora
  private readonly CACHE_DURATION = 60 * 60 * 1000;

  // Timeout para requisições: 3 segundos
  private readonly REQUEST_TIMEOUT = 3000;

  constructor(private readonly configService: ConfigService) {
    // Iniciar limpeza de cache a cada hora
    this.scheduleCacheCleanup();
  }

  /**
   * Obtém a localização de um IP
   */
  async getLocation(ip: string): Promise<string> {
    // Verificar cache primeiro
    const cached = this.locationCache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    // IPs locais não precisam de lookup
    if (this.isLocalIp(ip)) {
      const localLocation = 'Local Network';
      this.locationCache.set(ip, { data: localLocation, timestamp: Date.now() });
      return localLocation;
    }

    // Em desenvolvimento, usar dados mock se configurado
    if (this.configService.get('NODE_ENV') === 'development') {
      const mockLocation = this.getMockLocation(ip);
      if (mockLocation) {
        this.locationCache.set(ip, { data: mockLocation, timestamp: Date.now() });
        return mockLocation;
      }
    }

    try {
      const locationData = await this.fetchLocationData(ip);
      const location = this.formatLocation(locationData);

      // Cache da localização
      this.locationCache.set(ip, { data: location, timestamp: Date.now() });

      return location;
    } catch (error) {
      this.logger.warn(`Failed to get location for IP ${ip}:`, error.message);
      return 'Unknown';
    }
  }

  /**
   * Verifica se é um IP local
   */
  private isLocalIp(ip: string): boolean {
    return (
      ip === '127.0.0.1' ||
      ip === 'localhost' ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') ||
      ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') ||
      ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') ||
      ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.')
    );
  }

  /**
   * Obtém localização mock para desenvolvimento
   */
  private getMockLocation(ip: string): string | null {
    // Em desenvolvimento, retornar localizações mock baseadas no IP
    const mockLocations = {
      '8.8.8.8': 'Mountain View, California, United States',
      '1.1.1.1': 'Los Angeles, California, United States',
      '208.67.222.222': 'San Jose, California, United States',
    };

    return mockLocations[ip] || null;
  }

  /**
   * Busca dados de localização da API
   */
  private async fetchLocationData(ip: string): Promise<IpLocationData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, this.REQUEST_TIMEOUT);

      const request = https.get(`https://ipapi.co/${ip}/json/`, (resp) => {
        let data = '';

        resp.on('data', (chunk) => (data += chunk));

        resp.on('end', () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (error) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      request.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      request.on('timeout', () => {
        clearTimeout(timeout);
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Formata os dados de localização
   */
  private formatLocation(data: IpLocationData): string {
    const parts = [data.city, data.region, data.country_name].filter(Boolean);
    return parts.join(', ') || 'Unknown';
  }

  /**
   * Agenda limpeza de cache
   */
  private scheduleCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [key, value] of this.locationCache.entries()) {
        if (now - value.timestamp > this.CACHE_DURATION) {
          this.locationCache.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned ${cleanedCount} expired cache entries`);
      }
    }, 60 * 60 * 1000); // 1 hora
  }

  /**
   * Limpa o cache manualmente (útil para testes)
   */
  clearCache(): void {
    this.locationCache.clear();
    this.logger.debug('Cache cleared manually');
  }

  /**
   * Obtém estatísticas do cache
   */
  getCacheStats(): { size: number; entries: Array<{ ip: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.locationCache.entries()).map(([ip, value]) => ({
      ip,
      age: now - value.timestamp,
    }));

    return {
      size: this.locationCache.size,
      entries,
    };
  }
}
