import type { Stage } from '@/db/schema';
import { STAGES } from '@/db/schema';

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New',
  pitched: 'Pitched',
  replied: 'Replied',
  meeting: 'Meeting',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
  skipped: 'Skipped',
};

export const STAGE_CLASS: Record<Stage, string> = {
  new: 'bg-sky-100 text-sky-800',
  pitched: 'bg-amber-100 text-amber-800',
  replied: 'bg-emerald-100 text-emerald-800',
  meeting: 'bg-teal-100 text-teal-800',
  proposal: 'bg-violet-100 text-violet-800',
  won: 'bg-green-600 text-white',
  lost: 'bg-zinc-200 text-zinc-600',
  skipped: 'bg-zinc-100 text-zinc-500',
};

export const CHANNEL_LABEL: Record<string, string> = {
  cl_reply: 'Craigslist reply',
  email: 'Email',
  phone: 'Phone',
  text: 'Text',
  website: 'Website form',
  linkedin: 'LinkedIn',
  other: 'Other',
};

export const stageIndex = (s: Stage) => STAGES.indexOf(s);
export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);

export function fmtDate(d: Date | null | undefined, withTime = false) {
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export function ago(d: Date | null | undefined) {
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000);
