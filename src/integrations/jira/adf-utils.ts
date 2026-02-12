// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { AdfDocument, AdfNode } from './types.js';

/**
 * Extract plain text from an Atlassian Document Format (ADF) document.
 * Recursively walks the node tree and concatenates text content.
 */
export function adfToPlainText(doc: AdfDocument | null | undefined): string {
  if (!doc || !doc.content) return '';

  function extractText(nodes: AdfNode[]): string {
    const parts: string[] = [];

    for (const node of nodes) {
      if (node.type === 'text' && node.text) {
        parts.push(node.text);
      } else if (node.content) {
        parts.push(extractText(node.content));
      }

      // Add newline after block-level nodes
      if (
        node.type === 'paragraph' ||
        node.type === 'heading' ||
        node.type === 'bulletList' ||
        node.type === 'orderedList' ||
        node.type === 'listItem'
      ) {
        parts.push('\n');
      }
    }

    return parts.join('');
  }

  return extractText(doc.content).trim();
}
