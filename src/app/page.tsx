"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { ChatFolder, ChatThread } from "@/types";

export default function Home() {
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    loadSidebarData();
  }, []);

  async function loadSidebarData() {
    const [foldersRes, threadsRes] = await Promise.all([
      fetch("/api/folders"),
      fetch("/api/threads"),
    ]);
    const foldersData: ChatFolder[] = await foldersRes.json();
    const threadsData: ChatThread[] = await threadsRes.json();
    setFolders(foldersData);
    setThreads(threadsData);
  }

  async function createThread(folderId?: string) {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    const thread: ChatThread = await res.json();
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    return thread;
  }

  async function createFolder(name: string) {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder: ChatFolder = await res.json();
    setFolders((prev) => [folder, ...prev]);
  }

  async function deleteThread(id: string) {
    await fetch(`/api/threads/${id}`, { method: "DELETE" });
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
  }

  async function deleteFolder(id: string) {
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
    setFolders((prev) => prev.filter((f) => f.id !== id));
    await loadSidebarData();
  }

  async function renameThread(id: string, title: string) {
    await fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  async function renameFolder(id: string, name: string) {
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  }

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <Sidebar
        folders={folders}
        threads={threads}
        activeThreadId={activeThreadId}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelectThread={setActiveThreadId}
        onCreateThread={createThread}
        onCreateFolder={createFolder}
        onDeleteThread={deleteThread}
        onDeleteFolder={deleteFolder}
        onRenameThread={renameThread}
        onRenameFolder={renameFolder}
      />

      <main
        className="flex-1 flex flex-col min-w-0 transition-all duration-200"
        style={{ background: "var(--bg-primary)" }}
      >
        {activeThread ? (
          <ChatWindow
            thread={activeThread}
            onThreadUpdate={(updated) =>
              setThreads((prev) =>
                prev.map((t) => (t.id === updated.id ? updated : t))
              )
            }
          />
        ) : (
          <WelcomeScreen onNewChat={() => createThread()} />
        )}
      </main>
    </div>
  );
}

function WelcomeScreen({ onNewChat }: { onNewChat: () => void }) {
  const suggestions = [
    "What does Jupiter in Taurus mean for Bitcoin in 2025?",
    "Analyze Saturn retrograde periods and crypto market corrections",
    "Show me Rahu/Ketu axis shifts from 2020–2031 and their market implications",
    "What are the most auspicious periods to buy BTC based on planetary transits?",
  ];

  const planets = ["☉", "☽", "♂", "☿", "♃", "♀", "♄", "☊", "☋"];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold gradient-text mb-2">Vidhi</h1>
        <p className="text-lg" style={{ color: "var(--text-secondary)" }}>
          Vedic Astrology × Investment Intelligence
        </p>
      </div>

      <div className="flex gap-3">
        {planets.map((symbol, i) => (
          <span
            key={i}
            className="w-10 h-10 flex items-center justify-center rounded-full text-lg"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              color: "var(--purple-light)",
            }}
          >
            {symbol}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={onNewChat}
            className="text-left p-4 rounded-xl text-sm transition-all duration-150"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--purple-primary)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--border-subtle)";
              el.style.color = "var(--text-secondary)";
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <button
        onClick={onNewChat}
        className="px-8 py-3 rounded-full font-semibold text-white transition-all duration-150 glow-purple"
        style={{ background: "var(--purple-primary)" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--purple-light)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--purple-primary)";
        }}
      >
        Start New Chat
      </button>
    </div>
  );
}
