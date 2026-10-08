import { assertPushEndpoint, isBlockedPushAddress } from './push-endpoint';

describe('endpoint de push', () => {
  const allow = async () => ['142.250.0.1'];

  it('aceita os hosts conhecidos e recusa rede interna, loopback e host qualquer', async () => {
    await expect(
      assertPushEndpoint('https://fcm.googleapis.com/fcm/send/abc', allow),
    ).resolves.toBeUndefined();
    await expect(
      assertPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x', allow),
    ).resolves.toBeUndefined();
    await expect(
      assertPushEndpoint('https://web.push.apple.com/Q', allow),
    ).resolves.toBeUndefined();
    await expect(
      assertPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1', allow),
    ).resolves.toBeUndefined();

    await expect(assertPushEndpoint('https://10.0.0.5/push', allow)).rejects.toThrow('invalid');
    await expect(assertPushEndpoint('https://127.0.0.1/push', allow)).rejects.toThrow('invalid');
    await expect(assertPushEndpoint('http://fcm.googleapis.com/x', allow)).rejects.toThrow(
      'invalid',
    );
    await expect(assertPushEndpoint('https://evil.example/push', allow)).rejects.toThrow('invalid');
  });

  it('host permitido que resolve para IP privado também é recusado', async () => {
    await expect(
      assertPushEndpoint('https://fcm.googleapis.com/wp/x', async () => ['10.1.2.3']),
    ).rejects.toThrow('invalid');
    await expect(
      assertPushEndpoint('https://fcm.googleapis.com/wp/x', async () => ['169.254.169.254']),
    ).rejects.toThrow('invalid');
    expect(isBlockedPushAddress('::1')).toBe(true);
    expect(isBlockedPushAddress('fd00::1')).toBe(true);
    expect(isBlockedPushAddress('8.8.8.8')).toBe(false);
  });
});
