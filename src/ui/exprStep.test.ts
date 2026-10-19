import { describe, expect, it } from 'vitest';
import { stepExpression } from './exprStep';

describe('stepExpression', () => {
  it('steps by a step that suits the unit, keeping the unit', () => {
    expect(stepExpression('10 mm', 1)).toBe('11 mm');
    expect(stepExpression('10 mm', -1)).toBe('9 mm');
    expect(stepExpression('2.5 mm', 1)).toBe('3.5 mm');
    expect(stepExpression('118 deg', -1)).toBe('117 deg');
    expect(stepExpression('0.5 in', 1)).toBe('0.6 in');
    expect(stepExpression('1.25 cm', 1)).toBe('1.35 cm');
    expect(stepExpression('10', 1)).toBe('11');
    expect(stepExpression('0.5', 1)).toBe('0.6');
    expect(stepExpression('0.1', -1)).toBe('0');
  });

  it('takes a bigger or smaller step with Shift / Alt', () => {
    expect(stepExpression('10 mm', 1, 10)).toBe('20 mm');
    expect(stepExpression('10 mm', 1, 0.1)).toBe('10.1 mm');
    expect(stepExpression('0.3 mm', -1, 0.1)).toBe('0.2 mm');
  });

  it('leaves expressions alone', () => {
    expect(stepExpression('#w / 2', 1)).toBeNull();
    expect(stepExpression('10 mm + 2 mm', 1)).toBeNull();
    expect(stepExpression('', 1)).toBeNull();
  });
});
