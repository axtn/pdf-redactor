'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  FileText,
  Fingerprint,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MousePointer2,
  Plus,
  Scan,
  ShieldCheck,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  exportPdf,
  loadPdf,
  preloadRedactionEngine,
  releasePreloadedEngine,
  type Mark,
} from '@/lib/pdf';
import PdfViewer from './pdf-viewer';
import ConfirmationDialog from './confirmation-dialog';

type OpenFile = {
  doc: PDFDocumentProxy;
  name: string;
  bytes: number;
  metadata: [string, string][];
};

export default function Workspace() {
  const [file, setFile] = useState<OpenFile | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<'text' | 'box'>('text');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [removeHiddenInformation, setRemoveHiddenInformation] = useState(true);
  const [undo, setUndo] = useState<Mark[][]>([]);

  const input = useRef<HTMLInputElement>(null);
  const activeDoc = useRef<PDFDocumentProxy | null>(null);
  const mounted = useRef(true);
  const closeButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  const restoreEditorFocus = useCallback(() => {
    const target = closeButton.current ?? chooseButton.current;

    target?.focus();
  }, []);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      releasePreloadedEngine();
      void activeDoc.current?.loadingTask.destroy();
    };
  }, []);

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 800px)');
    const collapse = () => {
      if (narrow.matches) {
        setExpanded(false);
      }
    };

    narrow.addEventListener('change', collapse);

    return () => narrow.removeEventListener('change', collapse);
  }, []);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };

    window.addEventListener('keydown', escape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  async function open(selected?: File) {
    if (!selected || busy) {
      return;
    }

    setError('');
    setNotice('');

    if (selected.size > 100 * 1024 * 1024) {
      setError('Please choose a PDF smaller than 100 MB.');

      return;
    }

    setBusy('Opening your PDF…');
    let doc: PDFDocumentProxy | undefined;

    try {
      doc = await loadPdf(new Uint8Array(await selected.arrayBuffer()));
      const meta = await doc.getMetadata();
      const fields = Object.entries(meta.info as Record<string, unknown>)
        .filter(
          ([key, value]) =>
            ![
              'PDFFormatVersion',
              'IsLinearized',
              'IsAcroFormPresent',
              'IsXFAPresent',
              'IsCollectionPresent',
              'IsSignaturesPresent',
            ].includes(key) &&
            value !== '' &&
            value !== null &&
            value !== undefined,
        )
        .map(
          ([key, value]) =>
            [key, typeof value === 'string' ? value : JSON.stringify(value)] as [string, string],
        );

      if (meta.metadata) {
        fields.push(['XMP metadata', meta.metadata.getRaw()]);
      }

      if (!mounted.current) {
        await doc.loadingTask.destroy();

        return;
      }

      const previous = activeDoc.current;

      activeDoc.current = doc;
      setFile({ doc, name: selected.name, bytes: selected.size, metadata: fields });
      setMarks([]);
      setUndo([]);
      setShowMetadata(false);
      setRemoveHiddenInformation(true);

      void preloadRedactionEngine().catch(() => {
        /* Retry preparation when exporting if the background load fails. */
      });

      await previous?.loadingTask.destroy();
    } catch (err) {
      await doc?.loadingTask.destroy();
      const name = err instanceof Error ? err.name : '';

      setError(
        name === 'PasswordException'
          ? 'This PDF is password protected. Open an unlocked copy to continue.'
          : 'We couldn’t open this PDF. Try an unlocked, valid PDF file.',
      );
    } finally {
      if (mounted.current) {
        setBusy('');
      }

      if (input.current) {
        input.current.value = '';
      }
    }
  }

  function closePdf() {
    setConfirmClose(false);
    releasePreloadedEngine();
    setFile(null);
    setExpanded(false);
    setMarks([]);
    setUndo([]);
    setNotice('');
    setError('');
    void activeDoc.current?.loadingTask.destroy();
    activeDoc.current = null;
  }

  function update(next: Mark[]) {
    setUndo((h) => [...h, marks]);
    setMarks(next);
    setNotice('');
  }

  function undoLast() {
    if (!undo.length) {
      return;
    }

    setMarks(undo[undo.length - 1]);
    setUndo(undo.slice(0, -1));
  }

  async function download() {
    if (!file || busy) {
      return;
    }

    setError('');
    setNotice('');
    setBusy('Preparing your PDF…');

    try {
      const bytes = await exportPdf(
        file.doc,
        marks,
        (page) => setBusy(`Securing page ${page} of ${file.doc.numPages}…`),
        removeHiddenInformation,
      );
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      );
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `${file.name.replace(/\.pdf$/i, '')}-redacted.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      setNotice(
        `${removeHiddenInformation ? 'Your sanitized PDF' : 'Your redacted PDF'} is ready. The original file is unchanged.`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Export failed. No file was downloaded.');
    } finally {
      setBusy('');
    }
  }

  const markPages = new Set(marks.map((m) => m.page)).size;

  return (
    <>
      <header className="topbar" hidden={expanded}>
        <nav className="brand-nav" aria-label="Breadcrumb">
          <a className="brand" href="https://axtn.io" aria-label="axtn.io home">
            <span className="brand-icon">
              <ArrowUpRight size={20} />
            </span>
            axtn.io
          </a>
          <span className="brand-divider" aria-hidden="true">
            /
          </span>
          <span className="brand-product" aria-current="page">
            PDF Redactor
          </span>
        </nav>
        <div className="local-pill">
          <span className="status-dot" />
          <span className="privacy-desktop-label">100% on your device</span>
          <span className="privacy-mobile-label">100% private</span>
          <LockKeyhole size={12} />
        </div>
      </header>
      <main className={expanded ? 'expanded-main' : undefined}>
        <div className="intro">
          <div>
            <h1>
              Private PDF
              <br />
              <span>redaction</span>
            </h1>
            <p>
              Make your PDF safer to share with someone or upload to AI.
              <br />
              Redact sensitive details and remove hidden metadata—all in your browser.
            </p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <div className="art-paper">
              <div className="art-fold" />
              <div className="art-line short" />
              <div className="art-line" />
              <div className="art-redacted" />
              <div className="art-line" />
              <div className="art-line medium" />
              <div className="art-redacted small" />
              <div className="art-line" />
            </div>
            <div className="art-shield">
              <ShieldCheck size={34} strokeWidth={1.4} />
            </div>
            <span className="art-spark">✦</span>
          </div>
        </div>
        <section className="workspace">
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden-input"
            aria-label="Choose PDF"
            onChange={(e) => void open(e.target.files?.[0])}
          />
          {!file ? (
            <div
              className={`dropzone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void open(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-illustration">
                <FileText size={31} strokeWidth={1.3} />
                <span>
                  <Plus size={13} />
                </span>
              </div>
              <h3>Redact your PDF</h3>
              <p>Drop your document here, or choose a file to get started.</p>
              <button
                ref={chooseButton}
                className="primary-button"
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                {busy || 'Choose a PDF'}
                <ArrowRight size={16} />
              </button>
              <span className="file-hint">PDF files up to 100 MB</span>
              <div className="dropzone-privacy">
                <LockKeyhole size={13} />
                Your files never leave this browser.
              </div>
            </div>
          ) : (
            <div className="editor">
              <div className="document-bar">
                <FileText size={20} />
                <div>
                  <div className="document-title">
                    <strong>{file.name}</strong>
                    <span className="document-page-count">
                      {file.doc.numPages} {file.doc.numPages === 1 ? 'page' : 'pages'}
                    </span>
                  </div>
                  <span>{(file.bytes / 1024 / 1024).toFixed(2)} MB · Original stays untouched</span>
                </div>
                <button
                  ref={closeButton}
                  className="close-button"
                  aria-label="Close PDF"
                  disabled={!!busy}
                  onClick={() => setConfirmClose(true)}
                >
                  <X size={17} />
                  Close PDF
                </button>
                <button
                  className="expand-button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  {expanded ? 'Exit expanded editor' : 'Expand editor'}
                </button>
              </div>
              <div className="editor-grid">
                <div className="document-view">
                  <div className="toolbar">
                    <div className="tool-group">
                      <button
                        className={tool === 'text' ? 'active' : ''}
                        disabled={!!busy}
                        onClick={() => setTool('text')}
                      >
                        <MousePointer2 size={15} />
                        Select text
                      </button>
                      <button
                        className={tool === 'box' ? 'active' : ''}
                        disabled={!!busy}
                        onClick={() => setTool('box')}
                      >
                        <SquareDashed size={15} />
                        Draw a box
                      </button>
                    </div>
                    <div className="edit-actions">
                      <button
                        className="clear-button"
                        disabled={!marks.length || !!busy}
                        onClick={() => {
                          update([]);
                          requestAnimationFrame(() => undoButton.current?.focus());
                        }}
                      >
                        <Trash2 size={15} />
                        Clear all marks
                      </button>
                      <button
                        ref={undoButton}
                        className="undo-button"
                        title="Undo last edit"
                        aria-label="Undo last edit"
                        disabled={!undo.length || !!busy}
                        onClick={undoLast}
                      >
                        <Undo2 size={17} />
                        Undo
                      </button>
                    </div>
                  </div>
                  <p className="tool-tip">
                    {tool === 'text'
                      ? 'Drag across text or double-click a word to mark it. For scans, draw a box.'
                      : 'Drag a box over any text, image, or detail to redact it.'}
                  </p>
                  <PdfViewer
                    key={file.doc.fingerprints[0]}
                    doc={file.doc}
                    marks={marks}
                    tool={tool}
                    busy={!!busy}
                    addMarks={(newMarks) => {
                      if (newMarks.length && !busy) {
                        update([...marks, ...newMarks]);
                      }
                    }}
                  />
                </div>
                <aside className="export-panel" hidden={expanded}>
                  <div className="sanitize-card">
                    <input
                      id="remove-hidden-information"
                      type="checkbox"
                      checked={removeHiddenInformation}
                      disabled={!!busy}
                      onChange={(event) => setRemoveHiddenInformation(event.target.checked)}
                      aria-describedby="sanitize-description"
                    />
                    <div>
                      <label htmlFor="remove-hidden-information">Remove hidden information</label>
                      <p id="sanitize-description">
                        {removeHiddenInformation
                          ? 'Remove original document metadata. Attachments, scripts, and interactive forms are excluded from every export. Visible form values remain unless redacted.'
                          : 'Keep original document metadata, which may contain sensitive details. Attachments, scripts, and interactive forms are still excluded.'}
                      </p>
                    </div>
                  </div>
                  <div className="metadata-inspector">
                    <button
                      className="metadata-toggle"
                      onClick={() => setShowMetadata(!showMetadata)}
                    >
                      <Fingerprint size={15} />
                      Inspect original metadata
                      <ChevronRight size={14} className={showMetadata ? 'rotated' : ''} />
                    </button>
                    {showMetadata && (
                      <div className="metadata">
                        {file.metadata.length ? (
                          file.metadata.map(([key, value]) => (
                            <div key={key}>
                              <strong>{key}</strong>
                              <p>{value}</p>
                            </div>
                          ))
                        ) : (
                          <p>
                            No document information or XMP metadata was found. Other hidden
                            structures may still exist.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="redaction-summary">
                    <span>Redaction marks</span>
                    <strong>{marks.length}</strong>
                  </div>
                  <p className="small-note">
                    {markPages
                      ? `Across ${markPages} ${markPages === 1 ? 'page' : 'pages'}. Marks become permanent in the downloaded file.`
                      : 'No marks yet. You can still export to remove hidden information.'}
                  </p>

                  <div className="export-note">
                    <Scan size={17} />
                    <p>
                      <strong>Text stays text.</strong>Redacted content is removed. Other text
                      remains selectable and graphics stay sharp. Links, editable forms, signatures,
                      and accessibility tags won’t carry over. Intersecting vector shapes may be
                      removed entirely.
                    </p>
                  </div>
                  <button
                    className="primary-button download-button"
                    disabled={!!busy}
                    onClick={() => void download()}
                  >
                    <ArrowDownToLine size={16} />
                    {busy || 'Download redacted PDF'}
                  </button>
                  <p className="review-note">Review every page before sharing.</p>
                </aside>
              </div>
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCheck size={16} />
              {notice}
            </div>
          )}
        </section>
      </main>
      {confirmClose && (
        <ConfirmationDialog
          title="Close this PDF?"
          description={
            marks.length
              ? `Your ${marks.length === 1 ? 'redaction mark will' : `${marks.length} redaction marks will`} be lost unless you download the edited PDF first. The original file stays unchanged.`
              : 'This removes the PDF from your workspace. The original file stays unchanged.'
          }
          confirmLabel="Close PDF"
          dismissLabel="Cancel closing PDF"
          icon={<FileText size={22} />}
          onDismiss={() => setConfirmClose(false)}
          onConfirm={closePdf}
          onRestoreFocus={restoreEditorFocus}
        />
      )}
      <footer hidden={expanded}>
        <span>
          free tool by{' '}
          <a href="https://axtn.io">
            Alex Tadevosyan <ArrowUpRight size={11} />
          </a>
        </span>
        <div className="footer-links">
          <a href="https://github.com/axtn/pdf-redactor">Source</a>
          <a href="/licenses/LICENSE.txt">AGPL license</a>
          <details className="privacy-policy">
            <summary>Privacy policy</summary>
            <p>
              Your PDFs are never uploaded. All editing and redaction happens in your browser, and
              your documents stay on your device. We do not use analytics, cookies, or tracking of
              any kind. Your PDFs and edits are not saved by this app.
            </p>
          </details>
        </div>
      </footer>
    </>
  );
}
