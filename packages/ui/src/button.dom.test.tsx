// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement } from 'react';
import { Button } from './button';

describe('Button (jsdom smoke)', () => {
  it('renders label into the document', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);
    flushSync(() => {
      root.render(createElement(Button, null, 'Save Paper'));
    });

    const el = container.querySelector('button');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Save Paper');

    root.unmount();
    container.remove();
  });

  it('applies destructive variant classes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);
    flushSync(() => {
      root.render(createElement(Button, { variant: 'destructive' }, 'Delete'));
    });

    const el = container.querySelector('button');
    expect(el?.className).toContain('bg-trust-danger');

    root.unmount();
    container.remove();
  });
});
