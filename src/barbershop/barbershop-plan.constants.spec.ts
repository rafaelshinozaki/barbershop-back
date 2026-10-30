import { effectivePlanName, getModulesForPlanName, planIncludesModule } from './barbershop-plan.constants';

describe('módulos do plano', () => {
  it('o Basic tem agenda e não tem produtos; o teste vale o Premium', () => {
    expect(planIncludesModule('Basic', 'appointments')).toBe(true);
    expect(planIncludesModule('Basic', 'products')).toBe(false);
    expect(getModulesForPlanName('Standard')).toContain('products');
    expect(getModulesForPlanName('Standard')).not.toContain('cashFlow');
    expect(planIncludesModule('Premium', 'packages')).toBe(true);
    const during = new Date('2026-11-01T00:00:00Z');
    expect(effectivePlanName('Basic', new Date('2026-11-15T00:00:00Z'), during)).toBe('Premium');
    expect(effectivePlanName('Basic', new Date('2026-10-01T00:00:00Z'), during)).toBe('Basic');
  });
});
