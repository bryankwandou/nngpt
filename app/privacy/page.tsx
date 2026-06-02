import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — nngpt",
  description: "How nngpt collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  const updated = "2026-06-02";
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-[var(--color-text)]" style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <div className="mb-8">
        <Link href="/" className="text-sm text-[var(--color-accent)] hover:underline">← Back to nngpt</Link>
      </div>
      <h1 className="mb-2 text-2xl font-bold">Privacy Policy</h1>
      <p className="mb-8 text-sm text-[var(--color-text-dim)]">Last updated: {updated}</p>

      <section className="space-y-6 text-[15px] leading-relaxed text-[var(--color-text-secondary)]">

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">1. Operator</h2>
          <p>nngpt is operated by nayrbryanGaming (Indonesia). Contact: nayrbryangaming3@gmail.com</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">2. Data We Collect</h2>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Account data</strong>: username, email address, password hash (scrypt — never plaintext).</li>
            <li><strong>Chat history</strong>: your conversation messages, stored encrypted-at-rest in Neon PostgreSQL (SOC 2 Type II, hosted on AWS).</li>
            <li><strong>API keys</strong>: stored only in your browser&apos;s localStorage — never transmitted to our servers.</li>
            <li><strong>Usage logs</strong>: standard server logs (IP, timestamp, HTTP status) retained ≤ 30 days.</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">3. How We Use Your Data</h2>
          <ul className="ml-4 list-disc space-y-1">
            <li>Authenticate your account and sync chat history across devices.</li>
            <li>Provide the AI chat service by forwarding your messages to the selected AI provider (OpenAI, Jatevo, Qwen, etc.).</li>
            <li>Detect abuse and enforce rate limits.</li>
          </ul>
          <p className="mt-2">We do <strong>not</strong> sell your data, train AI models on your conversations, or share data with third parties except the AI providers you explicitly select.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">4. Third-Party AI Providers</h2>
          <p>When you send a message, it is forwarded to the AI provider configured in your settings (e.g., Jatevo, OpenAI, Alibaba Qwen). Each provider has its own privacy policy. Your API key is sent from your browser directly — it is never logged by nngpt servers.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">5. Data Retention & Deletion</h2>
          <ul className="ml-4 list-disc space-y-1">
            <li>Chat history and account data are retained until you delete them or request deletion.</li>
            <li>Sessions expire after 30 days.</li>
            <li>To delete all your data, email nayrbryangaming3@gmail.com with subject "Data Deletion Request".</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">6. Your Rights (UU PDP No. 27/2022 — Indonesia)</h2>
          <p>Under Indonesia&apos;s Personal Data Protection Law (UU PDP), you have the right to:</p>
          <ul className="ml-4 mt-1 list-disc space-y-1">
            <li>Access your personal data.</li>
            <li>Correct inaccurate personal data.</li>
            <li>Request deletion of your personal data.</li>
            <li>Object to processing of your personal data.</li>
            <li>Withdraw consent at any time.</li>
          </ul>
          <p className="mt-2">To exercise these rights, contact: nayrbryangaming3@gmail.com</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">7. Security</h2>
          <ul className="ml-4 list-disc space-y-1">
            <li>Passwords hashed with scrypt (industry standard, resistant to GPU attacks).</li>
            <li>All traffic encrypted via HTTPS/TLS 1.3.</li>
            <li>Database hosted on Neon PostgreSQL (SOC 2 Type II certified, TLS required).</li>
            <li>Server-side session tokens with 30-day expiry; invalidated on logout.</li>
            <li>Rate limiting on all authentication endpoints to prevent brute-force attacks.</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">8. Cookies & Local Storage</h2>
          <p>nngpt uses browser localStorage (not cookies) to store your session token, settings, and offline chat cache. No third-party tracking cookies are used.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">9. Children</h2>
          <p>nngpt is not directed to children under 13. If you are under 13, do not use this service.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">10. Changes</h2>
          <p>We may update this policy. The &quot;Last updated&quot; date at the top reflects the most recent revision. Continued use after changes constitutes acceptance.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">Contact</h2>
          <p>Email: nayrbryangaming3@gmail.com</p>
        </div>
      </section>

      <div className="mt-12 flex gap-4 text-sm text-[var(--color-text-dim)]">
        <Link href="/terms" className="hover:text-[var(--color-accent)]">Terms of Service</Link>
        <Link href="/" className="hover:text-[var(--color-accent)]">← Back to nngpt</Link>
      </div>
    </div>
  );
}
