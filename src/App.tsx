import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { TerminalView, type OpenSession } from "./components/TerminalView";
import { Launcher } from "./components/Launcher";

type Tab =
  | { id: string; kind: "launcher" }
  | { id: string; kind: "terminal"; label: string; open: OpenSession };

let counter = 1;
const nextId = () => `tab-${counter++}`;

const FIRST_ID = "tab-0";

function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: FIRST_ID, kind: "launcher" }]);
  const [activeId, setActiveId] = useState(FIRST_ID);

  const newTab = () => {
    const id = nextId();
    setTabs((prev) => [...prev, { id, kind: "launcher" }]);
    setActiveId(id);
  };

  const launchInTab =
    (tabId: string) => (open: OpenSession, label: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { id: tabId, kind: "terminal", label, open } : tab,
        ),
      );
    };

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    let next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
      next = [{ id: nextId(), kind: "launcher" }];
    }
    setTabs(next);
    if (id === activeId) {
      const fallback = next[Math.min(idx, next.length - 1)];
      setActiveId(fallback.id);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TitleBar
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.kind === "terminal" ? t.label : "New tab",
        }))}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNewTab={newTab}
      />

      <main className="relative min-h-0 flex-1 bg-[#0a0a0a]">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0 p-2"
            style={{ display: tab.id === activeId ? "block" : "none" }}
          >
            {tab.kind === "launcher" ? (
              <Launcher onLaunch={launchInTab(tab.id)} />
            ) : (
              <TerminalView open={tab.open} />
            )}
          </div>
        ))}
      </main>
    </div>
  );
}

export default App;
