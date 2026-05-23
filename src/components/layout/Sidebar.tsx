"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChatFolder, ChatThread } from "@/types";
import { formatDateTime } from "@/lib/utils";

function ImportButton({ label, endpoint, title }: { label: string; endpoint: string; title: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setMessage("Importing…");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(endpoint, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.details || data.error || "Import failed");
      } else {
        setStatus("done");
        // Find the "Saved:" summary line, fall back to last non-empty line
        const lines: string[] = (data.output as string).split("\n").filter(Boolean);
        const saved = lines.find(l => l.startsWith("Saved:")) ?? lines[lines.length - 1] ?? "Done";
        setMessage(saved);
      }
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const color =
    status === "done"     ? "var(--purple-light)" :
    status === "error"    ? "#f87171" :
    "var(--text-muted)";

  return (
    <div>
      <input ref={inputRef} type="file" accept=".csv,.numbers,.tsv,.txt" className="hidden" onChange={handleFile} />
      <button
        onClick={() => { setStatus("idle"); setMessage(""); inputRef.current?.click(); }}
        disabled={status === "uploading"}
        className="w-full text-left text-xs transition-all liquid-glass-item px-1 py-1 rounded"
        style={{ color, opacity: status === "uploading" ? 0.6 : 1 }}
        title={title}
      >
        {status === "uploading" ? "⏳ Importing…" : label}
      </button>
      {message && (
        <div className="text-xs mt-1 px-1 leading-snug" style={{ color }}>
          {message}
        </div>
      )}
    </div>
  );
}

function BtcImportButton() {
  return <ImportButton label="⬆ Import BTC Data" endpoint="/api/import-btc" title="Import Bitcoin historical data (.csv or .numbers)" />;
}

interface SidebarProps {
  folders: ChatFolder[];
  threads: ChatThread[];
  activeThreadId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onSelectThread: (id: string) => void;
  onCreateThread: (folderId?: string) => void;
  onCreateFolder: (name: string) => void;
  onDeleteThread: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveThread: (threadId: string, folderId: string | null) => void;
  onGoHome: () => void;
}

