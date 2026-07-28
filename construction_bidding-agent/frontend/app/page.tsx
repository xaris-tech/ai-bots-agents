"use client";

import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  Filter,
  Globe,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Settings2,
  SquareKanban,
  TriangleAlert,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categorizeBid, CATEGORY_LABEL, type BidCategory } from "./categorize";
import { getIdToken, firebaseEnabled } from "./firebase";
import { signOutUser } from "./AuthGate";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const PLATFORMS = ["All portals", "IonWave", "DemandStar", "Bonfire"];

type Score = {
  total: number;
  label: "high" | "medium" | "low" | "irrelevant";
  profile_version: number;
  breakdown: { reason: string; points: number }[];
};

type Bid = {
  dedupe_key: string;
  platform: string;
  bid_id: string;
  title: string;
  agency: string;
  location: string;
  due_date: string | null;
  bid_url: string;
  documents_url: string;
  estimated_value: string;
  description: string;
  score: Score;
};

type Profile = {
  version: number;
  service_areas: string[];
  project_terms: string[];
  material_terms: string[];
  preferred_agencies: string[];
  excluded_terms: string[];
  minimum_lead_days: number;
};

type Proposal = {
  id: number;
  destination: "google_sheets" | "clickup";
  action: string;
  payload: {
    rows?: { dedupe_key: string; title: string; agency: string; platform: string }[];
    tasks?: { dedupe_key: string; title: string; agency: string; platform: string; target_list_id: string }[];
  };
  payload_hash: string;
  status: string;
  created_at: string;
};

type ChatMessage = { role: "user" | "agent"; text: string };

type ScanSummary = {
  status: "completed" | "completed_with_warnings";
  total_records: number;
  outcomes: { platform: string; status: string; record_count: number; warning: string }[];
  logs: string[];
};

type ScanProgress = {
  running: boolean;
  completed_units: number;
  total_units: number;
  total_ingested: number;
  outcomes: { platform: string; status: string; record_count: number; warning: string }[];
  logs: string[];
  error: string;
};

type SheetSyncSummary = {
  status: "completed" | "completed_with_warnings" | "failed";
  total_bids: number;
  warnings: { platform: string; warning: string }[];
  sheet_url: string;
  error: string;
  logs: string[];
};

type ClickUpSyncSummary = {
  status: "completed" | "failed";
  total_bids: number;
  matched_aggregates: number;
  matched_general_construction: number;
  created: number;
  skipped: number;
  aggregates_list_url: string;
  general_construction_list_url: string;
  error: string;
  logs: string[];
};

type LogEntry = { id: number; source: string; time: string; lines: string[] };

type SiteStatus = "healthy" | "empty" | "stale" | "warning" | "blocked" | "never-run" | "disabled";
type BlockKind = "" | "cloudflare" | "bot-block" | "origin-down" | "network";

type SiteView = {
  id: string;
  agency: string;
  location: string;
  county: string;
  platform: string;
  priority: number | null;
  url: string;
  enabled: boolean;
  status: SiteStatus;
  block_kind: BlockKind;
  via: string;
  count: number;
  retained_count: number;
  warning: string;
  bid_total: number;
  bids: { title: string; bid_id: string; due_date: string; bid_url: string }[];
};

type SiteMonitor = {
  generated_at: string | null;
  bids_generated_at: string | null;
  has_report: boolean;
  summary: {
    configured: number;
    enabled: number;
    reported: number;
    healthy: number;
    empty: number;
    stale: number;
    warning: number;
    blocked: number;
    never_run: number;
    disabled: number;
    total_bids: number;
  };
  platforms: { platform: string; total: number; healthy: number; warning: number; blocked: number; stale: number; empty: number; "never-run": number; disabled: number }[];
  sites: SiteView[];
};

const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  healthy: "Healthy",
  empty: "No open bids",
  stale: "Stale (using cached)",
  warning: "Broken (parser)",
  blocked: "Blocked (infra)",
  "never-run": "Never run",
  disabled: "Disabled",
};

