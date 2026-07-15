import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastVariant = "info" | "success" | "error";

export type Toast = {
  id: string;
  title: string;
  message?: string;
  /** 0..1 for a determinate bar, `null` for indeterminate, omit for no bar. */
  progress?: number | null;
  variant?: ToastVariant;
  /** Auto-dismiss after N ms. `0` (or omitted with a progress bar) = sticky. */
  duration?: number;
};

export type ToastApi = {
  show: (t: Omit<Toast, "id"> & { id?: string }) => string;
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;
const nextId = () => `toast-${++seq}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const arm = useCallback(
    (id: string, duration?: number) => {
      const existing = timers.current.get(id);
      if (existing) {
        clearTimeout(existing);
        timers.current.delete(id);
      }
      if (duration && duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const show = useCallback<ToastApi["show"]>(
    (t) => {
      const id = t.id ?? nextId();
      setToasts((prev) => {
        const toast: Toast = { ...t, id };
        const rest = prev.filter((x) => x.id !== id);
        return [...rest, toast];
      });
      arm(id, t.duration);
      return id;
    },
    [arm],
  );

  const update = useCallback<ToastApi["update"]>(
    (id, patch) => {
      setToasts((prev) =>
        prev.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      );
      if ("duration" in patch) arm(id, patch.duration);
    },
    [arm],
  );

  return (
    <ToastContext.Provider value={{ show, update, dismiss }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const variant = toast.variant ?? "info";
  const accent =
    variant === "success" ? "#22c55e" : variant === "error" ? "#ef4444" : "#3b82f6";
  const Icon =
    variant === "success" ? CheckCircle2 : variant === "error" ? AlertCircle : Info;
  const hasBar = toast.progress !== undefined;
  const pct =
    toast.progress === null || toast.progress === undefined
      ? null
      : Math.max(0, Math.min(1, toast.progress));

  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-lg border shadow-xl"
      style={{ background: "var(--m-panel)", borderColor: "var(--m-border)" }}
    >
      <div className="flex items-start gap-3 p-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: "var(--m-text)" }}>
            {toast.title}
          </div>
          {toast.message && (
            <div className="mt-0.5 break-words text-xs" style={{ color: "var(--m-muted)" }}>
              {toast.message}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 opacity-60 transition hover:opacity-100"
          style={{ color: "var(--m-muted)" }}
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hasBar && (
        <div className="h-1 w-full" style={{ background: "var(--m-input)" }}>
          {pct === null ? (
            <div className="moorix-toast-indeterminate h-full" style={{ background: accent }} />
          ) : (
            <div
              className="h-full transition-[width] duration-150"
              style={{ width: `${pct * 100}%`, background: accent }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
