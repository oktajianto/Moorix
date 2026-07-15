import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  PanelsTopLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProfileMenu } from "./ProfileMenu";
import type { Profile, UserProfile } from "../profiles";

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
  onOpenSettings: () => void;
  onLaunchProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
  userProfiles: UserProfile[];
  onLaunchUserProfile: (profile: UserProfile) => void;
};

/**
 * Custom frameless title bar: tab strip + new-tab button + draggable spacer +
 * window controls. Colors follow the app chrome CSS variables (light/dark).
 */
export function TitleBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewTab,
  onOpenSettings,
  onLaunchProfile,
  onManageProfiles,
  userProfiles,
  onLaunchUserProfile,
}: Props) {
  const [profilesOpen, setProfilesOpen] = useState(false);

  // Tab strip paging (Google Sheets style): no scrollbar; when the tabs
  // overflow the available width, prev/next arrows page through them.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setOverflow({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < maxScroll - 1,
    });
  }, []);

  // Recompute on resize and whenever the tab set changes.
  useEffect(() => {
    updateOverflow();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    el.addEventListener("scroll", updateOverflow, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateOverflow);
    };
  }, [updateOverflow, tabs.length]);

  // Keep the active tab within view when it changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
    updateOverflow();
  }, [activeId, updateOverflow]);

  const page = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(el.clientWidth * 0.8, 176),
      behavior: "smooth",
    });
  };

  const hasOverflow = overflow.left || overflow.right;

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-stretch border-b"
      style={{ background: "var(--m-chrome)", borderColor: "var(--m-border)" }}
    >
      {hasOverflow && (
        <ArrowButton
          onClick={() => page(-1)}
          disabled={!overflow.left}
          title="Previous tabs"
        >
          <ChevronLeft className="h-4 w-4" />
        </ArrowButton>
      )}

      <div
        ref={scrollRef}
        onWheel={(e) => {
          // Translate vertical wheel into horizontal tab paging.
          const el = scrollRef.current;
          if (el) el.scrollLeft += e.deltaY + e.deltaX;
        }}
        className="flex min-w-0 items-stretch overflow-x-hidden"
      >
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.id); // middle-click closes
              }}
              className="group flex w-44 shrink-0 items-center gap-2 border-r px-3 text-xs"
              style={{
                borderColor: "var(--m-border)",
                background: active ? "var(--m-bg)" : "transparent",
                color: active ? "var(--m-text)" : "var(--m-muted)",
              }}
            >
              <span className="text-[10px] opacity-60">{i + 1}</span>
              <span className="flex-1 truncate">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded p-0.5 opacity-0 transition hover:bg-black/20 group-hover:opacity-100"
                title="Close tab"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      {hasOverflow && (
        <ArrowButton
          onClick={() => page(1)}
          disabled={!overflow.right}
          title="Next tabs"
        >
          <ChevronRight className="h-4 w-4" />
        </ArrowButton>
      )}

      <button
        onClick={onNewTab}
        className="shrink-0 px-3 text-lg leading-none transition hover:bg-black/10"
        style={{ color: "var(--m-muted)" }}
        title="New tab"
      >
        +
      </button>

      <button
        onClick={() => setProfilesOpen((v) => !v)}
        className="flex shrink-0 items-center px-2 transition hover:bg-black/10"
        style={{ color: "var(--m-muted)" }}
        title="Profiles &amp; connections"
      >
        <PanelsTopLeft className="h-[15px] w-[15px]" />
      </button>

      {profilesOpen && (
        <ProfileMenu
          onClose={() => setProfilesOpen(false)}
          onLaunchProfile={onLaunchProfile}
          onManageProfiles={onManageProfiles}
          userProfiles={userProfiles}
          onLaunchUserProfile={onLaunchUserProfile}
        />
      )}

      {/* Draggable empty area */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Settings + window controls */}
      <div className="flex items-stretch">
        <WindowButton onClick={onOpenSettings} title="Settings">
          <SettingsIcon className="h-[15px] w-[15px]" />
        </WindowButton>
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

function ArrowButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ color: "var(--m-muted)", borderColor: "var(--m-border)" }}
      className="flex w-7 shrink-0 items-center justify-center border-r transition hover:bg-black/10 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
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
      style={{ color: "var(--m-muted)" }}
      className={`flex w-11 items-center justify-center transition hover:text-white ${
        danger ? "hover:bg-red-600" : "hover:bg-black/10"
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
