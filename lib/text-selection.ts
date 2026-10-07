import type { Mark } from './pdf';

export type Glyph = { text: string; rect: DOMRect };

export type TextLine = {
  glyphs: Glyph[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  vertical: boolean;
};

export function measureText(layer: HTMLElement): TextLine[] {
  const rows: TextLine[] = [];
  const range = document.createRange();

  for (const span of layer.querySelectorAll<HTMLElement>('span')) {
    const node = span.firstChild;

    if (node?.nodeType !== Node.TEXT_NODE || !node.textContent) {
      continue;
    }

    const glyphs: Glyph[] = [];
    let offset = 0;

    for (const text of node.textContent) {
      range.setStart(node, offset);
      offset += text.length;
      range.setEnd(node, offset);
      const rect = range.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        glyphs.push({ text, rect });
      }
    }

    if (!glyphs.length) {
      continue;
    }

    const first = glyphs[0].rect,
      last = glyphs[glyphs.length - 1].rect;
    const angle = parseFloat(getComputedStyle(span).getPropertyValue('--rotate')) || 0;
    const vertical =
      Math.abs(last.y - first.y) > Math.abs(last.x - first.x) ||
      Math.abs(Math.sin((angle * Math.PI) / 180)) > 0.7;

    for (const glyph of glyphs) {
      const r = glyph.rect;
      const center = vertical ? r.x + r.width / 2 : r.y + r.height / 2;
      const row = rows.find(
        (line) =>
          line.vertical === vertical &&
          Math.abs(
            center - (vertical ? (line.left + line.right) / 2 : (line.top + line.bottom) / 2),
          ) <
            (vertical
              ? Math.min(r.width, line.right - line.left)
              : Math.min(r.height, line.bottom - line.top)) *
              0.45,
      );

      if (row) {
        row.glyphs.push(glyph);
        row.left = Math.min(row.left, r.left);
        row.right = Math.max(row.right, r.right);
        row.top = Math.min(row.top, r.top);
        row.bottom = Math.max(row.bottom, r.bottom);
      } else {
        rows.push({
          glyphs: [glyph],
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          vertical,
        });
      }
    }
  }

  const lines: TextLine[] = [];

  for (const row of rows) {
    row.glyphs.sort((a, b) => (row.vertical ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
    let group: Glyph[] = [];
    const flush = () => {
      if (!group.length) {
        return;
      }

      lines.push({
        glyphs: group,
        left: Math.min(...group.map((g) => g.rect.left)),
        right: Math.max(...group.map((g) => g.rect.right)),
        top: Math.min(...group.map((g) => g.rect.top)),
        bottom: Math.max(...group.map((g) => g.rect.bottom)),
        vertical: row.vertical,
      });

      group = [];
    };

    for (const glyph of row.glyphs) {
      const previous = group[group.length - 1];

      if (
        previous &&
        (row.vertical
          ? glyph.rect.top - previous.rect.bottom
          : glyph.rect.left - previous.rect.right) >
          (row.vertical ? glyph.rect.width : glyph.rect.height) * 2
      ) {
        flush();
      }

      group.push(glyph);
    }

    flush();
  }

  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function hitText(lines: TextLine[], x: number, y: number, starting = false) {
  let best: { line: number; glyph: number; distance: number } | null = null;

  lines.forEach((line, lineIndex) =>
    line.glyphs.forEach((glyph, index) => {
      const r = glyph.rect;
      const distance = Math.hypot(
        Math.max(r.left - x, 0, x - r.right),
        Math.max(r.top - y, 0, y - r.bottom),
      );

      if (!best || distance < best.distance) {
        best = { line: lineIndex, glyph: index, distance };
      }
    }),
  );

  const result = best as { line: number; glyph: number; distance: number } | null;

  return result && (!starting || result.distance <= 14) ? result : null;
}

export function selectedGlyphs(
  lines: TextLine[],
  anchor: { line: number; glyph: number },
  focus: { line: number; glyph: number },
): Glyph[][] {
  if (anchor.line === focus.line) {
    return [
      lines[anchor.line].glyphs.slice(
        Math.min(anchor.glyph, focus.glyph),
        Math.max(anchor.glyph, focus.glyph) + 1,
      ),
    ];
  }

  const firstIndex = Math.min(anchor.line, focus.line),
    lastIndex = Math.max(anchor.line, focus.line);
  const start = anchor.line < focus.line ? anchor : focus,
    end = anchor.line < focus.line ? focus : anchor;
  const a = lines[start.line],
    b = lines[end.line];

  return lines.slice(firstIndex, lastIndex + 1).flatMap((line, index) => {
    if (index === 0) {
      return [line.glyphs.slice(start.glyph)];
    }

    if (index === lastIndex - firstIndex) {
      return [line.glyphs.slice(0, end.glyph + 1)];
    }

    // Keep intervening lines in the selected column, rather than following PDF object order.
    const overlap =
      Math.min(line.right, Math.max(a.right, b.right)) -
      Math.max(line.left, Math.min(a.left, b.left));

    return overlap >
      Math.min(line.right - line.left, Math.max(a.right - a.left, b.right - b.left)) * 0.5
      ? [line.glyphs]
      : [];
  });
}

export function glyphMarks(groups: Glyph[][], bounds: DOMRect, page: number): Mark[] {
  return groups
    .filter((group) => group.length)
    .map((group) => {
      const left = Math.max(0, Math.min(...group.map((g) => g.rect.left)) - bounds.left);
      const top = Math.max(0, Math.min(...group.map((g) => g.rect.top)) - bounds.top);
      const right = Math.min(
        bounds.width,
        Math.max(...group.map((g) => g.rect.right)) - bounds.left,
      );
      const bottom = Math.min(
        bounds.height,
        Math.max(...group.map((g) => g.rect.bottom)) - bounds.top,
      );

      return {
        id: crypto.randomUUID(),
        page,
        x: left / bounds.width,
        y: top / bounds.height,
        w: (right - left) / bounds.width,
        h: (bottom - top) / bounds.height,
      };
    });
}
