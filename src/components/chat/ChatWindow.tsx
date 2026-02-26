"use client";

import { useState, useRef, useEffect } from "react";
import { ChatThread, ChatMessage, ToolCallRecord } from "@/types";
import { formatDateTime } from "@/lib/utils";
import ToolCallBadge from "./ToolCallBadge";

interface ChatWindowProps {
  thread: ChatThread;
  onThreadUpdate: (thread: ChatThread) => void;
}

interface StreamingState {
  text: string;
  activeTool: string | null;
}

export default function ChatWindow({ thread, onThreadUpdate }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(thread.messages ?? []);
  }, [thread.id, thread.messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      threadId: thread.id,
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming({ text: "", activeTool: null });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, message: text }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const toolCalls: ToolCallRecord[] = [];
      let fullText = "";

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

          let chunk: {
            type: string;
            content?: string;
            toolName?: string;
            toolInput?: Record<string, unknown>;
            toolOutput?: string;
            error?: string;
          };
          try {
            chunk = JSON.parse(raw);
          } catch {
            continue;
          }

          if (chunk.type === "text" && chunk.content) {
            fullText += chunk.content;
            setStreaming((s) => ({ text: (s?.text ?? "") + chunk.content!, activeTool: s?.activeTool ?? null }));
          } else if (chunk.type === "tool_start") {
            setStreaming((s) => ({ text: s?.text ?? "", activeTool: chunk.toolName ?? null }));
          } else if (chunk.type === "tool_end") {
            toolCalls.push({
              toolName: chunk.toolName!,
              input: chunk.toolInput ?? {},
              output: chunk.toolOutput ?? "",
            });
            setStreaming((s) => ({ text: s?.text ?? "", activeTool: null }));
          } else if (chunk.type === "done") {
            const assistantMsg: ChatMessage = {
              id: `temp-assistant-${Date.now()}`,
              threadId: thread.id,
              role: "assistant",
              content: fullText,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              createdAt: new Date(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreaming(null);
            onThreadUpdate({ ...thread, updatedAt: new Date() });
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
  }

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

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div
        className="flex items-center px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h2 className="font-semibold text-base truncate" style={{ color: "var(--text-primary)" }}>
          {thread.title}
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
            <div className="text-4xl mb-3">🪐</div>
            <p className="text-sm">Ask Vidhi about planetary transits and investments</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming assistant message */}
        {streaming !== null && (
          <div className="flex flex-col gap-2 max-w-3xl">
            {streaming.activeTool && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs w-fit"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--purple-light)",
                }}
              >
                <span className="animate-spin">⟳</span>
                <span>Querying {streaming.activeTool}...</span>
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
                  style={{ background: "var(--purple-primary)", verticalAlign: "middle" }}
                />
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 px-4 pb-4 pt-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl px-4 py-3"
          style={{
            background: "var(--bg-card)",
            border: `1px solid ${isLoading ? "var(--purple-primary)" : "var(--border-subtle)"}`,
            transition: "border-color 0.2s",
          }}
        >
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
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all"
            style={{
              background: input.trim() && !isLoading ? "var(--purple-primary)" : "var(--bg-tertiary)",
              color: input.trim() && !isLoading ? "white" : "var(--text-muted)",
            }}
          >
            {isLoading ? (
              <span className="animate-spin text-xs">⟳</span>
            ) : (
              "↑"
            )}
          </button>
        </div>
        <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
          For informational purposes only — not financial advice
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"} max-w-3xl ${isUser ? "ml-auto" : ""}`}>
      {/* Tool calls (assistant only) */}
      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {message.toolCalls.map((tc, i) => (
            <ToolCallBadge key={i} toolCall={tc} />
          ))}
        </div>
      )}

      <div
        className="px-4 py-3 rounded-2xl text-sm leading-relaxed"
        style={{
          background: isUser ? "var(--purple-dim)" : "var(--bg-card)",
          color: "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--border-subtle)",
          borderRadius: isUser ? "20px 20px 4px 20px" : "4px 20px 20px 20px",
          maxWidth: "80%",
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
      </div>

      <div className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
        {formatDateTime(message.createdAt)}
      </div>
    </div>
  );
}
