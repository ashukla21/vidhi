"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChatFolder, ChatThread } from "@/types";
import { formatDateTime } from "@/lib/utils";

// ── Stock profile types (mirrored from stock-db to avoid server import) ────────
interface StockSummary {
  ticker: string;
  company_name: string | null;
  ipo_date: string | null;
  ipo_time: string | null;
  has_natal_chart: boolean;
  has_dasha: boolean;
  has_navamsha: boolean;
}

// ── Per-stock upload button ────────────────────────────────────────────────────
function StockUploadButton({
  ticker,
  label,
  endpoint,
  done,
  onDone,
}: {
  ticker: string;
  label: string;
  endpoint: string;
  done: boolean;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [msg, setMsg]       = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setMsg("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await fetch(`/api/stocks/${ticker}/${endpoint}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMsg(data.error || "Upload failed");
      } else {
        setStatus("done");
        setMsg(data.saved ? `Saved ${data.saved} periods` : `${data.planets_saved ?? ""} planets saved`);
        onDone();
      }
    } catch (err) {
      setStatus("error");
      setMsg(String(err));
    }
    if (ref.current) ref.current.value = "";
  }

  const color =
    status === "done"  || done ? "var(--purple-light)" :
    status === "error"         ? "#f87171" :
    "var(--text-muted)";

  return (
    <div className="flex flex-col">
      <input ref={ref} type="file" accept=".png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={handleFile} />
      <button
        onClick={() => { setStatus("idle"); ref.current?.click(); }}
        disabled={status === "uploading"}
        className="text-left text-xs transition-all liquid-glass-item px-1 py-0.5 rounded"
        style={{ color, opacity: status === "uploading" ? 0.6 : 1 }}
        title={`Upload ${label} screenshot`}
      >
        {status === "uploading" ? "⏳" : (done && status === "idle") ? "✓" : "⬆"} {label}
      </button>
      {msg && <div className="text-xs px-1 leading-snug" style={{ color }}>{msg}</div>}
    </div>
  );
}

// ── Single stock row ───────────────────────────────────────────────────────────
function StockRow({ stock, onDelete, onRefresh }: { stock: StockSummary; onDelete: () => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div
        className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{expanded ? "▾" : "▸"}</span>
          <span className="text-xs font-semibold" style={{ color: "var(--purple-light)" }}>{stock.ticker}</span>
          {stock.company_name && (
            <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{stock.company_name}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
          {stock.has_natal_chart && <span title="Birth chart loaded">📊</span>}
          {stock.has_dasha        && <span title="Dasha loaded">📅</span>}
          {stock.has_navamsha     && <span title="Navamsha loaded">🔮</span>}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="ml-1 p-0.5 rounded hover:text-red-400 transition-colors"
            title="Delete stock"
          >✕</button>
        </div>
      </div>

      {expanded && (
        <div className="px-2 pb-2 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {(stock.ipo_date || stock.ipo_city) && (
            <div className="text-xs pt-1 space-y-0.5" style={{ color: "var(--text-muted)" }}>
              {stock.ipo_date && (
                <div>IPO: {stock.ipo_date}{stock.ipo_time ? ` ${stock.ipo_time}` : ""}</div>
              )}
              {stock.ipo_city && (
                <div>{stock.ipo_city}, {stock.ipo_state}, {stock.ipo_country}</div>
              )}
            </div>
          )}
          <StockUploadButton ticker={stock.ticker} label="Birth Chart"      endpoint="upload-chart"   done={stock.has_natal_chart} onDone={onRefresh} />
          <StockUploadButton ticker={stock.ticker} label="Planet Positions" endpoint="upload-planets" done={stock.has_natal_chart} onDone={onRefresh} />
          <StockUploadButton ticker={stock.ticker} label="Dasha"            endpoint="upload-dasha"   done={stock.has_dasha}       onDone={onRefresh} />
          <StockUploadButton ticker={stock.ticker} label="Navamsha"    endpoint="upload-navamsha" done={stock.has_navamsha}    onDone={onRefresh} />
        </div>
      )}
    </div>
  );
}

