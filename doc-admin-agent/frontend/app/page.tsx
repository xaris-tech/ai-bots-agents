"use client";

import { useCoAgent } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

type RuleResult = {
  rule_id: string;
  result: "PASS" | "FAIL" | "NEEDS_INFO";
  detail: string;
};

type ExtractedPermit = {
  is_document: boolean;
  application_ref: string;
  project_name: string;
  site_address: string;
  storeys: number;
  occupancy_classes: string[];
  mixed_use: boolean;
  corridor_width_mm: number;
  exit_count_level1: number;
  travel_distance_m: number;
  sprinkler_system: string;
  extraction_confidence: number;
};

type ComplianceResult = {
  application_ref: string;
  ruleset_version: string;
  checks: RuleResult[];
  status: "PASS" | "FAIL" | "NEEDS_INFO";
};

type AgentState = {
  extracted?: ExtractedPermit;
  compliance?: ComplianceResult;
};

const STATUS_STYLE: Record<string, string> = {
  PASS: "text-[var(--pass)] border-[var(--pass)]",
  FAIL: "text-[var(--fail)] border-[var(--fail)]",
  NEEDS_INFO: "text-[var(--needs)] border-[var(--needs)]",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`font-mono-tech text-xs border px-2 py-0.5 tracking-wide ${
        STATUS_STYLE[status] ?? "text-[var(--ink-dim)] border-[var(--rule-strong)]"
      }`}
    >
      {status}
    </span>
  );
}

function CaseFile() {
  const { state } = useCoAgent<AgentState>({
    name: "doc_admin_agent",
    initialState: {},
  });

  const extracted = state?.extracted;
  const compliance = state?.compliance;

  if (!extracted) {
    return (
      <div className="text-[var(--ink-dim)] text-sm">
        Paste a permit application into the chat to begin. The pipeline
        extracts fields, checks them against the egress ruleset, and files
        or escalates the result — live, here.
      </div>
    );
  }

  if (!extracted.is_document) {
    return (
      <div className="text-[var(--ink-dim)] text-sm">
        No document submitted yet in the current message.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-display uppercase text-xs tracking-wider text-[var(--ink-dim)] mb-1">
          Application
        </div>
        <div className="font-mono-tech text-lg">{extracted.application_ref}</div>
        <div className="text-sm text-[var(--ink-dim)]">{extracted.project_name}</div>
        <div className="text-sm text-[var(--ink-dim)]">{extracted.site_address}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-[var(--rule)] pt-4">
        <div className="text-[var(--ink-dim)]">Storeys</div>
        <div className="font-mono-tech text-right">{extracted.storeys}</div>
        <div className="text-[var(--ink-dim)]">Corridor width</div>
        <div className="font-mono-tech text-right">{extracted.corridor_width_mm}mm</div>
        <div className="text-[var(--ink-dim)]">Exits (Level 1)</div>
        <div className="font-mono-tech text-right">{extracted.exit_count_level1}</div>
        <div className="text-[var(--ink-dim)]">Travel distance</div>
        <div className="font-mono-tech text-right">{extracted.travel_distance_m}m</div>
        <div className="text-[var(--ink-dim)]">Sprinklers</div>
        <div className="font-mono-tech text-right">{extracted.sprinkler_system}</div>
      </div>

      {compliance && (
        <div className="border-t border-[var(--rule)] pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-display uppercase text-xs tracking-wider text-[var(--ink-dim)]">
              Compliance — {compliance.ruleset_version}
            </div>
            <StatusPill status={compliance.status} />
          </div>
          <div className="flex flex-col gap-2">
            {compliance.checks.map((c) => (
              <div key={c.rule_id} className="flex items-start gap-3 text-sm">
                <span className="font-mono-tech text-[var(--ink-dim)] w-16 shrink-0">
                  {c.rule_id}
                </span>
                <StatusPill status={c.result} />
                <span className="text-[var(--ink-dim)]">{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col flex-1">
      <header className="border-b-2 border-[var(--accent)] bg-[var(--surface)] px-8 py-5">
        <div className="font-display uppercase text-xs tracking-wider text-[var(--accent)]">
          Doc Admin Agent · Live over AG-UI
        </div>
        <h1 className="font-display text-2xl font-bold mt-1">
          Construction Permit Intake
        </h1>
      </header>

      <main className="flex flex-1 w-full px-8 py-10 pr-[calc(2rem+448px)]">
        <div className="flex-1 max-w-3xl mx-auto bg-[var(--surface)] border border-[var(--rule-strong)] p-8">
          <CaseFile />
        </div>
      </main>

      <CopilotSidebar
        defaultOpen
        labels={{
          title: "Permit Intake Assistant",
          initial:
            "Paste a permit application or ask me anything about the compliance process.",
        }}
      />
    </div>
  );
}