/** Dropdown that portals to <body> and positions itself to the right of the trigger button */
function DotsMenu({
  onRename,
  onDelete,
  folders,
  currentFolderId,
  onMoveToFolder,
}: {
  onRename: () => void;
  onDelete: () => void;
  folders?: ChatFolder[];
  currentFolderId?: string | null;
  onMoveToFolder?: (folderId: string | null) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [showFolders, setShowFolders] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setPos(null);
        setShowFolders(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pos]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) { setPos(null); setShowFolders(false); return; }
    const rect = btnRef.current!.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.right + 6 });
    setShowFolders(false);
  }

  function close() { setPos(null); setShowFolders(false); }

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        className="thread-dots opacity-0 group-hover:opacity-100 p-1 rounded"
        style={{ color: "var(--text-muted)", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}
        title="Options"
      >
        &#8943;
      </button>

      {pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] rounded-xl py-1 shadow-2xl"
          style={{
            top: pos.top,
            left: pos.left,
            minWidth: 160,
            background: "rgba(18, 18, 18, 0.97)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-xs transition-all liquid-glass-item"
            style={{ color: "var(--text-primary)" }}
            onClick={() => { close(); onRename(); }}
          >
            ✏️ Rename
          </button>

          {onMoveToFolder && folders !== undefined && (
            <>
              <button
                className="w-full text-left px-4 py-2 text-xs transition-all liquid-glass-item flex items-center justify-between"
                style={{ color: "var(--text-primary)" }}
                onClick={() => setShowFolders((v) => !v)}
              >
                <span>📁 Move to folder</span>
                <span style={{ opacity: 0.5 }}>{showFolders ? "▴" : "▾"}</span>
              </button>

              {showFolders && (
                <div
                  className="mx-2 mb-1 rounded-lg overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {currentFolderId && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs transition-all liquid-glass-item"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => { close(); onMoveToFolder(null); }}
                    >
                      ✕ Remove from folder
                    </button>
                  )}
                  {folders.length === 0 && (
                    <div className="px-3 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      No folders yet
                    </div>
                  )}
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      className="w-full text-left px-3 py-1.5 text-xs transition-all liquid-glass-item"
                      style={{
                        color: f.id === currentFolderId ? "var(--purple-light)" : "var(--text-primary)",
                        fontWeight: f.id === currentFolderId ? 600 : 400,
                      }}
                      onClick={() => { close(); onMoveToFolder(f.id); }}
                    >
                      {f.id === currentFolderId ? "✓ " : ""}{f.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <button
            className="w-full text-left px-4 py-2 text-xs transition-all liquid-glass-item"
            style={{ color: "var(--red)" }}
            onClick={() => { close(); onDelete(); }}
          >
            🗑️ Delete
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

export default function Sidebar({
  folders,
  threads,
  activeThreadId,
  isOpen,
  onToggle,
  onSelectThread,
  onCreateThread,
  onCreateFolder,
  onDeleteThread,
  onDeleteFolder,
  onRenameThread,
  onRenameFolder,
  onMoveThread,
  onGoHome,
}: SidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const loosThreads = threads.filter((t) => !t.folderId);

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startRename(type: "thread" | "folder", id: string, currentName: string) {
    setEditingId(`${type}:${id}`);
    setEditingValue(currentName);
  }

  function commitRename(type: "thread" | "folder", id: string) {
    if (editingValue.trim()) {
      if (type === "thread") onRenameThread(id, editingValue.trim());
      else onRenameFolder(id, editingValue.trim());
    }
    setEditingId(null);
  }

  function handleCreateFolder() {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName("");
      setNewFolderMode(false);
    }
  }

  return (
    <div
      className="sidebar-panel flex flex-col h-full flex-shrink-0"
      style={{
        width: isOpen ? 260 : 56,
        minWidth: isOpen ? 260 : 56,
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-subtle)",
      }}
    >
      {/* Header — always visible */}
      <div
        className="flex items-center px-3 py-4 shrink-0"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          justifyContent: isOpen ? "space-between" : "center",
          minHeight: 56,
        }}
      >
        {isOpen ? (
          <>
            <span className="vidhi-sidebar text-lg" onClick={onGoHome} title="Home">
              Vidhi
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onCreateThread()}
                className="p-1.5 rounded-lg text-sm transition-all liquid-glass-item"
                style={{ color: "var(--purple-light)" }}
                title="New chat"
              >
                &#9998;
              </button>
              <button
                onClick={onToggle}
                className="p-1.5 rounded-lg text-sm transition-all liquid-glass-item"
                style={{ color: "var(--text-muted)" }}
                title="Close sidebar"
              >
                &#8592;
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={onToggle}
              className="p-1.5 rounded-lg transition-all liquid-glass-item"
              style={{ color: "var(--text-secondary)" }}
              title="Open sidebar"
            >
              &#9776;
            </button>
            <button
              onClick={() => onCreateThread()}
              className="p-1.5 rounded-lg transition-all liquid-glass-item"
              style={{ color: "var(--purple-light)" }}
              title="New chat"
            >
              &#9998;
            </button>
          </div>
        )}
      </div>

      {/* Full content — materialises/dematerialises when collapsed */}
      <div
        className="sidebar-content flex flex-col flex-1 overflow-hidden"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transform: isOpen ? "translateX(0)" : "translateX(-8px)",
          transitionDelay: isOpen ? "0.04s" : "0s",
        }}
      >
        {/* New chat button */}
        <div className="px-3 pt-3 shrink-0">
          <button
            onClick={() => onCreateThread()}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium liquid-glass-btn"
            style={{ color: "white" }}
          >
            <span>+</span>
            <span>New Chat</span>
          </button>
        </div>

        {/* Scrollable thread/folder list */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {/* Folders */}
          {folders.map((folder) => (
            <div key={folder.id}>
              {/* Folder row */}
              <div
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer group liquid-glass-item"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => toggleFolder(folder.id)}
              >
                <span className="text-xs">
                  {expandedFolders.has(folder.id) ? "\u25BE" : "\u25B8"}
                </span>
                <span className="text-sm mr-1">&#128193;</span>
                {editingId === `folder:${folder.id}` ? (
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => commitRename("folder", folder.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename("folder", folder.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-transparent border-b text-sm outline-none"
                    style={{ borderColor: "var(--purple-primary)", color: "var(--text-primary)" }}
                  />
                ) : (
                  <span className="flex-1 text-sm truncate">{folder.name}</span>
                )}
                {editingId !== `folder:${folder.id}` && (
                  <DotsMenu
                    onRename={() => startRename("folder", folder.id, folder.name)}
                    onDelete={() => onDeleteFolder(folder.id)}
                  />
                )}
              </div>

              {expandedFolders.has(folder.id) && (
                <div className="ml-3 space-y-0.5">
                  {(folder.threads ?? []).map((thread) => (
                    <ThreadItem
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === activeThreadId}
                      editingId={editingId}
                      editingValue={editingValue}
                      folders={folders}
                      onSelect={() => onSelectThread(thread.id)}
                      onRename={() => startRename("thread", thread.id, thread.title)}
                      onDelete={() => onDeleteThread(thread.id)}
                      onMoveToFolder={(folderId) => onMoveThread(thread.id, folderId)}
                      onEditChange={setEditingValue}
                      onCommitRename={() => commitRename("thread", thread.id)}
                      onCancelEdit={() => setEditingId(null)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* New folder input */}
          {newFolderMode ? (
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg liquid-glass">
              <span className="text-sm">&#128193;</span>
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={handleCreateFolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") setNewFolderMode(false);
                }}
                placeholder="Folder name..."
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          ) : (
            <button
              onClick={() => setNewFolderMode(true)}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all liquid-glass-item"
              style={{ color: "var(--text-muted)" }}
            >
              + New Folder
            </button>
          )}

          {/* Recent chats separator */}
          {loosThreads.length > 0 && (
            <div
              className="my-2 text-xs px-2 pt-2"
              style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}
            >
              Recent Chats
            </div>
          )}

          {/* Loose threads */}
          {loosThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              editingId={editingId}
              editingValue={editingValue}
              folders={folders}
              onSelect={() => onSelectThread(thread.id)}
              onRename={() => startRename("thread", thread.id, thread.title)}
              onDelete={() => onDeleteThread(thread.id)}
              onMoveToFolder={(folderId) => onMoveThread(thread.id, folderId)}
              onEditChange={setEditingValue}
              onCommitRename={() => commitRename("thread", thread.id)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 text-xs shrink-0 space-y-2"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <BtcImportButton />
          <ImportButton label="⬆ Import Nat Gas Data" endpoint="/api/import-ng" title="Import Natural Gas spot price data (.csv or .numbers)" />
          <ImportButton label="⬆ Import Silver Data" endpoint="/api/import-silver" title="Import Silver futures price data (.csv or .numbers)" />
          <ImportButton label="⬆ Import Gold Data" endpoint="/api/import-gold" title="Import Gold price data (.csv or .numbers)" />
          <div>Powered by Claude + Vedic Astrology</div>
        </div>
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  isActive,
  editingId,
  editingValue,
  folders,
  onSelect,
  onRename,
  onDelete,
  onMoveToFolder,
  onEditChange,
  onCommitRename,
  onCancelEdit,
}: {
  thread: ChatThread;
  isActive: boolean;
  editingId: string | null;
  editingValue: string;
  folders: ChatFolder[];
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onEditChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
}) {
  const isEditing = editingId === `thread:${thread.id}`;

  return (
    <div
      className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer group liquid-glass-item"
      style={{
        background: isActive ? "var(--purple-glow)" : "transparent",
        borderLeft: isActive ? "2px solid var(--purple-primary)" : "2px solid transparent",
        borderRight: "none",
        borderTop: "none",
        borderBottom: "none",
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
      }}
      onClick={onSelect}
    >
      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
        &#128172;
      </span>

      {isEditing ? (
        <input
          autoFocus
          value={editingValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-transparent border-b text-sm outline-none"
          style={{ borderColor: "var(--purple-primary)", color: "var(--text-primary)" }}
        />
      ) : (
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{thread.title}</div>
          <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {formatDateTime(thread.updatedAt)}
          </div>
        </div>
      )}

      {!isEditing && (
        <DotsMenu
          onRename={onRename}
          onDelete={onDelete}
          folders={folders}
          currentFolderId={thread.folderId ?? null}
          onMoveToFolder={onMoveToFolder}
        />
      )}
    </div>
  );
}