// ── Add-stock inline form ──────────────────────────────────────────────────────
function AddStockForm({ onAdded }: { onAdded: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [ticker,  setTicker]  = useState("");
  const [company, setCompany] = useState("");
  const [date,    setDate]    = useState("");
  const [time,    setTime]    = useState("");
  const [city,    setCity]    = useState("New York");
  const [state,   setState]   = useState("NY");
  const [country, setCountry] = useState("USA");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  async function submit() {
    if (!ticker.trim()) { setErr("Ticker required"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker:       ticker.trim().toUpperCase(),
          company_name: company.trim() || null,
          ipo_date:     date.trim()    || null,
          ipo_time:     time.trim()    || null,
          ipo_city:     city.trim()    || "New York",
          ipo_state:    state.trim()   || "NY",
          ipo_country:  country.trim() || "USA",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed"); }
      else {
        setTicker(""); setCompany(""); setDate(""); setTime("");
        setCity("New York"); setState("NY"); setCountry("USA");
        setOpen(false); onAdded();
      }
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-xs px-2 py-1 rounded transition-all liquid-glass-item"
        style={{ color: "var(--text-muted)" }}
      >+ Add Stock</button>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "var(--text-primary)",
    padding: "3px 6px",
    fontSize: 11,
    width: "100%",
    outline: "none",
  };

  return (
    <div className="space-y-1 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <input style={inputStyle} placeholder="Ticker (e.g. AAPL)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} />
      <input style={inputStyle} placeholder="Company name (optional)" value={company} onChange={e => setCompany(e.target.value)} />
      <input style={inputStyle} type="date" placeholder="IPO date" value={date} onChange={e => setDate(e.target.value)} />
      <input style={inputStyle} type="text" placeholder="IPO time (e.g. 09:30)" value={time} onChange={e => setTime(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px", gap: 4 }}>
        <input style={inputStyle} placeholder="City" value={city}    onChange={e => setCity(e.target.value)} />
        <input style={inputStyle} placeholder="State" value={state}   onChange={e => setState(e.target.value)} />
        <input style={inputStyle} placeholder="Country" value={country} onChange={e => setCountry(e.target.value)} />
      </div>
      {err && <div className="text-xs" style={{ color: "#f87171" }}>{err}</div>}
      <div className="flex gap-1 pt-0.5">
        <button
          onClick={submit} disabled={saving}
          className="flex-1 text-xs py-1 rounded transition-all liquid-glass-btn"
          style={{ color: "white", opacity: saving ? 0.6 : 1 }}
        >{saving ? "Saving…" : "Add"}</button>
        <button
          onClick={() => { setOpen(false); setErr(""); }}
          className="text-xs px-2 py-1 rounded transition-all liquid-glass-item"
          style={{ color: "var(--text-muted)" }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ── Stocks section (collapsible) ───────────────────────────────────────────────
function StocksSection() {
  const [open,   setOpen]   = useState(true);
  const [stocks, setStocks] = useState<StockSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stocks");
      if (res.ok) setStocks(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(ticker: string) {
    await fetch(`/api/stocks/${ticker}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="px-3 pt-2 pb-1 shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 text-xs font-medium mb-1 px-1 py-0.5 rounded transition-all liquid-glass-item"
        style={{ color: "var(--text-secondary)" }}
      >
        <span>📈</span>
        <span className="flex-1 text-left">Stocks</span>
        <span style={{ opacity: 0.5 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-1">
          {stocks.map(s => (
            <StockRow key={s.ticker} stock={s} onDelete={() => handleDelete(s.ticker)} onRefresh={load} />
          ))}
          <AddStockForm onAdded={load} />
        </div>
      )}
    </div>
  );
}

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

        {/* Stocks section */}
        <StocksSection />

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
          <ImportButton label="⬆ Import Crude Oil Data" endpoint="/api/import-crude" title="Import WTI Crude Oil price data (.csv or .numbers)" />
          <ImportButton label="⬆ Import Copper Data" endpoint="/api/import-copper" title="Import Copper Futures price data (.csv or .numbers)" />
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
