import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('UI utils: cn()', () => {
  it('merges multiple class names', () => {
    expect(cn('btn', 'btn-primary')).toBe('btn btn-primary');
  });

  it('handles conditional class names and falsy values', () => {
    const isPrimary = false;
    const isOutline = true;
    expect(cn('btn', isPrimary && 'btn-primary', isOutline && 'btn-outline', null, undefined)).toBe(
      'btn btn-outline'
    );
  });

  it('resolves conflicting Tailwind utilities via tailwind-merge', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});
