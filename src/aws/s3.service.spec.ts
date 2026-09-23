import { BadRequestException } from '@nestjs/common';
import { S3Service, UPLOAD_MAX_BYTES } from './s3.service';

const config = {
  get: (key: string) =>
    ({
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'AKIATEST',
      AWS_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'bucket-teste',
    }[key]),
};

describe('S3Service.createImageUpload', () => {
  const service = new S3Service(config as never);
  const policyOf = (fields: { name: string; value: string }[]) =>
    JSON.parse(
      Buffer.from(fields.find((f) => f.name === 'Policy')!.value, 'base64').toString('utf8'),
    );

  it('assina limite de tamanho, tipo fixo e validade curta', async () => {
    const upload = await service.createImageUpload('barbershops/3/photo', 'image/png');
    expect(upload.key).toBe('barbershops/3/photo.png');
    expect(upload.url).toContain('bucket-teste');
    const fields = Object.fromEntries(upload.fields.map((f) => [f.name, f.value]));
    expect(fields.key).toBe('barbershops/3/photo.png');
    expect(fields['Content-Type']).toBe('image/png');

    const policy = policyOf(upload.fields);
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, UPLOAD_MAX_BYTES],
        ['eq', '$Content-Type', 'image/png'],
        { key: 'barbershops/3/photo.png' },
        { bucket: 'bucket-teste' },
      ]),
    );
    const minutes = (new Date(policy.expiration).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(5);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('extensão vem do tipo (image/jpg vira jpeg)', async () => {
    const upload = await service.createImageUpload('users/1/profile-photo', 'image/jpg');
    expect(upload.key).toBe('users/1/profile-photo.jpg');
    expect(policyOf(upload.fields).conditions).toEqual(
      expect.arrayContaining([['eq', '$Content-Type', 'image/jpeg']]),
    );
  });

  it.each(['text/html', 'image/svg+xml', 'application/pdf'])('recusa %s', async (type) => {
    await expect(service.createImageUpload('x/y', type)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
