'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Minus, Plus } from 'lucide-react';
import type { Mark } from '@/lib/pdf';
import PdfPage from './pdf-page';

type Point = { x: number; y: number };
type Anchor = Point & { page?: HTMLElement; position?: Point };
type Pinch = { distance: number; scale: number; anchor: Anchor };

function scrollToAnchor(element: HTMLElement, anchor: Anchor, center: Point, zoom: number) {
  if (anchor.page?.isConnected && anchor.position) {
    const rect = anchor.page.getBoundingClientRect();

    element.scrollLeft += rect.left + rect.width * anchor.position.x - center.x;
    element.scrollTop += rect.top + rect.height * anchor.position.y - center.y;
  } else {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    element.scrollLeft = anchor.x * zoom + parseFloat(style.paddingLeft) - (center.x - rect.left);
    element.scrollTop = anchor.y * zoom + parseFloat(style.paddingTop) - (center.y - rect.top);
  }
}

type Pan = { id: number; point: Point; scroll: Point; pageScroll: boolean };

export default function PdfViewer({
  doc,
  marks,
  tool,
  busy,
  addMarks,
}: {
  doc: PDFDocumentProxy;
  marks: Mark[];
  tool: 'text' | 'box';
  busy: boolean;
  addMarks: (marks: Mark[]) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoomState, setZoomState] = useState({ value: 1 });
  const zoom = zoomState.value;
  const [width, setWidth] = useState(0);
  const scale = useRef(1);
  const touches = useRef(new Map<number, Point>());
  const cancellations = useRef(new Map<number, () => void>());
  const pinch = useRef<Pinch | null>(null);
  const pan = useRef<Pan | null>(null);
  const navigating = useRef(false);
  const lastNavigation = useRef(-Infinity);
  const pendingScroll = useRef<{ anchor: Anchor; center: Point; zoom: number } | null>(null);

  const registerCancellation = useCallback((page: number, cancel: (() => void) | null) => {
    if (cancel) {
      cancellations.current.set(page, cancel);
    } else {
      cancellations.current.delete(page);
    }
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      const style = getComputedStyle(element);

      setWidth(
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current && viewport.current) {
      const { anchor, center, zoom } = pendingScroll.current;

      scrollToAnchor(viewport.current, anchor, center, zoom);
      pendingScroll.current = null;
    }
  }, [zoomState]);

  function cancelEditing() {
    for (const cancel of cancellations.current.values()) {
      cancel();
    }

    window.getSelection()?.removeAllRanges();
  }

  function centerAndDistance() {
    const [a, b] = Array.from(touches.current.values());

    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  function contentPoint(point: Point): Anchor {
    const element = viewport.current!,
      rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const anchor: Anchor = {
      x: (element.scrollLeft + point.x - rect.left - parseFloat(style.paddingLeft)) / scale.current,
      y: (element.scrollTop + point.y - rect.top - parseFloat(style.paddingTop)) / scale.current,
    };
    const page = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.pdf-page');

    if (page && element.contains(page)) {
      const bounds = page.getBoundingClientRect();

      anchor.page = page;

      anchor.position = {
        x: (point.x - bounds.left) / bounds.width,
        y: (point.y - bounds.top) / bounds.height,
      };
    }

    return anchor;
  }

  function beginPinch() {
    const { center, distance } = centerAndDistance();

    pinch.current = {
      distance: Math.max(distance, 1),
      scale: scale.current,
      anchor: contentPoint(center),
    };

    pan.current = null;
    navigating.current = true;
    cancelEditing();

    for (const id of touches.current.keys()) {
      viewport.current!.setPointerCapture(id);
    }
  }

  function applyZoom(value: number, anchor: Anchor, center: Point) {
    const element = viewport.current!;
    const next = Math.max(1, Math.min(4, value));

    if (Math.abs(next - scale.current) < 0.0001) {
      scrollToAnchor(element, anchor, center, next);
    } else {
      scale.current = next;
      pendingScroll.current = { anchor, center, zoom: next };

      // Preserve panning even when batched pointer moves end at the same zoom.
      setZoomState({ value: next });
    }
  }

  function zoomButton(value: number) {
    cancelEditing();
    lastNavigation.current = -Infinity;
    const rect = viewport.current!.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    applyZoom(value, contentPoint(center), center);
  }

  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || busy) {
      return;
    }

    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (touches.current.size >= 2) {
      event.preventDefault();
      event.stopPropagation();
      beginPinch();

      return;
    }

    // A single finger on text/box mode still edits; blank-page drags scroll.
    const target = event.target as HTMLElement;

    if (target.closest('.pdf-page') && (tool === 'box' || target.closest('.textLayer span'))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    navigating.current = true;

    pan.current = {
      id: event.pointerId,
      point: { x: event.clientX, y: event.clientY },
      scroll: { x: viewport.current!.scrollLeft, y: viewport.current!.scrollTop },
      pageScroll: true,
    };

    viewport.current!.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!touches.current.has(event.pointerId)) {
      return;
    }

    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (!navigating.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (pinch.current && touches.current.size >= 2) {
      const { center, distance } = centerAndDistance();

      applyZoom(
        (pinch.current.scale * distance) / pinch.current.distance,
        pinch.current.anchor,
        center,
      );
    } else if (pan.current?.id === event.pointerId) {
      const element = viewport.current!;
      const deltaX = pan.current.point.x - event.clientX;
      const deltaY = pan.current.point.y - event.clientY;
      const beforeY = element.scrollTop;

      element.scrollLeft += deltaX;
      element.scrollTop += deltaY;

      if (pan.current.pageScroll) {
        window.scrollBy(0, deltaY - (element.scrollTop - beforeY));
      }

      pan.current.point = { x: event.clientX, y: event.clientY };
      pan.current.scroll = { x: element.scrollLeft, y: element.scrollTop };
    }
  }

  function end(event: React.PointerEvent<HTMLDivElement>) {
    if (!touches.current.has(event.pointerId)) {
      return;
    }

    touches.current.delete(event.pointerId);

    if (!navigating.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    lastNavigation.current = performance.now();

    if (touches.current.size >= 2) {
      beginPinch();
    } else {
      pinch.current = null;
      const remaining = Array.from(touches.current.entries())[0];

      pan.current = remaining
        ? {
            id: remaining[0],
            point: remaining[1],
            scroll: { x: viewport.current!.scrollLeft, y: viewport.current!.scrollTop },
            pageScroll: false,
          }
        : null;

      if (!remaining) {
        navigating.current = false;
      }
    }
  }

  return (
    <div className="pdf-viewer">
      <div className="viewer-controls" role="group" aria-label="PDF zoom controls">
        <span className="touch-zoom-hint">Pinch to zoom · two fingers to move</span>
        <button
          className="icon-button"
          aria-label="Zoom out PDF"
          disabled={zoom <= 1 || busy}
          onClick={() => zoomButton(zoom - 0.25)}
        >
          <Minus size={15} />
        </button>
        <button
          className="zoom-reset"
          aria-label={`Fit PDF to viewer. Current zoom: ${Math.round(zoom * 100)}%`}
          disabled={busy}
          onClick={() => zoomButton(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in PDF"
          disabled={zoom >= 4 || busy}
          onClick={() => zoomButton(zoom + 0.25)}
        >
          <Plus size={15} />
        </button>
      </div>
      <div
        ref={viewport}
        className={`pages ${busy ? 'locked' : ''}`}
        onPointerDownCapture={down}
        onPointerMoveCapture={move}
        onPointerUpCapture={end}
        onPointerCancelCapture={end}
        onDoubleClickCapture={(event) => {
          if (performance.now() - lastNavigation.current < 500) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="pdf-pages-content" style={{ width: width ? width * zoom : '100%' }}>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              doc={doc}
              number={i + 1}
              marks={marks.filter((mark) => mark.page === i + 1)}
              tool={tool}
              addMarks={addMarks}
              registerCancellation={registerCancellation}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
