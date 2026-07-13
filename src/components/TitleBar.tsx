import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export type TabInfo = {
  id: string;
  label: string;
};

type Props = {
  tabs: TabInfo[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
};

/**
 * Custom frameless title bar: tab strip + new-tab button + draggable spacer +
 * window controls. The OS decorations are disabled (`decorations: false`), so
 * this bar is the only chrome.
 */
export function TitleBar({ tabs, activeId, onSelect, onClose, onNewTab }: Props) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-stretch border-b border-neutral-800 bg-neutral-900"
    >
      <div className="flex items-stretch overflow-x-auto">
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.id); // middle-click closes
              }}
              className={`group flex w-44 shrink-0 items-center gap-2 border-r border-neutral-800 px-3 text-xs ${
                active
                  ? "bg-[#0a0a0a] text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              <span className="text-[10px] text-neutral-600">{i + 1}</span>
              <span className="flex-1 truncate">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded p-0.5 text-neutral-500 opacity-0 transition hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
                title="Close tab"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          className="px-3 text-lg leading-none text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
          title="New tab"
        >
          +
        </button>
      </div>

      {/* Draggable empty area */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Window controls */}
      <div className="flex items-stretch">
        <WindowButton onClick={() => appWindow.minimize()} title="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>
        <WindowButton onClick={() => appWindow.toggleMaximize()} title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>
        <WindowButton onClick={() => appWindow.close()} danger title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex w-11 items-center justify-center text-neutral-400 transition hover:text-white ${
        danger ? "hover:bg-red-600" : "hover:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10">
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
