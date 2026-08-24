/**
 * In-app alert/confirm that grows with the message.
 * Native window.alert/confirm are height-capped by the browser and add a
 * scrollbar even when the page has room — that hid Push / Refetch / heal copy.
 *
 * The overlay may scroll if the dialog is taller than the viewport; the panel
 * itself does not clip to a small max-height.
 */
const OVERLAY_ID_PREFIX = "gittr-app-dialog-";

/** Overlay may scroll when the page is shorter than the message; the panel does not clip. */
export const APP_DIALOG_OVERLAY_CLASS =
  "fixed inset-0 z-[200] overflow-y-auto bg-black/70";
export const APP_DIALOG_PANEL_CLASS =
  "w-full max-w-lg rounded-lg border border-[#383B42] bg-[#0E1116] p-6 text-gray-200 shadow-xl";

let dialogSeq = 0;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function escapeAppDialogText(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function finish(overlay: HTMLElement, onDone: () => void): void {
  try {
    overlay.remove();
  } catch {
    /* ignore */
  }
  onDone();
}

function showPanel(opts: {
  message: string;
  mode: "alert" | "confirm";
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(opts.mode !== "confirm");
      return;
    }

    const id = `${OVERLAY_ID_PREFIX}${++dialogSeq}`;
    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.className = APP_DIALOG_OVERLAY_CLASS;
    overlay.setAttribute("role", "presentation");

    const wrap = document.createElement("div");
    wrap.className = "flex min-h-full items-center justify-center p-4";

    const panel = document.createElement("div");
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", `${id}-title`);
    panel.setAttribute("aria-describedby", `${id}-body`);
    panel.className = APP_DIALOG_PANEL_CLASS;

    const titleText =
      opts.title || (opts.mode === "confirm" ? "Confirm" : "Notice");
    const title = document.createElement("h2");
    title.id = `${id}-title`;
    title.className = "mb-3 text-lg font-semibold text-white";
    title.textContent = titleText;

    const body = document.createElement("div");
    body.id = `${id}-body`;
    body.className =
      "whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200";
    body.textContent = opts.message;

    const actions = document.createElement("div");
    actions.className = "mt-5 flex flex-wrap justify-end gap-2";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className =
      "rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700";
    ok.textContent = opts.okLabel || "OK";

    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      finish(overlay, () => resolve(value));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      }
    };

    ok.addEventListener("click", () => settle(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === wrap) {
        settle(opts.mode !== "confirm");
      }
    });
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        settle(opts.mode !== "confirm");
      }
    });

    if (opts.mode === "confirm") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className =
        "rounded border border-[#383B42] bg-[#171B21] px-4 py-2 text-sm text-gray-200 hover:bg-[#22262C]";
      cancel.textContent = opts.cancelLabel || "Cancel";
      cancel.addEventListener("click", () => settle(false));
      actions.appendChild(cancel);
    }
    actions.appendChild(ok);

    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(actions);
    wrap.appendChild(panel);
    overlay.appendChild(wrap);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    ok.focus();
  });
}

/** Blocking-style alert that sizes to the full message. */
export function appAlert(message: string, title?: string): Promise<void> {
  return enqueue(async () => {
    await showPanel({ message, mode: "alert", title });
  });
}

/** Blocking-style confirm that sizes to the full message. */
export function appConfirm(message: string, title?: string): Promise<boolean> {
  return enqueue(() =>
    showPanel({ message, mode: "confirm", title, okLabel: "OK" })
  );
}
