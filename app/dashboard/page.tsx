"use client";

import { useEffect, useState, useCallback } from "react";
import { loginWithPassword, clearSession, type Session } from "@/lib/auth";

interface Limit {
  limit_type: string;
  limit_window: string;
  max_value: number;
  current_value: number;
  remaining_value: number;
  reset_at: string;
  source: string;
}

interface RequestItem {
  requested_at: string;
  request_id: string;
  model: string;
  status: string;
  error_code: string | null;
  tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  latency_ms: number;
  latency_first_token_ms: number;
}

interface Usage {
  request_count: number;
  total_tokens: number;
  cached_input_tokens: number;
  total_cost_usd: number;
  limits: Limit[];
  upstream_limits: Limit[];
}

interface DashData {
  gpt_key: string;
  gpt_key_full: string;
  gpt_base_url: string;
  qwen_key: string;
  qwen_key_full: string;
  qwen_base_url: string;
  qwen_model: string;
  telegram_token: string;
  telegram_token_full: string;
  usage: Usage | null;
  requests: { requests: RequestItem[] } | { request_count?: number; data?: RequestItem[] } | null;
  qwen_usage: unknown;
  synced_from_bot: boolean;
  fetched_at: string;
}

const ADMIN_USER = "nayrbryanGaming";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtUSD(n: number) { return "$" + fmt(n, 4); }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
}
function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  return `${Math.floor(ms / 86400000)}d ${Math.floor((ms % 86400000) / 3600000)}h`;
}

