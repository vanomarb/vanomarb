// Rewrites the generated "Recent work" section of README.md.
// Recent work lists public repositories whose description starts with "--" (the same rule the
// portfolio's Showcase uses), newest push first, with each cover cropped to one size so cards line up.
// Runs every six hours in .github/workflows/refresh.yml; locally: GITHUB_TOKEN=$(gh auth token) node scripts/readme.mjs
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const LOGIN = 'vanomarb';
const TOKEN = process.env.GITHUB_TOKEN;
const WORK_LIMIT = 4;
const COVER = { width: 1200, height: 675 };
const README = new URL('../README.md', import.meta.url);
const COVERS = new URL('../assets/work/', import.meta.url);

const QUERY = `query ($login: String!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes {
        name description url homepageUrl pushedAt openGraphImageUrl
        languages(first: 3, orderBy: { field: SIZE, direction: DESC }) { nodes { name } }
        screenshots: object(expression: "HEAD:docs/screenshots") { ... on Tree { entries { name } } }
      }
    }
  }
}`;

const headers = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': LOGIN };

async function graphql() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data.user;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Same order as the portfolio: cover.*, then a web or desktop shot, then the first image.
function coverUrl(repo) {
  const names = (repo.screenshots?.entries ?? []).map((e) => e.name).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
  const pick = names.find((n) => /^cover\./i.test(n)) ?? names.find((n) => /web|desktop/i.test(n)) ?? names[0];
  return pick ? `https://raw.githubusercontent.com/${LOGIN}/${repo.name}/HEAD/docs/screenshots/${pick}` : repo.openGraphImageUrl;
}

async function saveCover(repo) {
  const res = await fetch(coverUrl(repo));
  if (!res.ok) throw new Error(`${repo.name} cover: ${res.status}`);
  const file = `${repo.name}.jpg`;
  await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ ...COVER, fit: 'cover', position: 'top' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(new URL(file, COVERS).pathname);
  return `assets/work/${file}`;
}

function card(repo, cover) {
  const link = repo.homepageUrl || repo.url;
  const langs = repo.languages.nodes.map((l) => `<code>${esc(l.name)}</code>`).join(' ');
  const demo = repo.homepageUrl ? ` · <a href="${esc(repo.homepageUrl)}">Try it ↗</a>` : '';
  return `<td width="50%" valign="top">
<a href="${esc(link)}"><img src="${cover}" width="100%" alt="${esc(repo.name)}" /></a>
<h3><a href="${esc(repo.url)}">${esc(repo.name[0].toUpperCase() + repo.name.slice(1))}</a></h3>
<sub>${langs} · updated ${day(repo.pushedAt)}${demo}</sub>
<p>${esc(repo.description.replace(/^--\s*/, ''))}</p>
</td>`;
}

async function work(repos) {
  const picked = repos.filter((r) => r.description?.startsWith('--')).slice(0, WORK_LIMIT);
  await rm(COVERS, { recursive: true, force: true });
  await mkdir(COVERS, { recursive: true });
  const cells = await Promise.all(picked.map(async (r) => card(r, await saveCover(r))));
  if (cells.length % 2) cells.push('<td width="50%"></td>');
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>\n${cells[i]}\n${cells[i + 1]}\n</tr>`);
  return `<table>\n${rows.join('\n')}\n</table>`;
}

function splice(source, name, body) {
  const pattern = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!pattern.test(source)) throw new Error(`README is missing the ${name} markers.`);
  return source.replace(pattern, `$1\n${body}\n$2`);
}

if (!TOKEN) throw new Error('Set GITHUB_TOKEN.');
const user = await graphql();
let readme = await readFile(README, 'utf8');
readme = splice(readme, 'WORK', await work(user.repositories.nodes));
await writeFile(README, readme);
console.log(`Wrote README.md and ${(await readdir(COVERS)).length} covers`);
