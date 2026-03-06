"use client";

import { useState } from "react";
import { ChatFolder, ChatThread } from "@/types";
import { formatDateTime } from "@/lib/utils";

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
}: SidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    type: "thread" | "folder";
    id: string;
    x: number;
    y: number;
  } | null>(null);

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
    setContextMenu(null);
  }

  function commitRename(type: "thread" | "folder", id: string) {
    if (editingValue.trim()) {
      if (type === "thread") onRenameThread(id, editingValue.trim());
      else onRenameFolder(id, editingValue.trim());
    }
    setEditingId(null);
  }

  function handleContextMenu(
    e: React.MouseEvent,
    type: "thread" | "folder",
    id: string
  ) {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  }

  function handleCreateFolder() {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName("");
      setNewFolderMode(false);
    }
  }

  if (!isOpen) {
    return (
      <div
        className="flex flex-col items-center py-4 gap-3"
        style={{
          width: 56,
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <button
          onClick={onToggle}
          className="p-2 rounded-lg transition-all liquid-glass-item"
          style={{ color: "var(--text-secondary)" }}
          title="Open sidebar"
        >
          &#9776;
        </button>
        <button
          onClick={() => onCreateThread()}
          className="p-2 rounded-lg transition-all liquid-glass-item"
          style={{ color: "var(--purple-light)" }}
          title="New chat"
        >
          &#9998;
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex flex-col h-full"
        style={{
          width: 260,
          minWidth: 260,
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border-subtle)",
        }}
        onClick={() => contextMenu && setContextMenu(null)}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg gradient-text font-bold">Vidhi</span>
          </div>
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
        </div>

        {/* New chat button */}
        <div className="px-3 pt-3">
          <button
            onClick={() => onCreateThread()}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium liquid-glass-btn"
            style={{ color: "white" }}
          >
            <span>+</span>
            <span>New Chat</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {/* Folders */}
          {folders.map((folder) => (
            <div key={folder.id}>
              <div
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer group liquid-glass-item"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={(e) => handleContextMenu(e, "folder", folder.id)}
              >
                <span className="text-xs transition-transform duration-150">
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
                <span
                  className="text-xs opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {folder.threads?.length ?? 0}
                </span>
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
                      onSelect={() => onSelectThread(thread.id)}
                      onContextMenu={(e) => handleContextMenu(e, "thread", thread.id)}
                      onEditChange={setEditingValue}
                      onCommitRename={() => commitRename("thread", thread.id)}
                      onCancelEdit={() => setEditingId(null)}
                    />
                  ))}
                  <button
                    onClick={() => onCreateThread(folder.id)}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all liquid-glass-item"
                    style={{ color: "var(--text-muted)" }}
                  >
                    + Add chat
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* New folder input */}
          {newFolderMode ? (
            <div
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg liquid-glass"
            >
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

          {/* Separator */}
          {loosThreads.length > 0 && (
            <div
              className="my-2 text-xs px-2 pt-2"
              style={{
                color: "var(--text-muted)",
                borderTop: "1px solid var(--border-subtle)",
              }}
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
              onSelect={() => onSelectThread(thread.id)}
              onContextMenu={(e) => handleContextMenu(e, "thread", thread.id)}
              onEditChange={setEditingValue}
              onCommitRename={() => commitRename("thread", thread.id)}
              onCancelEdit={() => setEditingId(null)}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 text-xs"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          Powered by Claude + Vedic Astrology
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-xl py-1 shadow-xl liquid-glass"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: 160,
          }}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm transition-all liquid-glass-item"
            style={{ color: "var(--text-primary)" }}
            onClick={() => {
              const item =
                contextMenu.type === "thread"
                  ? threads.find((t) => t.id === contextMenu.id)
                  : folders.find((f) => f.id === contextMenu.id);
              if (item) startRename(contextMenu.type, contextMenu.id, (item as ChatThread).title ?? (item as ChatFolder).name);
            }}
          >
            &#9999;&#65039; Rename
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm transition-all liquid-glass-item"
            style={{ color: "var(--red)" }}
            onClick={() => {
              if (contextMenu.type === "thread") onDeleteThread(contextMenu.id);
              else onDeleteFolder(contextMenu.id);
              setContextMenu(null);
            }}
          >
            &#128465;&#65039; Delete
          </button>
        </div>
      )}
    </>
  );
}

function ThreadItem({
  thread,
  isActive,
  editingId,
  editingValue,
  onSelect,
  onContextMenu,
  onEditChange,
  onCommitRename,
  onCancelEdit,
}: {
  thread: ChatThread;
  isActive: boolean;
  editingId: string | null;
  editingValue: string;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
}) {
  const isEditing = editingId === `thread:${thread.id}`;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer group transition-all liquid-glass-item`}
      style={{
        background: isActive ? "var(--purple-glow)" : "transparent",
        borderLeft: isActive ? "2px solid var(--purple-primary)" : "2px solid transparent",
        borderRight: "none",
        borderTop: "none",
        borderBottom: "none",
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
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
    </div>
  );
}
