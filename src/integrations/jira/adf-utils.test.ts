// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { adfToPlainText } from './adf-utils.js';
import type { AdfDocument } from './types.js';

describe('adfToPlainText', () => {
  it('should return empty string for null/undefined', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
  });

  it('should extract text from a simple paragraph', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Hello world');
  });

  it('should handle multiple paragraphs', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
      ],
    };
    const text = adfToPlainText(doc);
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
  });

  it('should handle nested structures (headings, lists)', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 1' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 2' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const text = adfToPlainText(doc);
    expect(text).toContain('Title');
    expect(text).toContain('Item 1');
    expect(text).toContain('Item 2');
  });

  it('should handle empty document content', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [],
    };
    expect(adfToPlainText(doc)).toBe('');
  });
});
