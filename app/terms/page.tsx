import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — nngpt",
  description: "Terms governing your use of nngpt.",
};

export default function TermsPage() {
  const updated = "2026-06-02";
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-[var(--color-text)]" style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <div className="mb-8">
        <Link href="/" className="text-sm text-[var(--color-accent)] hover:underline">← Back to nngpt</Link>
      </div>
      <h1 className="mb-2 text-2xl font-bold">Terms of Service</h1>
      <p className="mb-8 text-sm text-[var(--color-text-dim)]">Last updated: {updated}</p>

      <section className="space-y-6 text-[15px] leading-relaxed text-[var(--color-text-secondary)]">

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">1. Acceptance</h2>
          <p>By using nngpt you agree to these Terms. If you do not agree, do not use the service.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">2. Service Description</h2>
          <p>nngpt is an AI chat interface that lets you interact with various AI language models using your own API keys. The operator does not provide AI capabilities — it proxies requests to third-party AI providers you configure.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">3. Acceptable Use</h2>
          <p>You must not use nngpt to:</p>
          <ul className="ml-4 mt-1 list-disc space-y-1">
            <li>Generate illegal content or content that violates applicable Indonesian law (ITE Law, UU PDP).</li>
            <li>Harass, threaten, or harm others.</li>
            <li>Attempt to reverse-engineer, scrape, or abuse the service.</li>
            <li>Circumvent rate limits or security measures.</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">4. API Keys & Third-Party Services</h2>
          <p>You are responsible for your own API keys and any costs incurred with third-party AI providers. nngpt stores your API keys only in your browser and is not responsible for unauthorized use of your keys if your device is compromised.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">5. Disclaimer of Warranties</h2>
          <p>nngpt is provided &quot;as is&quot; without warranty of any kind. AI responses may be inaccurate. Do not rely on AI output for medical, legal, or financial decisions.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text[var(--color-text)]">6. Limitation of Liability</h2>
          <p>To the extent permitted by law, the operator shall not be liable for any indirect, incidental, or consequential damages arising from your use of nngpt.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">7. Governing Law</h2>
          <p>These Terms are governed by the laws of the Republic of Indonesia. Any disputes shall be resolved under Indonesian jurisdiction.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">8. Changes</h2>
          <p>We may update these Terms. Continued use after changes constitutes acceptance of the revised Terms.</p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-[var(--color-text)]">Contact</h2>
          <p>nayrbryangaming3@gmail.com</p>
        </div>
      </section>

      <div className="mt-12 flex gap-4 text-sm text-[var(--color-text-dim)]">
        <Link href="/privacy" className="hover:text-[var(--color-accent)]">Privacy Policy</Link>
        <Link href="/" className="hover:text-[var(--color-accent)]">← Back to nngpt</Link>
      </div>
    </div>
  );
}
