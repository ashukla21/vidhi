"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatThread, ChatMessage } from "@/types";
import { formatDateTime } from "@/lib/utils";

interface ModelOption {
  id: string;
  label: string;
  desc: string;
}

interface ChatWindowProps {
  thread: ChatThread;
  initialMessage?: string | null;
  onMessageSent?: () => void;
  onThreadUpdate: (thread: ChatThread) => void;
  model: string;
  onModelChange: (m: string) => void;
  availableModels: ModelOption[];
}

interface StreamingState {
  text: string;
}

interface AttachmentFile {
  id: string;
  name: string;
  type: "image" | "file";
  mediaType: string;
  data: string; // base64
  preview?: string; // data URL for images
}

const LOADING_MESSAGES = [
  "Consulting the stars...",
  "Aligning the planets...",
  "Reading the nakshatras...",
  "Channeling cosmic wisdom...",
  "Parsing planetary data...",
  "Calculating transits...",
  "Meditating on the cosmos...",
  "Asking the constellations...",
  "Mapping celestial patterns...",
  "Tuning into the zodiac...",
];

export default function ChatWindow({
  thread,
  initialMessage,
  onMessageSent,
  onThreadUpdate,
  model,
  onModelChange,
  availableModels,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialMessageFiredRef = useRef(false);

  useEffect(() => {
    setMessages(thread.messages ?? []);
  }, [thread.id, thread.messages]);

  // Rotate loading messages
  useEffect(() => {
    if (!isLoading) return;
    setLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    const interval = setInterval(() => {
      setLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    }, 3000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Auto-send the initialMessage once
  useEffect(() => {
    if (initialMessage && !initialMessageFiredRef.current && !isLoading) {
      initialMessageFiredRef.current = true;
      onMessageSent?.();
      setTimeout(() => sendMessage(initialMessage), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Refresh messages from DB (so we always have real IDs after a send completes)
  const refreshMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/threads/${thread.id}`);
      const freshThread = await res.json();
      setMessages(
        freshThread.messages.map((m: ChatMessage & { toolCalls: string | null }) => ({
          ...m,
          toolCalls: typeof m.toolCalls === "string" ? JSON.parse(m.toolCalls) : m.toolCalls,
        }))
      );
    } catch {
      // silently fail — state already has the messages from streaming
    }
  }, [thread.id]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    if (!overrideText) setInput("");
    setIsLoading(true);

    const currentAttachments = [...attachments];
    setAttachments([]);

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      threadId: thread.id,
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming({ text: "" });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          message: text,
          model,
          attachments: currentAttachments.map((a) => ({
            type: a.type,
            name: a.name,
            mediaType: a.mediaType,
            data: a.data,
          })),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (!raw.trim()) continue;

          let chunk: { type: string; content?: string; error?: string };
          try {
            chunk = JSON.parse(raw);
          } catch {
            continue;
          }

          if (chunk.type === "text" && chunk.content) {
            setStreaming((s) => ({ text: (s?.text ?? "") + chunk.content! }));
          } else if (chunk.type === "title" && chunk.content) {
            onThreadUpdate({ ...thread, title: chunk.content, updatedAt: new Date() });
          } else if (chunk.type === "done") {
            setStreaming(null);
            onThreadUpdate({ ...thread, updatedAt: new Date() });
            // Refresh from DB so messages have real IDs (needed for edit/rerun)
            await refreshMessages();
          } else if (chunk.type === "error") {
            throw new Error(chunk.error);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          threadId: thread.id,
          role: "assistant",
          content: `Error: ${String(err)}`,
          createdAt: new Date(),
        },
      ]);
      setStreaming(null);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isLoading, thread, model, attachments, onThreadUpdate, refreshMessages]);

  // Truncate messages from fromMessageId onwards, then resend text
  const truncateAndSend = useCallback(async (fromMessage: ChatMessage, inclusive: boolean, text: string) => {
    // Update local state first (optimistic)
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === fromMessage.id);
      return idx === -1 ? prev : prev.slice(0, inclusive ? idx : idx + 1);
    });

    // Delete from DB (best-effort — if message has a temp ID the API will return 404 which is fine)
    if (!fromMessage.id.startsWith("temp-")) {
      await fetch(`/api/threads/${thread.id}/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMessageId: fromMessage.id, inclusive }),
      });
    }

    sendMessage(text);
  }, [thread.id, sendMessage]);

  const handleEditSave = useCallback((msg: ChatMessage) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setEditingId(null);
    setEditText("");
    truncateAndSend(msg, true, trimmed);
  }, [editText, truncateAndSend]);

  const handleRerun = useCallback((msg: ChatMessage) => {
    truncateAndSend(msg, true, msg.content);
  }, [truncateAndSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize() {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const isImage = file.type.startsWith("image/");
        const attachment: AttachmentFile = {
          id: `att-${Date.now()}-${Math.random()}`,
          name: file.name,
          type: isImage ? "image" : "file",
          mediaType: file.type || "application/octet-stream",
          data: base64,
          preview: isImage ? (reader.result as string) : undefined,
        };
        setAttachments((prev) => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be selected again
    e.target.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header with model selector */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h2
          className="font-semibold text-sm truncate"
          style={{ color: "var(--purple-light)" }}
        >
          {thread.title}
        </h2>

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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4">
        <div className="max-w-3xl mx-auto px-6 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
            <div className="text-3xl mb-3 twinkling-star">&#10022;</div>
            <p className="text-sm">Ask Vidhi about planetary transits and investments</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isEditing={editingId === msg.id}
            editText={editingId === msg.id ? editText : ""}
            onEditChange={setEditText}
            onEditStart={() => { setEditingId(msg.id); setEditText(msg.content); }}
            onEditSave={() => handleEditSave(msg)}
            onEditCancel={() => { setEditingId(null); setEditText(""); }}
            onRerun={() => handleRerun(msg)}
            disabled={isLoading}
          />
        ))}

        {/* Streaming / loading state */}
        {streaming !== null && (
          <div className="flex flex-col gap-2">
            {!streaming.text && (
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="twinkling-star">&#10022;</span>
                <span className="loading-text">{loadingMessage}</span>
              </div>
            )}
            {streaming.text && (
              <div
                className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                  maxWidth: "80%",
                  whiteSpace: "pre-wrap",
                }}
              >
                {streaming.text}
                <span
                  className="inline-block w-0.5 h-4 ml-0.5 animate-pulse"
                  style={{ background: "var(--purple-neon)", verticalAlign: "middle" }}
                />
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
        </div>{/* end centering wrapper */}
      </div>

      {/* Input area */}
      <div
        className="shrink-0 pb-4 pt-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
      <div className="max-w-3xl mx-auto px-6">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att) => (
              <div key={att.id} className="attachment-chip flex items-center gap-2 rounded-lg px-3 py-1.5">
                {att.type === "image" && att.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={att.preview} alt={att.name} className="w-6 h-6 rounded object-cover" />
                ) : (
                  <span className="text-xs">&#128196;</span>
                )}
                <span className="text-xs truncate max-w-32" style={{ color: "var(--text-secondary)" }}>
                  {att.name}
                </span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="text-xs ml-1 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--red)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                >
                  &#10005;
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-2xl px-4 py-3 liquid-glass"
          style={{
            border: `1px solid ${isLoading ? "var(--purple-primary)" : "rgba(255,255,255,0.06)"}`,
            transition: "border-color 0.3s",
          }}
        >
          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className={`shrink-0 w-8 h-8 flex items-center justify-center text-base attach-btn ${isLoading ? "opacity-40 pointer-events-none" : ""}`}
          >
            &#128206;
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.csv,.json,.md,.py,.js,.ts,.tsx,.jsx,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about planetary transits, investment timing, Bitcoin cycles..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
            style={{ color: "var(--text-primary)", maxHeight: 160 }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold send-btn"
            style={{
              background: input.trim() && !isLoading ? "var(--purple-primary)" : "rgba(255,255,255,0.05)",
              color: input.trim() && !isLoading ? "white" : "var(--text-muted)",
            }}
          >
            {isLoading ? (
              <span className="twinkling-star" style={{ fontSize: "0.75rem" }}>&#10022;</span>
            ) : (
              "\u2191"
            )}
          </button>
        </div>
      </div>{/* end centering wrapper */}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isEditing?: boolean;
  editText?: string;
  onEditChange?: (text: string) => void;
  onEditStart?: () => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  onRerun?: () => void;
  disabled?: boolean;
}

function MessageBubble({
  message,
  isEditing,
  editText,
  onEditChange,
  onEditStart,
  onEditSave,
  onEditCancel,
  onRerun,
  disabled,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [hovered, setHovered] = useState(false);

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEditSave?.();
    }
    if (e.key === "Escape") {
      onEditCancel?.();
    }
  }

  return (
    <div
      className={`flex flex-col gap-1 message-enter ${isUser ? "items-end" : "items-start"} ${isUser ? "ml-auto" : ""}`}
      style={{ maxWidth: "100%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Action buttons — user messages only, shown on hover when not editing/loading */}
      {isUser && !isEditing && !disabled && (
        <div
          className="flex gap-1 px-1"
          style={{
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.15s",
            pointerEvents: hovered ? "auto" : "none",
          }}
        >
          <button
            onClick={onEditStart}
            title="Edit message"
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--purple-light)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          >
            &#9998; Edit
          </button>
          <button
            onClick={onRerun}
            title="Rerun from here"
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--purple-light)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          >
            &#8635; Rerun
          </button>
        </div>
      )}

      {isEditing ? (
        // Inline edit mode
        <div className="flex flex-col gap-2" style={{ maxWidth: "80%", width: "100%" }}>
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={handleEditKeyDown}
            rows={3}
            className="resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed outline-none"
            style={{
              background: "var(--purple-dim)",
              color: "var(--text-primary)",
              border: "1px solid rgba(168, 85, 247, 0.5)",
              borderRadius: "20px 20px 4px 20px",
              width: "100%",
              minHeight: 72,
            }}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onEditCancel}
              className="rounded-lg px-3 py-1 text-xs transition-colors"
              style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.05)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
            >
              Cancel
            </button>
            <button
              onClick={onEditSave}
              disabled={!editText?.trim()}
              className="rounded-lg px-3 py-1 text-xs font-medium transition-opacity"
              style={{
                background: editText?.trim() ? "var(--purple-primary)" : "rgba(255,255,255,0.05)",
                color: editText?.trim() ? "white" : "var(--text-muted)",
              }}
            >
              Save &amp; Send
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${!isUser ? "liquid-glass" : ""}`}
          style={{
            background: isUser ? "var(--purple-dim)" : undefined,
            color: "var(--text-primary)",
            border: isUser ? "1px solid rgba(168, 85, 247, 0.2)" : undefined,
            borderRadius: isUser ? "20px 20px 4px 20px" : "4px 20px 20px 20px",
            maxWidth: "80%",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.content}
        </div>
      )}

      <div className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
        {formatDateTime(message.createdAt)}
      </div>
    </div>
  );
}
