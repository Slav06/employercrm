// Company enrichment via People Data Labs (PDL) Company Enrichment API.
// One key (PDL_API_KEY) turns it on; without it the feature is off and the UI says so.
// Results are cached in the `companies` table by the caller, so each company is a
// single paid lookup. See src/app/actions.ts → researchCompany.

const ENDPOINT = 'https://api.peopledatalabs.com/v5/company/enrich';

export const enrichConfigured = () => !!process.env.PDL_API_KEY;

// The fields we keep. Mirrors columns on the `companies` table (minus bookkeeping).
export type CompanyFacts = {
  displayName: string | null;
  industry: string | null;
  employeeCount: number | null;
  sizeRange: string | null;
  revenue: string | null;
  foundedYear: number | null;
  website: string | null;
  linkedinUrl: string | null;
  location: string | null;
};

export type EnrichResult =
  | { status: 'ok'; facts: CompanyFacts; raw: Record<string, unknown> }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mapFacts(d: Record<string, unknown>): CompanyFacts {
  const location = d.location as Record<string, unknown> | undefined;
  return {
    displayName: str(d.display_name) ?? str(d.name),
    industry: str(d.industry),
    employeeCount: num(d.employee_count),
    sizeRange: str(d.size),
    revenue: str(d.inferred_revenue),
    foundedYear: num(d.founded),
    website: str(d.website),
    linkedinUrl: str(d.linkedin_url),
    location: str(location?.name),
  };
}

// Looks up one company by name. `region` (e.g. "florida") nudges PDL toward the right
// match for common local names. Network/auth problems come back as 'error', not throws.
export async function fetchCompany(name: string, region?: string | null): Promise<EnrichResult> {
  const key = process.env.PDL_API_KEY;
  if (!key) return { status: 'error', message: 'Enrichment is not configured (PDL_API_KEY not set).' };
  const trimmed = name.trim();
  if (!trimmed) return { status: 'not_found' };

  const params = new URLSearchParams({ name: trimmed, min_likelihood: '2' });
  if (region) params.set('location', region);

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Network error' };
  }

  if (res.status === 404) return { status: 'not_found' };
  if (!res.ok) {
    // 401 bad key, 402 out of credits, 429 rate limited, etc.
    const body = await res.text().catch(() => '');
    return { status: 'error', message: `PDL ${res.status}: ${body.slice(0, 200) || res.statusText}` };
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return { status: 'error', message: 'Unreadable response from PDL' };
  return { status: 'ok', facts: mapFacts(json), raw: json };
}
