import { useState } from "react";
import { TerminalView, type OpenSession } from "./components/TerminalView";
import { Launcher } from "./components/Launcher";

type ActiveSession = { open: OpenSession; label: string };

function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="font-semibold text-cyan-400">Moorix</span>
        {session && (
          <>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-400">{session.label}</span>
            <button
              onClick={() => setSession(null)}
              className="ml-auto rounded bg-neutral-800 px-2 py-1 text-neutral-300 transition hover:bg-neutral-700"
            >
              Disconnect
            </button>
          </>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-hidden bg-[#0a0a0a] p-2">
        {session ? (
          <TerminalView open={session.open} />
        ) : (
          <Launcher onLaunch={(open, label) => setSession({ open, label })} />
        )}
      </main>
    </div>
  );
}

export default App;
