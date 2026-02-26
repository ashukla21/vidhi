"use client";

import { useState } from "react";
import { ToolCallRecord } from "@/types";

const TOOL_ICONS: Record<string, string> = {
  get_planetary_positions: "🪐",
  get_planet_in_sign: "♎",
  get_retrograde_periods: "↩",
  get_planetary_transits: "🌠",
  run_custom_query: "🔍",
  get_data_summary: "📊",
};

const TOOL_LABELS: Record<string, string> = {
  get_planetary_positions: "Planetary Positions",
  get_planet_in_sign: "Planet in Sign",
  get_retrograde_periods: "Retrograde Periods",
  get_planetary_transits: "Sign Transits",
  run_custom_query: "Custom Query",
  get_data_summary: "Data Summary",
};

export default function ToolCallBadge({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const icon = TOOL_ICONS[toolCall.toolName] ?? "🔧";
  const label = TOOL_LABELS[toolCall.toolName] ?? toolCall.toolName;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all"
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-subtle)",
          color: "var(--purple-light)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--purple-primary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-subtle)";
        }}
      >
        <span>{icon}</span>
        <span>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div
          className="mt-1 rounded-xl p-3 text-xs font-mono overflow-x-auto"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
            maxHeight: 200,
            overflowY: "auto",
            maxWidth: 500,
          }}
        >
          <div className="mb-2" style={{ color: "var(--text-muted)" }}>
            Input:
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.output && (
            <>
              <div className="mt-2 mb-1" style={{ color: "var(--text-muted)" }}>
                Output (preview):
              </div>
              <pre className="whitespace-pre-wrap break-all">
                {toolCall.output.slice(0, 500)}
                {toolCall.output.length > 500 ? "..." : ""}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
