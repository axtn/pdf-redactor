'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  dismissLabel: string;
  icon: ReactNode;
  onDismiss: () => void;
  onConfirm: () => void;
  onRestoreFocus: () => void;
};

export default function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  dismissLabel,
  icon,
  onDismiss,
  onConfirm,
  onRestoreFocus,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const backdropPress = useRef(false);

  useEffect(() => {
    const element = dialog.current!;

    element.showModal();
    cancel.current?.focus();

    return () => {
      element.close();
      requestAnimationFrame(onRestoreFocus);
    };
  }, [onRestoreFocus]);

  return createPortal(
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();

          return;
        }

        if (event.key !== 'Tab') {
          return;
        }

        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();

        backdropPress.current =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={() => {
        if (backdropPress.current) {
          backdropPress.current = false;
          onDismiss();
        }
      }}
    >
      <button className="icon-button dialog-close" aria-label={dismissLabel} onClick={onDismiss}>
        <X size={18} />
      </button>
      <div className="dialog-symbol" aria-hidden="true">
        {icon}
      </div>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="dialog-actions">
        <button className="dialog-confirm-button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button ref={cancel} className="primary-button" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
