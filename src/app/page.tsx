"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import { ChatFolder, ChatThread } from "@/types";


const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", desc: "Fast & capable" },
  { id: "claude-opus-4-6", label: "Opus 4.6", desc: "Most capable" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", desc: "Fastest" },
];

export default function Home() {
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [model, setModel] = useState("claude-sonnet-4-6");

  // Persist model selection
  useEffect(() => {
    const saved = localStorage.getItem("vidhi-model");
    if (saved && AVAILABLE_MODELS.some((m) => m.id === saved)) {
      setModel(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("vidhi-model", model);
  }, [model]);

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

  async function createThread(folderId?: string): Promise<ChatThread | null> {
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Failed to create thread:", res.status, err);
        return null;
      }
      const thread: ChatThread = await res.json();
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      return thread;
    } catch (err) {
      console.error("Failed to create thread:", err);
      return null;
    }
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
        onGoHome={() => setActiveThreadId(null)}
      />

      <main
        className="flex-1 flex flex-col min-w-0 transition-all duration-200"
        style={{ background: "var(--bg-primary)" }}
      >
        {activeThread ? (
          <ChatWindow
            key={activeThread.id}
            thread={activeThread}
            initialMessage={pendingMessage}
            onMessageSent={() => setPendingMessage(null)}
            onThreadUpdate={(updated) =>
              setThreads((prev) =>
                prev.map((t) => (t.id === updated.id ? updated : t))
              )
            }
            model={model}
            onModelChange={setModel}
            availableModels={AVAILABLE_MODELS}
          />
        ) : (
          <WelcomeScreen
            onNewChat={async (suggestion?: string) => {
              const thread = await createThread();
              if (thread && suggestion) {
                setPendingMessage(suggestion);
              }
            }}
            model={model}
            onModelChange={setModel}
            availableModels={AVAILABLE_MODELS}
          />
        )}
      </main>
    </div>
  );
}

interface ModelOption {
  id: string;
  label: string;
  desc: string;
}

function WelcomeScreen({
  onNewChat,
  model,
  onModelChange,
  availableModels,
}: {
  onNewChat: (suggestion?: string) => void;
  model: string;
  onModelChange: (m: string) => void;
  availableModels: ModelOption[];
}) {
  const suggestions = [
    "What does Jupiter in Taurus mean for Bitcoin in 2025?",
    "Analyze Saturn retrograde periods and crypto market corrections",
    "Show me Rahu/Ketu axis shifts from 2020-2031 and their market implications",
    "What are the most auspicious periods to buy BTC based on planetary transits?",
  ];

  const planets = ["\u2609", "\u263D", "\u2642", "\u263F", "\u2643", "\u2640", "\u2644", "\u260A", "\u260B"];

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center p-8 gap-8 overflow-hidden">
      {/* Aurora fluorescent background */}
      <div className="aurora-bg">
        <div className="aurora-orb aurora-1" />
        <div className="aurora-orb aurora-2" />
        <div className="aurora-orb aurora-3" />
        <div className="aurora-grid" />
      </div>

      {/* Model selector */}
      <div className="absolute top-4 right-6 z-10">
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="model-select rounded-lg px-3 py-1.5 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id} style={{ background: "var(--bg-card)" }}>
              {m.label} — {m.desc}
            </option>
          ))}
        </select>
      </div>

      <div className="text-center relative z-10">
        <h1 className="text-6xl mb-2">
          <span className="vidhi-aero" data-text="Vidhi">Vidhi</span>
        </h1>
      </div>

      <div className="flex gap-3 relative z-10">
        {planets.map((symbol, i) => (
          <span
            key={i}
            className="w-10 h-10 flex items-center justify-center rounded-full text-lg liquid-glass"
            style={{ color: "var(--purple-light)" }}
          >
            {symbol}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full relative z-10">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onNewChat(s)}
            className="text-left p-4 rounded-xl text-sm liquid-glass-card"
            style={{ color: "var(--text-secondary)" }}
          >
            {s}
          </button>
        ))}
      </div>

      <button
        onClick={() => onNewChat()}
        className="px-8 py-3 rounded-full font-semibold text-white liquid-glass-btn relative z-10"
        style={{ background: "rgba(168, 85, 247, 0.3)" }}
      >
        Start New Chat
      </button>
    </div>
  );
}
