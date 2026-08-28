import { describe, expect, it } from 'vitest';
import { colors, typography, layout, density } from './index';

describe('Design Tokens Suite', () => {
  it('exports light and dark color palettes with symmetric keys', () => {
    const lightKeys = Object.keys(colors.light).sort();
    const darkKeys = Object.keys(colors.dark).sort();

    expect(lightKeys).toEqual(darkKeys);
    expect(lightKeys).toContain('bgCanvas');
    expect(lightKeys).toContain('bgSurface');
    expect(lightKeys).toContain('textPrimary');
    expect(lightKeys).toContain('accentPrimary');
    expect(lightKeys).toContain('sourceGrounded');
    expect(lightKeys).toContain('warning');
    expect(lightKeys).toContain('danger');
    expect(lightKeys).toContain('success');
  });

  it('validates color values are valid hex strings', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const [key, val] of Object.entries(colors.light)) {
      expect(val, `light.${key}`).toMatch(hexPattern);
    }
    for (const [key, val] of Object.entries(colors.dark)) {
      expect(val, `dark.${key}`).toMatch(hexPattern);
    }
  });

  it('exports valid typography definitions', () => {
    expect(typography.fontSizes.base).toBe('16px');
    expect(typography.fontSizes.editorBody).toBe('17px');
    expect(typography.fontFamily.sans).toContain('Inter');
    expect(typography.fontFamily.serif).toContain('Source Serif 4');
    expect(typography.fontFamily.mono).toContain('JetBrains Mono');
    expect(typography.lineHeight.editorBody).toBe('1.6');
  });

  it('exports layout dimensions and density spacing', () => {
    expect(layout.topbarHeight).toBe('48px');
    expect(layout.sidebarWidth).toBe('220px');
    expect(layout.editorMaxWidth).toBe('960px');
    expect(layout.sourcePanelWidth).toBe('340px');

    expect(density.comfortable.padding).toBe('16px');
    expect(density.compact.padding).toBe('8px');
  });
});