function KeyRow({ label, display, full, color = "#10a37f" }: { label: string; display: string; full: string; color?: string }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const copy = () => {
    if (!full) return;
    navigator.clipboard.writeText(full);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <p className="text-xs text-[#666] mb-1.5">{label}</p>
      <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
        <code className="flex-1 text-sm font-mono break-all" style={{ color }}>
          {show && full ? full : (display || "—")}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          {full && (
            <button onClick={() => setShow(v => !v)}
              className="text-[10px] px-2 py-1 rounded bg-[#2a2a2a] border border-[#444] text-[#888] hover:text-white">
              {show ? "Hide" : "Show"}
            </button>
          )}
          {full && (
            <button onClick={copy}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-mono bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#444] transition-colors"
              style={{ color }}>
              {copied ? "✓ Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchData = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const r = await fetch("/api/dashboard", {
        headers: { authorization: `Bearer ${sid}` },
      });
      if (r.ok) {
        const d = await r.json() as DashData;
        setData(d);
      }
      setLastRefresh(new Date().toLocaleTimeString("id-ID"));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session?.sessionId) fetchData(session.sessionId);
  }, [session, fetchData]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true); setErr("");
    try {
      const result = await loginWithPassword(user, pass);
      if ("session" in result) {
        if (result.session.username.toLowerCase() !== ADMIN_USER.toLowerCase()) {
          setErr("Access denied. Admin only."); clearSession();
        } else {
          setSession(result.session);
        }
      } else {
        setErr(result.error);
      }
    } catch { setErr("Network error. Try again."); }
    setLoginLoading(false);
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] flex items-center justify-center">
        <form onSubmit={login} className="w-full max-w-sm bg-[#1a1a1a] rounded-2xl p-8 border border-[#2a2a2a] shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">📊</div>
            <h1 className="text-xl font-bold text-white">nngpt Dashboard</h1>
            <p className="text-sm text-[#888] mt-1">Admin access only</p>
          </div>
          <div className="space-y-4">
            <input value={user} onChange={e => setUser(e.target.value)} placeholder="Username" autoComplete="username"
              className="w-full bg-[#111] border border-[#333] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-[#10a37f]" />
            <input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="Password" autoComplete="current-password"
              className="w-full bg-[#111] border border-[#333] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-[#10a37f]" />
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <button type="submit" disabled={loginLoading}
              className="w-full bg-[#10a37f] hover:bg-[#0e8f6f] disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {loginLoading ? "Signing in…" : "Login"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const usage = data?.usage;
  // Normalize requests: could be { requests: [...] } or { data: [...] } or direct array
  const rawReqs = data?.requests;
  const reqs: RequestItem[] = Array.isArray(rawReqs) ? rawReqs
    : (rawReqs as { requests?: RequestItem[] })?.requests
    ?? (rawReqs as { data?: RequestItem[] })?.data
    ?? [];

  const monthlyLimit = usage?.limits?.find(l => l.limit_window === "monthly");
  const usedUSD   = monthlyLimit ? monthlyLimit.current_value / 1_000_000 : (usage?.total_cost_usd ?? 0);
  const limitUSD  = monthlyLimit ? monthlyLimit.max_value / 1_000_000 : 100;
  const leftUSD   = monthlyLimit ? monthlyLimit.remaining_value / 1_000_000 : limitUSD - usedUSD;
  const pct       = limitUSD > 0 ? Math.min((usedUSD / limitUSD) * 100, 100) : 0;
  const avgCost   = usage && usage.request_count > 0 ? usage.total_cost_usd / usage.request_count : 0;
  const cacheRate = usage && usage.total_tokens > 0 ? (usage.cached_input_tokens / usage.total_tokens * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="border-b border-[#2a2a2a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div>
            <h1 className="font-bold text-lg">nngpt Dashboard</h1>
            <p className="text-xs text-[#888]">
              Live Usage Cockpit · {ADMIN_USER}
              {data?.synced_from_bot && <span className="ml-2 text-[#10a37f]">● Bot synced</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-[#666]">Last: {lastRefresh}</span>}
          <button onClick={() => session.sessionId && fetchData(session.sessionId)} disabled={loading}
            className="px-4 py-2 bg-[#10a37f] hover:bg-[#0e8f6f] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            {loading ? "⟳ Fetching..." : "⟳ Refresh"}
          </button>
          <button onClick={() => { clearSession(); setSession(null); setData(null); }}
            className="px-3 py-2 text-xs text-[#888] hover:text-white border border-[#333] rounded-lg transition-colors">
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* GPT / Jatevo LB Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[#10a37f] font-bold">GPT</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">Jatevo Balancer — lb.jatevo.ai</span>
            <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${data?.gpt_key_full ? "bg-[#10a37f]/20 text-[#10a37f]" : "bg-[#333] text-[#666]"}`}>
              {data?.gpt_key_full ? "● Connected" : "● Not configured"}
            </span>
          </div>
          <div className="space-y-3">
            <KeyRow label="API Key (Jatevo LB)" display={data?.gpt_key ?? "—"} full={data?.gpt_key_full ?? ""} color="#10a37f" />
            <KeyRow label="Base URL" display={data?.gpt_base_url ?? "—"} full={data?.gpt_base_url ?? ""} color="#888" />
          </div>
        </div>

        {/* Usage Stats Grid */}
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Cost", value: fmtUSD(usage.total_cost_usd), sub: `${fmt(avgCost * 1000, 3)}m avg/req` },
              { label: "Requests", value: usage.request_count.toLocaleString(), sub: `${reqs.length} recent` },
              { label: "Total Tokens", value: usage.total_tokens.toLocaleString(), sub: `${usage.cached_input_tokens.toLocaleString()} cached` },
              { label: "Cache Rate", value: `${fmt(cacheRate, 1)}%`, sub: "cached / total" },
            ].map(s => (
              <div key={s.label} className="bg-[#1a1a1a] rounded-xl p-5 border border-[#2a2a2a]">
                <p className="text-xs text-[#666] mb-1">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-[#555] mt-1">{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Monthly quota bar */}
        {monthlyLimit && (
          <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">Monthly Quota Pressure</h2>
              <span className="text-xs text-[#888]">Resets {timeLeft(monthlyLimit.reset_at)}</span>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex-1 bg-[#111] rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${pct}%`,
                  background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10a37f',
                }} />
              </div>
              <span className="text-sm font-bold text-white w-12 text-right">{fmt(pct, 1)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-xs text-[#666]">Used</p><p className="font-semibold text-white">{fmtUSD(usedUSD)}</p></div>
              <div><p className="text-xs text-[#666]">Left</p><p className="font-semibold text-[#10a37f]">{fmtUSD(leftUSD)}</p></div>
              <div><p className="text-xs text-[#666]">Limit</p><p className="font-semibold text-white">{fmtUSD(limitUSD)}</p></div>
            </div>
          </div>
        )}

        {/* No usage data notice */}
        {!loading && !usage && data && (
          <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#333] border-dashed">
            <p className="text-[#666] text-sm text-center">
              ⚠️ Usage data unavailable — Jatevo LB may not expose a <code className="text-[#888]">/usage</code> endpoint for this key type.
              <br />
              <span className="text-[#555]">Refresh after a few requests, or check lb.jatevo.ai directly.</span>
            </p>
          </div>
        )}

        {/* Upstream rate limits */}
        {usage?.upstream_limits && usage.upstream_limits.length > 0 && (
          <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
            <h2 className="font-semibold text-sm mb-4">Upstream Rate Limits</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {usage.upstream_limits.map((l, i) => {
                const p = l.max_value > 0 ? Math.min((l.current_value / l.max_value) * 100, 100) : 0;
                return (
                  <div key={i} className="bg-[#111] rounded-xl p-4 border border-[#2a2a2a]">
                    <div className="flex justify-between mb-2">
                      <span className="text-xs text-[#888] capitalize">{l.limit_window} · {l.limit_type}</span>
                      <span className="text-xs text-[#666]">reset {timeLeft(l.reset_at)}</span>
                    </div>
                    <div className="bg-[#1a1a1a] rounded-full h-2 mb-2">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${p}%` }} />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#666]">{l.current_value.toLocaleString()} used</span>
                      <span className="text-white">{l.max_value.toLocaleString()} max</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent requests */}
        {reqs.length > 0 && (
          <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
            <h2 className="font-semibold text-sm mb-4">Recent Activity · {reqs.length} total</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#666] border-b border-[#2a2a2a]">
                    <th className="text-left py-2 pr-4 font-medium">Time (WIB)</th>
                    <th className="text-left py-2 pr-4 font-medium">Model</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-right py-2 pr-4 font-medium">Tokens</th>
                    <th className="text-right py-2 pr-4 font-medium">Cost</th>
                    <th className="text-right py-2 font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-[#1f1f1f] hover:bg-[#222]">
                      <td className="py-2 pr-4 text-[#888] whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                      <td className="py-2 pr-4 font-mono text-[#10a37f]">{r.model}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full ${r.status === "ok" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                          {r.status === "ok" ? "✓ OK" : `✗ ${r.error_code ?? r.status}`}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-[#888]">{(r.tokens ?? 0).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-white">{fmtUSD(r.cost_usd ?? 0)}</td>
                      <td className="py-2 text-right text-[#888]">{((r.latency_ms ?? 0) / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Qwen / Jatevo Direct Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-orange-400 font-bold">QWEN</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">Jatevo Direct · {data?.qwen_model ?? "qwen3.5-plus"}</span>
            <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${data?.qwen_key_full ? "bg-orange-900/30 text-orange-400" : "bg-[#333] text-[#666]"}`}>
              {data?.qwen_key_full ? "● Connected" : "● Key not set"}
            </span>
          </div>
          {!data?.qwen_key_full && (
            <div className="mb-3 rounded-lg border border-orange-900/40 bg-orange-900/10 px-3 py-2 text-xs text-orange-300">
              Add <code className="font-mono">QWEN_API_KEY</code> or <code className="font-mono">JATEVO_API_KEY</code> in Vercel environment variables,
              or use <code className="font-mono">/setapi qwen sk-...</code> in the Telegram bot (auto-syncs here).
            </div>
          )}
          <div className="space-y-3">
            <KeyRow label="Qwen API Key (JATEVO_API_KEY / QWEN_API_KEY)" display={data?.qwen_key ?? "—"} full={data?.qwen_key_full ?? ""} color="#fb923c" />
            <KeyRow label="Base URL" display={data?.qwen_base_url ?? "—"} full={data?.qwen_base_url ?? ""} color="#888" />
          </div>
        </div>

        {/* Telegram Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-blue-400 font-bold">TELEGRAM</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">Bot Token</span>
            <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${data?.telegram_token_full ? "bg-blue-900/30 text-blue-400" : "bg-[#333] text-[#666]"}`}>
              {data?.telegram_token_full ? "● Connected" : "● Not configured"}
            </span>
          </div>
          {!data?.telegram_token_full && (
            <div className="mb-3 rounded-lg border border-blue-900/40 bg-blue-900/10 px-3 py-2 text-xs text-blue-300">
              Add <code className="font-mono">TELEGRAM_BOT_TOKEN</code> in Vercel environment variables.
            </div>
          )}
          <KeyRow label="Bot Token" display={data?.telegram_token ?? "—"} full={data?.telegram_token_full ?? ""} color="#60a5fa" />
        </div>

        <div className="text-center text-xs text-[#444] pb-4">
          Last fetched: {data?.fetched_at ? fmtTime(data.fetched_at) : "—"} WIB
          {data?.synced_from_bot && <span className="ml-2 text-[#10a37f]">· Bot sync active</span>}
        </div>
      </div>
    </div>
  );
}
