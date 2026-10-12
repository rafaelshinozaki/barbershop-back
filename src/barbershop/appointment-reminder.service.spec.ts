import { reminderCoveredByConfirmation } from './appointment-reminder.service';

describe('reminderCoveredByConfirmation', () => {
  it('horário marcado dentro das 24 h não ganha um segundo e-mail', () => {
    const created = new Date('2030-03-04T18:00:00Z');
    const tomorrowMorning = new Date('2030-03-05T11:00:00Z');
    expect(reminderCoveredByConfirmation(created, tomorrowMorning)).toBe(true);
  });

  it('horário marcado com mais de 24 h de antecedência ainda recebe o lembrete', () => {
    const created = new Date('2030-03-01T12:00:00Z');
    const start = new Date('2030-03-04T12:00:00Z');
    expect(reminderCoveredByConfirmation(created, start)).toBe(false);
  });
});
