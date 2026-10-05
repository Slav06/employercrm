import * as cheerio from 'cheerio';

// Craigslist has no API and RSS returns 403 (see PLAN.md §8). We read the static
// no-JS search list and the JSON-LD on each listing page, slowly, from a
// residential IP. Never run this from Vercel/cloud IPs — they get blocked.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export class BlockedError extends Error {}

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const body = await res.text();
  if (/<title>blocked<\/title>/i.test(body) || res.status === 403) {
    throw new BlockedError(`Craigslist blocked the request (${res.status}) ${url}`);
  }
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}`);
  return body;
}

export function searchUrl(area: string, category: string, query = '') {
  const params = new URLSearchParams({ cat: category });
  if (query) params.set('query', query);
  return `https://www.craigslist.org/search/area/${area}?${params}`;
}

export type SearchResult = { url: string; title: string; location: string | null };

// Newest first, capped by Craigslist at ~320, no pagination.
export function parseSearch(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  return $('li.cl-static-search-result')
    .map((_, li) => ({
      url: $(li).find('a').attr('href') ?? '',
      title: $(li).find('.title').text().trim(),
      location: $(li).find('.location').text().trim() || null,
    }))
    .get()
    .filter((r) => r.url);
}

export type ListingDetail = {
  postId: string | null;
  title: string | null;
  company: string | null;
  jobTitle: string | null;
  compensation: string | null;
  employmentType: string | null;
  postedAt: Date | null;
  validThrough: Date | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  body: string | null;
};

const toDate = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function parseListing(html: string): ListingDetail {
  const $ = cheerio.load(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON-LD
  let ld: Record<string, any> = {};
  try {
    ld = JSON.parse($('#ld_posting_data').text() || '{}');
  } catch {}

  const attrs: Record<string, string> = {};
  $('.attrgroup .attr').each((_, el) => {
    const label = $(el).find('.labl').text().replace(':', '').trim();
    if (label) attrs[label] = $(el).find('.valu').text().trim();
  });

  const body = $('#postingbody').clone();
  body.find('.print-information').remove();
  const addr = ld.jobLocation?.address ?? {};
  // Craigslist uses "." or similar as a placeholder company name.
  const company = typeof ld.hiringOrganization?.name === 'string' ? ld.hiringOrganization.name.trim() : '';

  return {
    postId: $('.postinginfos').text().match(/post id:\s*(\d+)/)?.[1] ?? null,
    title: $('#titletextonly').text().trim() || ld.title || null,
    company: company.replace(/[^\p{L}\p{N}]/gu, '').length > 1 ? company : null,
    jobTitle: attrs['job title'] ?? ld.title ?? null,
    compensation: attrs['compensation'] ?? null,
    employmentType: attrs['employment type'] ?? ld.employmentType ?? null,
    postedAt: toDate(ld.datePosted ?? $('.postinginfos time').first().attr('datetime')),
    validThrough: toDate(ld.validThrough),
    city: addr.addressLocality || null,
    region: addr.addressRegion || null,
    postalCode: addr.postalCode || null,
    body: body.text().trim() || ld.description || null,
  };
}
