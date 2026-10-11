'use client';

import Link from 'next/link';
import { useState } from 'react';
import { sendEmail } from '@/app/gmail-actions';

export type TemplateOption = { id: number; name: string; subject: string; body: string };

// Fill {{company}} / {{job}} / … from the lead; leave unknown placeholders as-is.
function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

export function EmailComposer({
  listingId,
  configured,
  fromEmail,
  to,
  subject,
  threaded,
  templates,
  vars,
}: {
  listingId: number;
  configured: boolean;
  fromEmail?: string;
  to: string;
  subject: string;
  threaded: boolean;
  templates: TemplateOption[];
  vars: Record<string, string>;
}) {
  const [subjectText, setSubjectText] = useState(subject);
  const [bodyText, setBodyText] = useState('');

  function applyTemplate(id: string) {
    const t = templates.find((x) => String(x.id) === id);
    if (!t) return;
    if (t.subject) setSubjectText(fill(t.subject, vars));
    setBodyText(fill(t.body, vars));
  }

  return (
    <form action={sendEmail} className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{threaded ? 'Reply by email' : 'Send email'}</h2>
        {fromEmail && <span className="truncate text-xs text-zinc-400">from {fromEmail}</span>}
      </div>

      {!configured ? (
        <p className="text-sm text-zinc-500">Email sending isn’t set up on this workspace yet.</p>
      ) : !fromEmail ? (
        <p className="text-sm text-zinc-500">
          Connect your Gmail in{' '}
          <Link href="/settings" className="text-indigo-600 hover:underline">
            Settings
          </Link>{' '}
          to send from the CRM.
        </p>
      ) : (
        <>
          <input type="hidden" name="id" value={listingId} />

          {templates.length > 0 && (
            <div>
              <label className="label">Template</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  applyTemplate(e.target.value);
                  e.target.selectedIndex = 0;
                }}
                className="input"
              >
                <option value="">Insert a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input name="to" defaultValue={to} placeholder="Recipient email" required className="input" />
          <input
            name="subject"
            value={subjectText}
            onChange={(e) => setSubjectText(e.target.value)}
            placeholder="Subject"
            className="input"
          />
          <textarea
            name="body"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={16}
            placeholder="Write your message, or insert a template above…"
            required
            className="input min-h-[24rem] resize-y font-sans leading-relaxed"
          />
          <p className="text-xs text-zinc-500">
            {threaded ? 'Continues the existing email thread. ' : ''}Goes out from your Gmail and is logged as a pitch here.
          </p>
          <button className="btn btn-primary w-full">{threaded ? 'Send reply' : 'Send email'}</button>
        </>
      )}
    </form>
  );
}
