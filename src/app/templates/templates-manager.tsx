'use client';

import { useState } from 'react';
import { deleteTemplate, saveTemplate } from '@/app/actions';

type Template = { id: number; name: string; category: string; subject: string; body: string };
type Cat = { key: string; label: string };

export function TemplatesManager({ templates, categories }: { templates: Template[]; categories: [string, string][] }) {
  // Tabs: one per real category, then an "Any category" tab for templates that show everywhere.
  const tabs: Cat[] = [...categories.map(([key, label]) => ({ key, label })), { key: '', label: 'Any category' }];
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const countFor = (key: string) => templates.filter((t) => t.category === key).length;
  const shown = templates.filter((t) => t.category === active);
  const activeLabel = tabs.find((t) => t.key === active)?.label ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key || 'any'}
              type="button"
              onClick={() => setActive(t.key)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                on ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              {t.label} <span className={on ? 'text-zinc-300' : 'text-zinc-400'}>{countFor(t.key)}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No templates in {activeLabel} yet. Add one below.</p>
      ) : (
        shown.map((t) => <TemplateForm key={t.id} template={t} categories={categories} />)
      )}

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">New template in {activeLabel}</h2>
        <TemplateForm categories={categories} defaultCategory={active} />
      </div>
    </div>
  );
}

function TemplateForm({
  template,
  categories,
  defaultCategory,
}: {
  template?: Template;
  categories: [string, string][];
  defaultCategory?: string;
}) {
  const t = template;
  return (
    <form action={saveTemplate} className={t ? 'card space-y-3' : 'space-y-3'}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-48 flex-1">
          <label className="label">Name</label>
          <input name="name" defaultValue={t?.name ?? ''} placeholder="e.g. Admin / Office pitch" required className="input" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={t?.category ?? defaultCategory ?? ''} className="input">
            {categories.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="">Any category</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Subject</label>
        <input name="subject" defaultValue={t?.subject ?? ''} placeholder="Your {{job}} opening at {{company}}" className="input" />
      </div>
      <div>
        <label className="label">Body</label>
        <textarea
          name="body"
          defaultValue={t?.body ?? ''}
          rows={8}
          placeholder="Hi {{company}} team, …"
          className="input resize-y font-sans leading-relaxed"
        />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary">{t ? 'Save' : 'Add template'}</button>
        {t && (
          <button formAction={deleteTemplate} className="btn text-red-600">
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