// Human labels for WHY an infra-blocked site failed. Drives the sub-badge on
// blocked/stale rows so the operator sees the actual cause, not just "failed".
const BLOCK_KIND_LABEL: Record<Exclude<BlockKind, "">, string> = {
  cloudflare: "Cloudflare challenge",
  "bot-block": "Bot-blocked (403)",
  "origin-down": "Origin down",
  network: "Network / geo-block",
};

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getIdToken();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function formatDueDate(value: string | null) {
  if (!value) return "No deadline";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function daysUntil(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(`${value}T23:59:59`).getTime() - Date.now()) / 86_400_000);
}

export default function BidDesk() {
  const [bids, setBids] = useState<Bid[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("All portals");
  const [category, setCategory] = useState<BidCategory | "all">("all");
  const [view, setView] = useState<"opportunities" | "approvals" | "sites">("opportunities");
  const [siteMonitor, setSiteMonitor] = useState<SiteMonitor | null>(null);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [syncingClickUp, setSyncingClickUp] = useState(false);
  const [error, setError] = useState("");
  const [syncResult, setSyncResult] = useState<SheetSyncSummary | null>(null);
  const [clickUpResult, setClickUpResult] = useState<ClickUpSyncSummary | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "agent", text: "What would you like to review?" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatting, setChatting] = useState(false);
  const [sessionId, setSessionId] = useState<string>();
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const profileDialog = useRef<HTMLDialogElement>(null);
  const proposalDialog = useRef<HTMLDialogElement>(null);
  const logsDialog = useRef<HTMLDialogElement>(null);

  const appendLog = useCallback((source: string, lines: string[]) => {
    if (!lines || lines.length === 0) return;
    logIdRef.current += 1;
    setLogEntries((current) => [
      ...current,
      { id: logIdRef.current, source, time: new Date().toLocaleTimeString(), lines },
    ]);
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const [bidData, profileData, actionData] = await Promise.all([
        api<Bid[]>("/api/bids"),
        api<Profile>("/api/profile"),
        api<Proposal[]>("/api/actions"),
      ]);
      setBids(bidData);
      setProfile(profileData);
      setProposals(actionData);
      setSelectedKey((current) => current || bidData[0]?.dedupe_key || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load bid data");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSiteMonitor = useCallback(async () => {
    setLoadingSites(true);
    try {
      setSiteMonitor(await api<SiteMonitor>("/api/site-monitor"));
    } catch (monitorError) {
      setError(monitorError instanceof Error ? monitorError.message : "Unable to load site monitor");
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (view === "sites" && !siteMonitor) void loadSiteMonitor();
  }, [view, siteMonitor, loadSiteMonitor]);

  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    return bids.filter((bid) => {
      const platformMatch = platform === "All portals" || bid.platform === platform;
      const categoryMatch = category === "all" || categorizeBid(bid.title, bid.description) === category;
      const text = `${bid.title} ${bid.agency} ${bid.location} ${bid.bid_id}`.toLowerCase();
      return platformMatch && categoryMatch && (!term || text.includes(term));
    });
  }, [bids, platform, category, query]);

  const selected = bids.find((bid) => bid.dedupe_key === selectedKey) ?? filtered[0];
  const highFit = bids.filter((bid) => bid.score.label === "high").length;
  const dueSoon = bids.filter((bid) => {
    const days = daysUntil(bid.due_date);
    return days !== null && days >= 0 && days <= 14;
  }).length;
  const pending = proposals.filter((item) => item.status === "pending").length;

  async function runScan() {
    setScanning(true);
    setError("");
    setScanProgress(null);
    try {
      await api<ScanProgress>("/api/scans/full", { method: "POST" });
      let seenLogs = 0;
      let seenIngested = 0;
      // Poll instead of waiting on one giant request: the backend ingests
      // each site/portal into the bid table as it finishes, so refresh here
      // as soon as new records land rather than after all ~74 units are done.
      while (true) {
        const status = await api<ScanProgress>("/api/scans/full/status");
        setScanProgress(status);
        if (status.logs.length > seenLogs) {
          appendLog("Scan portals", status.logs.slice(seenLogs));
          seenLogs = status.logs.length;
        }
        if (status.total_ingested > seenIngested) {
          seenIngested = status.total_ingested;
          await load();
        }
        if (!status.running) {
          if (status.error) setError(status.error);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function syncClickUp() {
    setSyncingClickUp(true);
    setError("");
    setClickUpResult(null);
    try {
      const result = await api<ClickUpSyncSummary>("/api/sync-clickup", { method: "POST" });
      setClickUpResult(result);
      appendLog("Sync ClickUp", result.logs);
      if (result.status === "failed") {
        setError(result.error || "ClickUp sync failed");
      } else {
        await load();
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "ClickUp sync failed");
    } finally {
      setSyncingClickUp(false);
    }
  }

  async function syncSheet() {
    setSyncingSheet(true);
    setError("");
    setSyncResult(null);
    try {
      const result = await api<SheetSyncSummary>("/api/sync-sheet", { method: "POST" });
      setSyncResult(result);
      appendLog("Sync sheet", result.logs);
      if (result.status === "failed") {
        setError(result.error || "Sheet sync failed");
        return;
      }
      await load();
      // Reuses the feed the sheet sync just scraped — no second scrape.
      await syncClickUp();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sheet sync failed");
    } finally {
      setSyncingSheet(false);
    }
  }

  async function prepareAction(destination: "google_sheets" | "clickup") {
    if (!selected) return;
    const next = await api<Proposal>("/api/actions/preview", {
      method: "POST",
      body: JSON.stringify({
        destination,
        action: destination === "google_sheets" ? "upsert_bids" : "create_tasks",
        payload: { bid_keys: [selected.dedupe_key] },
      }),
    });
    setProposal(next);
    setProposals((current) => [next, ...current]);
    proposalDialog.current?.showModal();
  }

  async function approveProposal() {
    if (!proposal) return;
    const approved = await api<Proposal>(`/api/actions/${proposal.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ payload_hash: proposal.payload_hash }),
    });
    setProposal(approved);
    setProposals((current) => current.map((item) => (item.id === approved.id ? approved : item)));
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || chatting) return;
    setChatInput("");
    setMessages((current) => [...current, { role: "user", text }]);
    setChatting(true);
    try {
      const result = await api<{ session_id: string; message: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });
      setSessionId(result.session_id);
      setMessages((current) => [...current, { role: "agent", text: result.message || "No response returned." }]);
      await load();
    } catch (chatError) {
      setMessages((current) => [
        ...current,
        { role: "agent", text: chatError instanceof Error ? chatError.message : "Chat request failed." },
      ]);
    } finally {
      setChatting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">C</div>
          <div>
            <strong>Cortex Bid Desk</strong>
            <span>CEO workspace</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={view === "opportunities" ? "active" : ""} onClick={() => setView("opportunities")}>
            Opportunities
          </button>
          <button className={view === "approvals" ? "active" : ""} onClick={() => setView("approvals")}>
            Approvals {pending > 0 && <span className="nav-count">{pending}</span>}
          </button>
          <button className={view === "sites" ? "active" : ""} onClick={() => setView("sites")}>
            Site Monitor
          </button>
        </nav>
        <div className="topbar-actions">
          <span className="system-status"><i /> Local</span>
          {firebaseEnabled && (
            <button className="signout-button" onClick={signOutUser} title="Sign out"><LogOut size={15} /></button>
          )}
          <button className="icon-button" title="Company profile" onClick={() => profileDialog.current?.showModal()}>
            <Settings2 size={18} />
          </button>
          <button
            className="primary-button"
            onClick={runScan}
            disabled={scanning}
            title="Scrape every configured site profile and batch portal (81 sites + 3 portals) one at a time, loading each into this table as soon as it's scraped. Takes several minutes."
          >
            {scanning ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
            {scanning
              ? scanProgress
                ? `Scanning ${scanProgress.completed_units}/${scanProgress.total_units}`
                : "Starting scan"
              : "Scan portals"}
          </button>
          <button
            className="secondary-button"
            onClick={syncSheet}
            disabled={syncingSheet || syncingClickUp}
            title="Scrape every configured site and portal, push the combined results to the Google Sheet, then filter the same feed by keyword into the ClickUp Aggregates/General Construction lists"
          >
            {syncingSheet || syncingClickUp ? <LoaderCircle className="spin" size={17} /> : <FileSpreadsheet size={17} />}
            {syncingSheet ? "Syncing sheet" : syncingClickUp ? "Syncing ClickUp" : "Scrape + sync sheet"}
          </button>
          <button
            className="secondary-button"
            onClick={syncClickUp}
            disabled={syncingClickUp || syncingSheet}
            title="Filter the already-scraped feed (data/raw/bids.json) by keyword and push to ClickUp, without scraping again"
          >
            {syncingClickUp ? <LoaderCircle className="spin" size={17} /> : <SquareKanban size={17} />}
            {syncingClickUp ? "Syncing ClickUp" : "Sync ClickUp"}
          </button>
          <button
            className="icon-button"
            title="View scan / sync logs"
            onClick={() => logsDialog.current?.showModal()}
          >
            <ScrollText size={18} />
            {logEntries.length > 0 && <span className="nav-count">{logEntries.length}</span>}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <CircleAlert size={17} /> <span>{error}</span>
          <button title="Dismiss" onClick={() => setError("")}><X size={16} /></button>
        </div>
      )}

      {syncResult && syncResult.status !== "failed" && (
        <div className="success-banner" role="status">
          <Check size={17} />
          <span>
            Synced {syncResult.total_bids} bids to the sheet
            {syncResult.warnings.length > 0 && ` (${syncResult.warnings.length} portal${syncResult.warnings.length === 1 ? "" : "s"} reported a warning)`}
            {syncResult.sheet_url && (
              <>
                {" - "}
                <a href={syncResult.sheet_url} target="_blank" rel="noreferrer">Open sheet <ArrowUpRight size={13} /></a>
              </>
            )}
          </span>
          <button title="Dismiss" onClick={() => setSyncResult(null)}><X size={16} /></button>
        </div>
      )}

      {clickUpResult && clickUpResult.status !== "failed" && (
        <div className="success-banner" role="status">
          <Check size={17} />
          <span>
            Matched {clickUpResult.matched_aggregates} Aggregates and {clickUpResult.matched_general_construction} General Construction bids
            {" - "}created {clickUpResult.created}, skipped {clickUpResult.skipped} already in ClickUp
            {" - "}
            <a href={clickUpResult.aggregates_list_url} target="_blank" rel="noreferrer">Aggregates <ArrowUpRight size={13} /></a>
            {" / "}
            <a href={clickUpResult.general_construction_list_url} target="_blank" rel="noreferrer">General Construction <ArrowUpRight size={13} /></a>
          </span>
          <button title="Dismiss" onClick={() => setClickUpResult(null)}><X size={16} /></button>
        </div>
      )}

      <div className="workspace">
        <section className="operations-pane">
          <div className="metric-band">
            <div><span>Current opportunities</span><strong>{bids.length}</strong></div>
            <div><span>High fit</span><strong>{highFit}</strong></div>
            <div><span>Due in 14 days</span><strong>{dueSoon}</strong></div>
            <div><span>Pending approval</span><strong>{pending}</strong></div>
          </div>

          {view === "opportunities" ? (
            <>
              <div className="table-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bids, agencies, locations" />
                </label>
                <div className="filter-control">
                  <Filter size={16} />
                  <select value={platform} onChange={(event) => setPlatform(event.target.value)} aria-label="Filter by portal">
                    {PLATFORMS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div className="filter-control">
                  <Filter size={16} />
                  <select value={category} onChange={(event) => setCategory(event.target.value as BidCategory | "all")} aria-label="Filter by category">
                    <option value="all">All categories</option>
                    <option value="general">{CATEGORY_LABEL.general}</option>
                    <option value="aggregates">{CATEGORY_LABEL.aggregates}</option>
                    <option value="other">{CATEGORY_LABEL.other}</option>
                  </select>
                </div>
                <span className="result-count">{filtered.length} results</span>
              </div>

              <div className="bid-table-wrap">
                <table className="bid-table">
                  <thead><tr><th>Fit</th><th>Opportunity</th><th>Agency</th><th>Portal</th><th>Deadline</th><th aria-label="Open" /></tr></thead>
                  <tbody>
                    {filtered.map((bid) => {
                      const due = daysUntil(bid.due_date);
                      return (
                        <tr key={bid.dedupe_key} className={selected?.dedupe_key === bid.dedupe_key ? "selected" : ""} onClick={() => setSelectedKey(bid.dedupe_key)}>
                          <td><span className={`score score-${bid.score.label}`}>{bid.score.total}</span></td>
                          <td><strong>{bid.title}</strong><span>{bid.bid_id || "No reference"}</span></td>
                          <td>{bid.agency || "Unspecified"}<span>{bid.location || "Location pending"}</span></td>
                          <td><span className={`portal portal-${bid.platform.toLowerCase()}`}>{bid.platform}</span></td>
                          <td>{formatDueDate(bid.due_date)}<span className={due !== null && due <= 7 ? "urgent" : ""}>{due === null ? "" : due < 0 ? "Closed" : `${due} days`}</span></td>
                          <td><ChevronRight size={17} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!loading && filtered.length === 0 && (
                  <div className="empty-state"><ClipboardCheck size={24} /><strong>No matching opportunities</strong><span>Run a portal scan or adjust the filters.</span></div>
                )}
                {loading && <div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading opportunities</div>}
              </div>

              {selected && (
                <article className="bid-detail">
                  <div className="detail-heading">
                    <div><span className="eyebrow">Selected opportunity</span><h2>{selected.title}</h2><p>{selected.agency} {selected.location && `- ${selected.location}`}</p></div>
                    <div className="detail-actions">
                      <button className="secondary-button" onClick={() => prepareAction("google_sheets")}><FileSpreadsheet size={16} /> Sheets</button>
                      <button className="secondary-button" onClick={() => prepareAction("clickup")}><SquareKanban size={16} /> ClickUp</button>
                      {selected.bid_url && <a className="icon-button" href={selected.bid_url} target="_blank" title="Open source listing"><ArrowUpRight size={18} /></a>}
                    </div>
                  </div>
                  <div className="detail-grid">
                    <div><span>Fit score</span><strong>{selected.score.total}/100</strong></div>
                    <div><span>Deadline</span><strong>{formatDueDate(selected.due_date)}</strong></div>
                    <div><span>Estimated value</span><strong>{selected.estimated_value || "Not listed"}</strong></div>
                    <div><span>Profile version</span><strong>v{selected.score.profile_version}</strong></div>
                  </div>
                  <div className="score-evidence">
                    {selected.score.breakdown.map((item) => (
                      <span key={item.reason}><b>+{item.points}</b> {item.reason}</span>
                    ))}
                  </div>
                </article>
              )}
            </>
          ) : view === "approvals" ? (
            <section className="approvals-view">
              <div className="section-heading"><div><span className="eyebrow">External actions</span><h1>Approval queue</h1></div></div>
              <div className="approval-list">
                {proposals.map((item) => (
                  <button key={item.id} onClick={() => { setProposal(item); proposalDialog.current?.showModal(); }}>
                    {item.destination === "clickup" ? <SquareKanban size={19} /> : <FileSpreadsheet size={19} />}
                    <span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.destination.replace("_", " ")} - proposal #{item.id}</small></span>
                    <em className={`status-${item.status}`}>{item.status}</em><ChevronRight size={17} />
                  </button>
                ))}
                {proposals.length === 0 && <div className="empty-state"><Check size={24} /><strong>Approval queue is clear</strong></div>}
              </div>
            </section>
          ) : (
            <SiteMonitorView monitor={siteMonitor} loading={loadingSites} onRefresh={loadSiteMonitor} />
          )}
        </section>

        <aside className="chat-pane">
          <div className="chat-header"><div><Bot size={19} /><span><strong>Bid Copilot</strong><small>Gemini Flash</small></span></div><MessageSquareText size={17} /></div>
          <div className="messages" aria-live="polite">
            {messages.map((message, index) => <div key={index} className={`message ${message.role}`}>{message.text}</div>)}
            {chatting && <div className="message agent typing"><i /><i /><i /></div>}
          </div>
          <form className="chat-form" onSubmit={sendMessage}>
            {selected && <button type="button" className="context-chip" onClick={() => setChatInput(`Explain the score for ${selected.title}`)}>Selected: {selected.title}</button>}
            <div><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about bids or start an action" rows={2} /><button type="submit" title="Send message" disabled={!chatInput.trim() || chatting}><Send size={17} /></button></div>
          </form>
        </aside>
      </div>

      <ProfileDialog key={profile?.version ?? 0} dialogRef={profileDialog} profile={profile} onSaved={(saved) => setProfile(saved)} />
      <dialog ref={proposalDialog} className="modal">
        {proposal && (
          <div className="modal-body">
            <div className="modal-header"><div><span className="eyebrow">Action proposal #{proposal.id}</span><h2>Review external change</h2></div><button className="icon-button" title="Close" onClick={() => proposalDialog.current?.close()}><X size={18} /></button></div>
            <dl className="proposal-summary"><div><dt>Destination</dt><dd>{proposal.destination.replace("_", " ")}</dd></div><div><dt>Action</dt><dd>{proposal.action.replaceAll("_", " ")}</dd></div><div><dt>Records</dt><dd>{proposal.payload.rows?.length ?? proposal.payload.tasks?.length ?? 0}</dd></div><div><dt>Status</dt><dd>{proposal.status}</dd></div></dl>
            <div className="proposal-records">
              {(proposal.payload.rows ?? proposal.payload.tasks ?? []).map((record) => (
                <div key={record.dedupe_key}><span>{record.platform}</span><strong>{record.title}</strong><small>{record.agency || "Agency pending"}</small></div>
              ))}
            </div>
            <div className="hash-block"><span>Payload fingerprint</span><code>{proposal.payload_hash}</code></div>
            <div className="modal-footer"><button className="secondary-button" onClick={() => proposalDialog.current?.close()}>Close</button>{proposal.status === "pending" && <button className="primary-button" onClick={approveProposal}><Check size={17} /> Approve proposal</button>}</div>
          </div>
        )}
      </dialog>
      <dialog ref={logsDialog} className="modal logs-modal">
        <div className="modal-body">
          <div className="modal-header">
            <div><span className="eyebrow">Debug</span><h2>Scan &amp; sync logs</h2></div>
            <button className="icon-button" title="Close" onClick={() => logsDialog.current?.close()}><X size={18} /></button>
          </div>
          <div className="logs-list">
            {logEntries.length === 0 && <div className="empty-state"><ScrollText size={24} /><strong>No logs yet</strong><span>Run a scan or sync to see output here.</span></div>}
            {logEntries.map((entry) => (
              <div key={entry.id} className="log-entry">
                <div className="log-entry-header"><strong>{entry.source}</strong><span>{entry.time}</span></div>
                <pre>{entry.lines.join("\n")}</pre>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button className="secondary-button" onClick={() => setLogEntries([])} disabled={logEntries.length === 0}>Clear</button>
            <button className="secondary-button" onClick={() => logsDialog.current?.close()}>Close</button>
          </div>
        </div>
      </dialog>
    </main>
  );
}

function ProfileDialog({ dialogRef, profile, onSaved }: { dialogRef: React.RefObject<HTMLDialogElement | null>; profile: Profile | null; onSaved: (profile: Profile) => void }) {
  const [draft, setDraft] = useState<Profile | null>(profile);
  const [saving, setSaving] = useState(false);
  if (!draft) return <dialog ref={dialogRef} />;

  const setList = (key: keyof Profile, value: string) => setDraft({ ...draft, [key]: value.split(",").map((item) => item.trim()).filter(Boolean) });
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await api<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(draft) });
      onSaved(saved);
      dialogRef.current?.close();
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="modal profile-modal">
      <form className="modal-body" onSubmit={save}>
        <div className="modal-header"><div><span className="eyebrow">Scoring profile v{draft.version}</span><h2>Company fit criteria</h2></div><button type="button" className="icon-button" title="Close" onClick={() => dialogRef.current?.close()}><X size={18} /></button></div>
        <div className="profile-fields">
          <label><span>Service areas</span><input value={draft.service_areas.join(", ")} onChange={(event) => setList("service_areas", event.target.value)} /></label>
          <label><span>Preferred agencies</span><input value={draft.preferred_agencies.join(", ")} onChange={(event) => setList("preferred_agencies", event.target.value)} /></label>
          <label><span>Project terms</span><textarea rows={3} value={draft.project_terms.join(", ")} onChange={(event) => setList("project_terms", event.target.value)} /></label>
          <label><span>Material terms</span><textarea rows={3} value={draft.material_terms.join(", ")} onChange={(event) => setList("material_terms", event.target.value)} /></label>
          <label><span>Excluded terms</span><input value={draft.excluded_terms.join(", ")} onChange={(event) => setList("excluded_terms", event.target.value)} /></label>
          <label><span>Minimum lead days</span><input type="number" min="0" max="365" value={draft.minimum_lead_days} onChange={(event) => setDraft({ ...draft, minimum_lead_days: Number(event.target.value) })} /></label>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={() => dialogRef.current?.close()}>Cancel</button><button className="primary-button" disabled={saving}>{saving && <LoaderCircle className="spin" size={16} />} Save new version</button></div>
      </form>
    </dialog>
  );
}

const SITE_FILTERS: { key: SiteStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "warning", label: "Broken (parser)" },
  { key: "blocked", label: "Blocked (infra)" },
  { key: "never-run", label: "Never run" },
  { key: "stale", label: "Stale" },
  { key: "empty", label: "No open bids" },
  { key: "healthy", label: "Healthy" },
  { key: "disabled", label: "Disabled" },
];

function SiteMonitorView({ monitor, loading, onRefresh }: { monitor: SiteMonitor | null; loading: boolean; onRefresh: () => void }) {
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "all">("all");
  const [platformFilter, setPlatformFilter] = useState("All platforms");
  const [expanded, setExpanded] = useState<string>("");

  const sites = monitor?.sites ?? [];
  const platforms = ["All platforms", ...Array.from(new Set(sites.map((site) => site.platform)))];
  const visible = sites.filter((site) => {
    const statusMatch = statusFilter === "all" || site.status === statusFilter;
    const platformMatch = platformFilter === "All platforms" || site.platform === platformFilter;
    return statusMatch && platformMatch;
  });

  if (loading && !monitor) {
    return <section className="site-monitor"><div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading site monitor</div></section>;
  }
  if (!monitor) {
    return <section className="site-monitor"><div className="empty-state"><Globe size={24} /><strong>No monitor data</strong></div></section>;
  }

  const s = monitor.summary;

  return (
    <section className="site-monitor">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Scraping health</span>
          <h1>Site Monitor</h1>
        </div>
        <div className="site-monitor-freshness">
          <span><Clock size={14} /> Last scrape {relativeTime(monitor.generated_at)}</span>
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
      </div>

      {!monitor.has_report && (
        <div className="site-monitor-hint">
          <TriangleAlert size={16} />
          <span>No scrape report yet. Run <b>Scrape + sync sheet</b> to populate per-site results.</span>
        </div>
      )}

      <div className="site-summary-grid">
        <button className={`site-summary-card ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          <span>Configured</span><strong>{s.configured}</strong><small>{s.enabled} enabled</small>
        </button>
        <button className={`site-summary-card ok ${statusFilter === "healthy" ? "active" : ""}`} onClick={() => setStatusFilter("healthy")}>
          <span>Healthy</span><strong>{s.healthy}</strong><small>returned bids</small>
        </button>
        <button className={`site-summary-card warn ${statusFilter === "warning" ? "active" : ""}`} onClick={() => setStatusFilter("warning")}>
          <span>Broken</span><strong>{s.warning}</strong><small>parser: no rows</small>
        </button>
        <button className={`site-summary-card blocked ${statusFilter === "blocked" ? "active" : ""}`} onClick={() => setStatusFilter("blocked")}>
          <span>Blocked</span><strong>{s.blocked}</strong><small>infra / anti-bot</small>
        </button>
        <button className={`site-summary-card stale ${statusFilter === "stale" ? "active" : ""}`} onClick={() => setStatusFilter("stale")}>
          <span>Stale</span><strong>{s.stale}</strong><small>using cached</small>
        </button>
        <button className={`site-summary-card neutral ${statusFilter === "empty" ? "active" : ""}`} onClick={() => setStatusFilter("empty")}>
          <span>No open bids</span><strong>{s.empty}</strong><small>ran clean</small>
        </button>
        <button className={`site-summary-card muted ${statusFilter === "never-run" ? "active" : ""}`} onClick={() => setStatusFilter("never-run")}>
          <span>Never run</span><strong>{s.never_run}</strong><small>no report row</small>
        </button>
      </div>

      <div className="site-platform-band">
        {monitor.platforms.map((row) => (
          <div key={row.platform} className="site-platform-chip">
            <strong>{row.platform}</strong>
            <span>{row.total} sites</span>
            <em>
              {row.healthy > 0 && <i className="dot ok" title={`${row.healthy} healthy`}>{row.healthy}</i>}
              {row.warning > 0 && <i className="dot warn" title={`${row.warning} broken (parser)`}>{row.warning}</i>}
              {row.blocked > 0 && <i className="dot blocked" title={`${row.blocked} blocked (infra)`}>{row.blocked}</i>}
              {row.stale > 0 && <i className="dot stale" title={`${row.stale} stale`}>{row.stale}</i>}
              {row["never-run"] > 0 && <i className="dot muted" title={`${row["never-run"]} never run`}>{row["never-run"]}</i>}
            </em>
          </div>
        ))}
      </div>

      <div className="table-toolbar">
        <div className="site-filter-chips">
          {SITE_FILTERS.map((filter) => (
            <button key={filter.key} className={statusFilter === filter.key ? "active" : ""} onClick={() => setStatusFilter(filter.key)}>
              {filter.label}
            </button>
          ))}
        </div>
        <div className="filter-control">
          <Filter size={16} />
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} aria-label="Filter by platform">
            {platforms.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <span className="result-count">{visible.length} sites</span>
      </div>

      <div className="site-list">
        {visible.map((site) => {
          const open = expanded === site.id;
          return (
            <div key={site.id} className={`site-row status-${site.status}`}>
              <button className="site-row-head" onClick={() => setExpanded(open ? "" : site.id)}>
                <span className="site-row-badges">
                  <span className={`site-status-badge status-${site.status}`}>{SITE_STATUS_LABEL[site.status]}</span>
                  {site.block_kind && <span className={`site-block-badge block-${site.block_kind}`}>{BLOCK_KIND_LABEL[site.block_kind]}</span>}
                </span>
                <span className="site-row-agency">
                  <strong>{site.agency || site.id}</strong>
                  <small>{site.location || site.id} - {site.platform}{site.via === "real-chrome" && " - via real Chrome"}</small>
                </span>
                <span className="site-row-count">
                  {site.count > 0
                    ? `${site.count} bids`
                    : site.retained_count > 0
                      ? `${site.retained_count} cached`
                      : site.bid_total > 0
                        ? `${site.bid_total} cached`
                        : "0 bids"}
                </span>
                {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
              </button>
              {open && (
                <div className="site-row-detail">
                  {site.warning && <div className="site-warning"><TriangleAlert size={14} /> {site.warning}</div>}
                  <div className="site-detail-meta">
                    <span>Priority <b>{site.priority ?? "-"}</b></span>
                    <span>County <b>{site.county || "-"}</b></span>
                    {site.url && <a href={site.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={13} /></a>}
                  </div>
                  {site.bids.length > 0 ? (
                    <ul className="site-bid-list">
                      {site.bids.map((bid, index) => (
                        <li key={`${bid.bid_id}-${index}`}>
                          {bid.bid_url ? <a href={bid.bid_url} target="_blank" rel="noreferrer">{bid.title}</a> : <span>{bid.title}</span>}
                          <small>{bid.bid_id || "no ref"}{bid.due_date && ` - due ${bid.due_date}`}</small>
                        </li>
                      ))}
                      {site.bid_total > site.bids.length && <li className="site-bid-more">+ {site.bid_total - site.bids.length} more</li>}
                    </ul>
                  ) : (
                    <p className="site-bid-empty">No scraped bids on record for this site.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="empty-state"><Globe size={24} /><strong>No sites match this filter</strong></div>}
      </div>
    </section>
  );
}
