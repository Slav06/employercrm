// Craigslist feasibility spike.
// Usage: node spike/craigslist.mjs [area] [category] [query] [maxDetails]
//   node spike/craigslist.mjs miami jjj "sales" 5
// Fetches one search page, then a few listing pages (politely, with a delay),
// and writes the parsed results to spike/out/.

import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';

const [area = 'miami', category = 'jjj', query = '', maxDetails = '5'] = process.argv.slice(2);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const body = await res.text();
  if (res.status !== 200 || /<title>blocked<\/title>/i.test(body)) {
    throw new Error(`${res.status} ${/blocked/i.test(body) ? '(blocked)' : ''} ${url}`);
  }
  return body;
}

export function parseSearch(html) {
  const $ = cheerio.load(html);
  return $('li.cl-static-search-result')
    .map((_, li) => {
      const a = $(li).find('a');
      const url = a.attr('href');
      return {
        url,
        slugId: url?.split('/').pop(),
        title: $(li).find('.title').text().trim(),
        price: $(li).find('.price').text().trim() || null,
        location: $(li).find('.location').text().trim() || null,
      };
    })
    .get();
}

export function parseListing(html) {
  const $ = cheerio.load(html);
  let ld = {};
  try {
    ld = JSON.parse($('#ld_posting_data').text() || '{}');
  } catch {}

  const attrs = {};
  $('.attrgroup .attr').each((_, el) => {
    const label = $(el).find('.labl').text().replace(':', '').trim();
    const value = $(el).find('.valu').text().trim();
    if (label) attrs[label] = value;
  });

  const body = $('#postingbody').clone();
  body.find('.print-information').remove();
  const postId = $('.postinginfos').text().match(/post id:\s*(\d+)/)?.[1] ?? null;
  const addr = ld.jobLocation?.address ?? {};

  return {
    postId,
    title: $('#titletextonly').text().trim() || ld.title || null,
    company: ld.hiringOrganization?.name ?? null,
    jobTitle: ld.title ?? null,
    compensation: attrs['compensation'] ?? null,
    employmentType: attrs['employment type'] ?? ld.employmentType ?? null,
    experienceLevel: attrs['experience level'] ?? null,
    postedAt: ld.datePosted ?? $('.postinginfos time').first().attr('datetime') ?? null,
    validThrough: ld.validThrough ?? null,
    city: addr.addressLocality ?? null,
    region: addr.addressRegion ?? null,
    postalCode: addr.postalCode ?? null,
    body: body.text().trim() || ld.description || null,
    attrs,
  };
}

async function main() {
  const params = new URLSearchParams({ cat: category });
  if (query) params.set('query', query);
  const searchUrl = `https://www.craigslist.org/search/area/${area}?${params}`;

  console.log(`search: ${searchUrl}`);
  const results = parseSearch(await get(searchUrl));
  console.log(`  ${results.length} results`);

  const details = [];
  for (const r of results.slice(0, Number(maxDetails))) {
    await sleep(DELAY_MS);
    try {
      const d = { ...r, ...parseListing(await get(r.url)) };
      details.push(d);
      console.log(`  ✓ ${d.postId}  ${d.title}  | ${d.company ?? '-'} | ${d.compensation ?? '-'} | ${d.postedAt}`);
    } catch (e) {
      console.log(`  ✗ ${r.url}: ${e.message}`);
      if (/blocked/.test(e.message)) break;
    }
  }

  await mkdir('spike/out', { recursive: true });
  const file = `spike/out/${area}-${category}${query ? '-' + query.replace(/\W+/g, '_') : ''}.json`;
  await writeFile(file, JSON.stringify({ searchUrl, fetchedAt: new Date(), results, details }, null, 2));
  console.log(`wrote ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
