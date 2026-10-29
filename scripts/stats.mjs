// Draws assets/github-stats.svg from public GitHub data, in the profile palette.
// Runs every six hours in .github/workflows/refresh.yml; locally: GITHUB_TOKEN=$(gh auth token) node scripts/stats.mjs
import { writeFile } from 'node:fs/promises';

const LOGIN = 'vanomarb';
const TOKEN = process.env.GITHUB_TOKEN;
const C = { base: '#0B0F14', panel: '#1A2027', line: '#1A2027', muted: '#5B6470', label: '#9AA4AF', ink: '#E6EDF3', accent: '#39FF9C' };

const QUERY = `query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
    }
  }
}`;

async function load() {
  if (!TOKEN) throw new Error('Set GITHUB_TOKEN.');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': LOGIN },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data.user;
}

// Share of code by language across public repositories, top five plus "Other".
function languages(repos) {
  const bytes = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
  const sorted = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5).map(([name, size]) => ({ name, share: size / total }));
  const rest = 1 - top.reduce((a, b) => a + b.share, 0);
  return rest > 0.005 ? [...top, { name: 'Other', share: rest }] : top;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => n.toLocaleString('en-US');

function render(user) {
  const cc = user.contributionsCollection;
  const stars = user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
  const year = new Date().getUTCFullYear();
  const figures = [
    ['Contributions', cc.contributionCalendar.totalContributions],
    ['Commits', cc.totalCommitContributions],
    ['Pull requests', cc.totalPullRequestContributions],
    ['Public repos', user.repositories.totalCount],
    ['Stars earned', stars],
    ['Followers', user.followers.totalCount],
  ];
  const langs = languages(user.repositories.nodes);
  const W = 840;
  const H = 230;
  const tiles = figures
    .map(([label, value], i) => {
      const x = 28 + (i % 3) * 136;
      const y = 74 + Math.floor(i / 3) * 70;
      const colour = i === 0 ? C.accent : C.ink;
      return `<g class="fade" style="animation-delay:${i * 90}ms">
    <rect x="${x}" y="${y}" width="124" height="58" rx="10" fill="${C.panel}"/>
    <text x="${x + 14}" y="${y + 24}" class="label">${esc(label)}</text>
    <text x="${x + 14}" y="${y + 46}" class="value" fill="${colour}">${num(value)}</text>
  </g>`;
    })
    .join('\n  ');
  const bars = langs
    .map(({ name, share }, i) => {
      const y = 82 + i * 22;
      const width = Math.max(4, Math.round(share * 230));
      const colour = i === 0 ? C.accent : name === 'Other' ? C.muted : C.label;
      return `<text x="484" y="${y + 9}" class="label">${esc(name)}</text>
  <rect x="580" y="${y}" width="230" height="10" rx="5" fill="${C.panel}"/>
  <rect x="580" y="${y}" width="${width}" height="10" rx="5" fill="${colour}" class="grow" style="animation-delay:${300 + i * 80}ms"/>
  <text x="810" y="${y + 9}" class="pct" text-anchor="end" dx="0">${(share * 100).toFixed(1)}%</text>`;
    })
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${LOGIN} on GitHub in ${year}`)}">
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .title { font-size: 15px; font-weight: 700; fill: ${C.ink}; }
    .sub { font-size: 12px; fill: ${C.muted}; }
    .label { font-size: 12px; fill: ${C.label}; }
    .value { font-size: 19px; font-weight: 700; }
    .pct { font-size: 11px; fill: ${C.muted}; }
    .fade { opacity: 0; animation: fade 600ms ease-out forwards; }
    .grow { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow 900ms cubic-bezier(.2,.8,.2,1) forwards; }
    @keyframes fade { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) { .fade, .grow { animation: none; opacity: 1; transform: none; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${C.base}" stroke="${C.line}"/>
  <text x="28" y="40" class="title">This year on GitHub</text>
  <text x="28" y="58" class="sub">${year} · public activity · refreshed every 6 hours</text>
  <text x="484" y="40" class="title">Languages</text>
  <text x="484" y="58" class="sub">by code size across public repositories</text>
  ${tiles}
  ${bars}
</svg>
`;
}

const user = await load();
await writeFile(new URL('../assets/github-stats.svg', import.meta.url), render(user));
console.log('Wrote assets/github-stats.svg');
