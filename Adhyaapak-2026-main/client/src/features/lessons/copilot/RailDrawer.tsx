import { useEffect, useRef, type ReactNode } from "react";

/**
 * The classroom intelligence rail, as a drawer. It slides in beside the canvas without moving the lesson, closes with
 * Escape or its button, and returns focus to whatever opened it. Motion is a short slide and is removed when the
 * operating system asks for reduced motion (see app.css).
 */
export function RailDrawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <aside ref={ref} tabIndex={-1} className={open ? "rail-drawer is-open" : "rail-drawer"} aria-label={title} aria-hidden={!open} hidden={!open && undefined}>
      {open && (
        <>
          <div className="rail-drawer-head">
            <h2 style={{ margin: 0, fontSize: "var(--fs-m)" }}>{title}</h2>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="rail-drawer-body">{children}</div>
        </>
      )}
    </aside>
  );
}
