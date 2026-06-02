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

interface Request {
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
  gpt_base_url: string;
  qwen_key: string;
  qwen_base_url: string;
  qwen_model: string;
  telegram_token: string;
  usage: Usage | null;
  requests: { requests: Request[] } | null;
  qwen_usage: unknown;
  fetched_at: string;
}

// Admin-only user (checked after server login — no password in client code)
const ADMIN_USER = "nayrbryanGaming";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUSD(n: number) {
  return "$" + fmt(n, 4);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
}

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return `${d}d ${h}h`;
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-mono bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#444] text-[#10a37f] transition-colors"
    >
      {copied ? "✓ Copied" : (label ?? "Copy")}
    </button>
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
    setLoginLoading(true);
    setErr("");
    try {
      const result = await loginWithPassword(user, pass);
      if ("session" in result) {
        if (result.session.username.toLowerCase() !== ADMIN_USER.toLowerCase()) {
          setErr("Access denied. Admin only.");
          clearSession();
        } else {
          setSession(result.session);
        }
      } else {
        setErr(result.error);
      }
    } catch {
      setErr("Network error. Try again.");
    }
    setLoginLoading(false);
  }

  function logout() {
    clearSession();
    setSession(null);
    setData(null);
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
            <button type="submit" disabled={loginLoading} className="w-full bg-[#10a37f] hover:bg-[#0e8f6f] disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {loginLoading ? "Signing in…" : "Login"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const usage = data?.usage;
  const reqs = data?.requests?.requests ?? [];
  const monthlyLimit = usage?.limits?.find(l => l.limit_window === "monthly");
  const usedUSD = monthlyLimit ? monthlyLimit.current_value / 1_000_000 : (usage?.total_cost_usd ?? 0);
  const limitUSD = monthlyLimit ? monthlyLimit.max_value / 1_000_000 : 100;
  const leftUSD = monthlyLimit ? monthlyLimit.remaining_value / 1_000_000 : limitUSD - usedUSD;
  const pct = limitUSD > 0 ? Math.min((usedUSD / limitUSD) * 100, 100) : 0;
  const avgCost = usage && usage.request_count > 0 ? usage.total_cost_usd / usage.request_count : 0;
  const cacheRate = usage && usage.total_tokens > 0 ? (usage.cached_input_tokens / usage.total_tokens * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="border-b border-[#2a2a2a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div>
            <h1 className="font-bold text-lg">nngpt Dashboard</h1>
            <p className="text-xs text-[#888]">Live Usage Cockpit · {ADMIN_USER}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-[#666]">Last: {lastRefresh}</span>}
          <button onClick={() => session.sessionId && fetchData(session.sessionId)} disabled={loading}
            className="px-4 py-2 bg-[#10a37f] hover:bg-[#0e8f6f] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            {loading ? "⟳ Fetching..." : "⟳ Refresh"}
          </button>
          <button onClick={logout} className="px-3 py-2 text-xs text-[#888] hover:text-white border border-[#333] rounded-lg transition-colors">
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* GPT API Key Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[#10a37f] font-bold">GPT</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">Jatevo Balancer — lb.jatevo.ai</span>
            <span className="ml-2 px-2 py-0.5 bg-[#10a37f]/20 text-[#10a37f] text-xs rounded-full">● API key connected</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-[#666] mb-1.5">API Key (Full)</p>
              <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
                <code className="flex-1 text-sm font-mono text-[#10a37f] break-all">{data?.gpt_key ?? "—"}</code>
                {data?.gpt_key && <CopyBtn text={data.gpt_key} label="Copy Key" />}
              </div>
            </div>
            <div>
              <p className="text-xs text-[#666] mb-1.5">Base URL</p>
              <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
                <code className="flex-1 text-sm font-mono text-[#888]">{data?.gpt_base_url ?? "—"}</code>
                {data?.gpt_base_url && <CopyBtn text={data.gpt_base_url} label="Copy URL" />}
              </div>
            </div>
          </div>
        </div>

        {/* Usage Stats Grid */}
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Cost", value: fmtUSD(usage.total_cost_usd), sub: `${fmt(avgCost * 1000, 3)}m / req avg` },
              { label: "Requests", value: usage.request_count.toString(), sub: `${reqs.length} recent indexed` },
              { label: "Total Tokens", value: usage.total_tokens.toLocaleString(), sub: `${usage.cached_input_tokens} cached` },
              { label: "Cache Rate", value: `${fmt(cacheRate, 1)}%`, sub: "cached input / total" },
            ].map(s => (
              <div key={s.label} className="bg-[#1a1a1a] rounded-xl p-5 border border-[#2a2a2a]">
                <p className="text-xs text-[#666] mb-1">{s.label}</p>
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-[#555] mt-1">{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quota Pressure */}
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
                  background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10a37f'
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

        {/* Recent Activity */}
        {reqs.length > 0 && (
          <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">Recent Activity · {reqs.length} total</h2>
            </div>
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
                  {reqs.map((r, i) => (
                    <tr key={i} className="border-b border-[#1f1f1f] hover:bg-[#222] transition-colors">
                      <td className="py-2 pr-4 text-[#888] whitespace-nowrap">{fmtTime(r.requested_at)}</td>
                      <td className="py-2 pr-4 font-mono text-[#10a37f]">{r.model}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full ${r.status === 'ok' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                          {r.status === 'ok' ? '✓ OK' : '✗ ' + (r.error_code ?? r.status)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-[#888]">{r.tokens.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-white">{fmtUSD(r.cost_usd)}</td>
                      <td className="py-2 text-right text-[#888]">{(r.latency_ms / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Qwen Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-orange-400 font-bold">QWEN</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">jatevo.ai/private-ai · {data?.qwen_model}</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-[#666] mb-1.5">Qwen API Key</p>
              <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
                <code className="flex-1 text-sm font-mono text-orange-400 break-all">{data?.qwen_key ?? "—"}</code>
                {data?.qwen_key && <CopyBtn text={data.qwen_key} label="Copy Key" />}
              </div>
            </div>
            <div>
              <p className="text-xs text-[#666] mb-1.5">Base URL</p>
              <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
                <code className="flex-1 text-sm font-mono text-[#888]">{data?.qwen_base_url ?? "—"}</code>
                {data?.qwen_base_url && <CopyBtn text={data.qwen_base_url} label="Copy URL" />}
              </div>
            </div>
          </div>
        </div>

        {/* Telegram Section */}
        <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-blue-400 font-bold">TELEGRAM</span>
            <span className="text-[#444]">·</span>
            <span className="text-sm text-[#888]">Bot Token</span>
          </div>
          <div>
            <p className="text-xs text-[#666] mb-1.5">Bot Token</p>
            <div className="flex items-center gap-3 bg-[#111] rounded-lg px-4 py-3 border border-[#333]">
              <code className="flex-1 text-sm font-mono text-blue-400 break-all">{data?.telegram_token ?? "—"}</code>
              {data?.telegram_token && <CopyBtn text={data.telegram_token} label="Copy Token" />}
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-[#444] pb-4">
          Last fetched: {data?.fetched_at ? fmtTime(data.fetched_at) : "—"} WIB
        </div>
      </div>
    </div>
  );
}
