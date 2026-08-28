// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FontSize, TextStyle } from './fontSize';

describe('FontSize & TextStyle Extensions', () => {
  it('initializes editor with TextStyle and FontSize extensions', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p>Hello Academic World</p>',
    });

    expect(editor.extensionManager.extensions.some((e) => e.name === 'fontSize')).toBe(true);
    expect(editor.extensionManager.extensions.some((e) => e.name === 'textStyle')).toBe(true);
    editor.destroy();
  });

  it('sets and unsets font size on text selection', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p>Sample Text</p>',
    });

    editor.commands.selectAll();
    editor.commands.setFontSize('20px');

    const html = editor.getHTML();
    expect(html).toContain('font-size: 20px');
    expect(html).toContain('data-font-size="20px"');

    editor.commands.unsetFontSize();
    const htmlUnset = editor.getHTML();
    expect(htmlUnset).not.toContain('font-size: 20px');

    editor.destroy();
  });

  it('parses HTML with style and data-font-size attributes', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p><span style="font-size: 24px" data-font-size="24px">Styled Text</span></p>',
    });

    const attrs = editor.getAttributes('textStyle');
    expect(attrs.fontSize).toBe('24px');
    editor.destroy();
  });

  it('handles removeEmptyTextStyle command on styled and unstyled text', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, FontSize],
      content: '<p><span>Plain Span</span> and <span style="font-size: 16px">Styled Span</span></p>',
    });

    editor.commands.selectAll();
    // Running removeEmptyTextStyle on styled text returns true (line 59)
    const res = editor.commands.removeEmptyTextStyle();
    expect(res).toBe(true);

    editor.commands.unsetFontSize();
    const resEmpty = editor.commands.removeEmptyTextStyle();
    expect(resEmpty).toBe(true);

    editor.destroy();
  });
});
