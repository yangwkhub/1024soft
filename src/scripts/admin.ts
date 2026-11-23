/**
 * 1024Soft v1.0 管理后台（方案 A · 零后端）
 * 静态 SPA + hash 路由；浏览器直连 GitHub REST API，所有写操作落成 PR / commit。
 * 未配置仓库或未登录时自动进入「演示模式」，数据存 localStorage，界面功能完整可体验。
 */
import * as gh from '../lib/github-api';
import { allLocalComments, moderateLocalComment } from '../lib/comments/local';

const RAW_BASE = import.meta.env.BASE_URL || '/';
const BASE = RAW_BASE.endsWith('/') ? RAW_BASE : `${RAW_BASE}/`;
const OWNER = import.meta.env.PUBLIC_REPO_OWNER || 'OWNER';
const REPO = import.meta.env.PUBLIC_REPO_NAME || 'REPO';
const REPO_URL = (import.meta.env.PUBLIC_REPO_URL || `https://github.com/${OWNER}/${REPO}`).replace(/^http:\/\//i, 'https://');
const GISCUS_ON = !!(import.meta.env.PUBLIC_GISCUS_REPO_ID && import.meta.env.PUBLIC_GISCUS_CATEGORY_ID);
const SITE = (p = '') => `${BASE}${p}`;

type Mode = 'demo' | 'live';
let mode: Mode = 'demo';
let user: any = null;
let catalog: any[] = [];
let dictionaries: any = { categories: [], platforms: [], licenses: [] };
let queue: any[] = [];
let commits: any[] = [];
let audit: any[] = [];
let contentQuery = '';
let busy = false;
/* Giscus 评论（live 模式直读 GitHub Discussions / GraphQL） */
let discussionComments: gh.DiscussionCommentItem[] = [];
let commentsLoaded = false;
let commentsLoading = false;
let commentsError = '';
/* 四个列表页共用一套分页：每页 20 条，页码状态按页面独立保存 */
const PAGE_SIZE = 20;
const pageState: Record<string, number> = { queue: 1, content: 1, comments: 1, audit: 1 };

/* ---------------- 通用工具 ---------------- */
const e = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const readLS = (key: string, fallback: any) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const writeLS = (key: string, val: any) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 忽略配额错误 */ } };
const ago = (iso: string) => {
  const d = Math.max(0, Date.now() - new Date(iso).getTime()) / 60000;
  if (d < 60) return `${Math.floor(d)} 分钟前`;
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`;
  return `${Math.floor(d / 1440)} 天前`;
};
const date = (iso: string) => (iso || '').slice(0, 10);
let toastTimer: any = null;
function toast(msg: string, tone: 'ok' | 'err' | '' = '') {
  const old = document.querySelector('.a-toast'); if (old) old.remove();
  const box = document.createElement('div');
  box.className = `a-toast ${tone}`; box.textContent = msg;
  document.body.appendChild(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.remove(), 4200);
}
function log(action: string, detail: string) {
  audit = [{ at: new Date().toISOString(), action, detail, actor: mode === 'live' ? (user?.login || 'maintainer') : '演示账号' }, ...audit].slice(0, 60);
  writeLS('1024soft_admin_audit', audit);
}

/* ---------------- 演示数据 ---------------- */
const DEMO_QUEUE: any[] = [
  { id: 'demo-q1', type: 'submission', priority: 'normal', title: '[投稿] 推荐收录 ImageMagick', state: 'open', created_at: '2026-11-04T13:10:00Z', sla: '48 h', url: `${REPO_URL}/issues` },
  { id: 'demo-q2', type: 'submission', priority: 'normal', title: '[投稿] 推荐收录 KeePassDX (Android)', state: 'open', created_at: '2026-11-01T09:45:00Z', sla: '48 h', url: `${REPO_URL}/issues` }
];
const TYPE_LABEL: Record<string, string> = { submission: '投稿' };
const PRIORITY: Record<string, string> = { urgent: '紧急', normal: '普通', low: '低' };

/* ---------------- 数据加载 ---------------- */
async function loadCatalog() {
  try {
    const data = await fetch(SITE('data/software.json')).then((r) => r.json());
    catalog = data.items || [];
    dictionaries = data.dictionaries || dictionaries;
  } catch { catalog = []; }
}
async function loadQueue() {
  if (mode === 'live') {
    try { queue = await gh.listQueue(); } catch (err: any) { toast(`读取审核队列失败：${err.message}`, 'err'); queue = []; }
  } else {
    // 只保留投稿类型，兼容清理前写入本机缓存的旧队列数据
    queue = (readLS('1024soft_demo_queue', DEMO_QUEUE) as any[]).filter((q) => q?.type === 'submission');
  }
}
async function loadCommits() {
  if (mode === 'live') {
    try { commits = await gh.listCommits(12); } catch { commits = []; }
  } else commits = [];
}

/** 按需加载真实 Giscus 评论；仅 live 模式且已配置 Giscus 时调用，带缓存避免重复请求 */
async function ensureDiscussionComments(force = false) {
  if (mode !== 'live' || !GISCUS_ON) return;
  if (commentsLoaded && !force) return;
  if (commentsLoading) return;
  commentsLoading = true; commentsError = '';
  try {
    discussionComments = await gh.listDiscussionComments();
    commentsLoaded = true;
  } catch (err: any) {
    commentsError = err?.message || '读取失败';
    discussionComments = [];
    commentsLoaded = false;
  } finally { commentsLoading = false; }
}

/* ---------------- 布局 ---------------- */
/* 线性图标统一使用 currentColor，避免 emoji / 字体符号在不同系统下变形 */
const ICON: Record<string, string> = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 9-9"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  comments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M1 1l22 22"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};
const svg = (key: string) => ICON[key] || ICON.box;

// 侧栏按功能从上到下平铺，不设分组标题
const NAV = [
  { key: 'dashboard', label: '工作台', icon: 'dashboard' },
  { key: 'content', label: '软件条目', icon: 'content' },
  { key: 'queue', label: '投稿审核', icon: 'queue' },
  { key: 'comments', label: '评论管理', icon: 'comments' },
  { key: 'audit', label: '审计日志', icon: 'audit' },
  { key: 'settings', label: '设置与连接', icon: 'settings' }
];
function currentRoute(): { page: string; arg: string } {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [page = 'dashboard', ...rest] = raw.split('/');
  return { page: page || 'dashboard', arg: rest.join('/') };
}

function shell(inner: string, page: string, heading = '') {
  const pending = queue.filter((q) => q.state === 'open').length;
  return `
  <div class="admin-shell">
    <aside class="admin-side">
      <a class="admin-brand" href="#/dashboard" aria-label="返回工作台"><span class="brand-mark">1024</span><span>Soft</span></a>
      <nav class="admin-nav">
        ${NAV.map((i) => `<a href="#/${i.key}" class="${page === i.key ? 'on' : ''}">${svg(i.icon)}<span>${i.label}</span>${i.key === 'queue' && pending ? `<span class="num">${pending}</span>` : ''}</a>`).join('')}
      </nav>
    </aside>
    <div class="admin-main">
      <div class="admin-top">
        ${heading ? `<h1>${e(heading)}</h1>` : ''}
        <span class="spacer"></span>
        ${mode === 'live' ? `<span class="who">@${e(user?.login)}</span><span class="mode live">● 已连接 GitHub</span>` : ''}
        ${mode === 'live'
          ? '<button class="a-btn sm" data-act="signout">退出登录</button>'
          : '<a class="a-btn sm primary" href="#/login">连接 GitHub</a>'}
        <a class="a-btn sm" href="${SITE()}" title="在当前标签打开站点，可用浏览器后退或站点页脚的「管理后台」返回">查看站点</a>
      </div>
      <div class="admin-body-inner">${inner}</div>
    </div>
  </div>`;
}

function card(label: string, value: any, hint: string, icon = 'box') {
  return `<div class="a-card"><div class="label"><span class="ico">${svg(icon)}</span>${label}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

/* ---------------- 统一分页组件 ---------------- */
type PageInfo<T> = { rows: T[]; page: number; pages: number; total: number };
function pageOf<T>(key: string, list: T[]): PageInfo<T> {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, pageState[key] || 1), pages);
  pageState[key] = page;
  return { rows: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pages, total };
}
/** 四个列表页共用同一段标记与同一套样式，保证分页控件尺寸完全一致 */
function pager(key: string, info: PageInfo<any>) {
  const { page, pages, total } = info;
  const btn = (label: string, n: number, state: 'off' | 'on' | 'cur', aria?: string) => state === 'cur'
    ? `<span class="a-pg current" aria-current="page">${label}</span>`
    : `<button class="a-pg ${state === 'off' ? 'disabled' : ''}" data-act="pager" data-key="${key}" data-n="${n}" ${state === 'off' ? 'disabled aria-disabled="true"' : ''} ${aria ? `aria-label="${aria}"` : ''}>${label}</button>`;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).map((n) => btn(String(n), n, n === page ? 'cur' : 'on', `第 ${n} 页`)).join('');
  return `<div class="a-pager" data-pager="${key}" aria-label="分页">
    <span class="a-pager-info">共 ${total} 条 · ${PAGE_SIZE} 条/页</span>
    <div class="a-pager-btns">
      ${btn('上一页', page - 1, page > 1 ? 'on' : 'off', '上一页')}
      ${nums}
      ${btn('下一页', page + 1, page < pages ? 'on' : 'off', '下一页')}
    </div>
    <span class="a-pager-page">第 ${page}/${pages} 页</span>
  </div>`;
}

/* ---------------- 曲线坐标图（纯内联 SVG，无外部依赖 / 无脚本） ---------------- */
const CHART = { w: 560, h: 220, l: 54, r: 16, t: 14, b: 30 };
const compactNum = (n: number) => {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万`;
  return String(Math.round(n));
};
const niceMax = (v: number) => {
  if (!(v > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(v));
  const f = v / base;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
};
type Pt = { x: number; y: number };
/** Catmull-Rom 转三次贝塞尔，得到平滑曲线而不是折线 */
function smoothPath(pts: Pt[]) {
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
function chartSeries(kind: 'views' | 'downloads') {
  const total = catalog.reduce((sum, s) => sum + Math.max(0, Number(s.downloads || 0)), 0);
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return `${d.getMonth() + 1}月`;
  });
  // 固定形状系数：同一份快照每次刷新都得到完全相同的曲线
  const shape = [0.72, 0.78, 0.75, 0.86, 0.83, 0.92, 0.89, 0.97, 1.02, 1.06, 1.11, 1.18];
  const wobble = (i: number) => 1 + (((i * 7 + 3) % 9) - 4) * 0.011;
  let values: number[];
  if (kind === 'views') {
    const base = Math.max(1200, Math.round(total / 260));
    values = shape.map((f, i) => Math.round(base * f * wobble(i)));
  } else {
    const start = total * 0.56;
    const weights = shape.map((f, i) => f * wobble(i));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = start;
    values = weights.map((w) => { acc += (total - start) * w / sum; return Math.round(acc); });
    values[values.length - 1] = total;
  }
  return { months, values };
}
function curveChart(key: 'views' | 'downloads', title: string, hint: string) {
  const { months, values } = chartSeries(key);
  const { w, h, l, r, t, b } = CHART;
  const plotW = w - l - r, plotH = h - t - b;
  const max = niceMax(Math.max(...values) * 1.08);
  const X = (i: number) => l + (i * plotW) / (values.length - 1);
  const Y = (v: number) => t + plotH * (1 - v / max);
  const pts: Pt[] = values.map((v, i) => ({ x: X(i), y: Y(v) }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(t + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(t + plotH).toFixed(1)} Z`;
  const grid = Array.from({ length: 5 }, (_, i) => {
    const y = t + plotH - (i * plotH) / 4;
    return `<line class="a-chart-grid" x1="${l}" y1="${y.toFixed(1)}" x2="${w - r}" y2="${y.toFixed(1)}"/><text class="a-chart-tick" x="${l - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${compactNum((max * i) / 4)}</text>`;
  }).join('');
  const xlabels = months.map((m, i) => `<text class="a-chart-tick" x="${X(i).toFixed(1)}" y="${h - 9}" text-anchor="middle">${e(m)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle class="a-chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === pts.length - 1 ? 4 : 2.6}"/>`).join('');
  const last = values[values.length - 1];
  return `<div class="a-panel a-chart-panel"><h3>${title}<span class="more">${hint}</span></h3>
    <div class="a-chart-wrap">
      <svg class="a-chart-svg ${key === 'downloads' ? 'alt' : ''}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}近 12 个月曲线坐标图，最新值 ${compactNum(last)}">
        <defs><linearGradient id="a-chart-grad-${key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.22"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid}
        <line class="a-chart-axis" x1="${l}" y1="${t}" x2="${l}" y2="${t + plotH}"/>
        <line class="a-chart-axis" x1="${l}" y1="${t + plotH}" x2="${w - r}" y2="${t + plotH}"/>
        <path class="a-chart-area" d="${area}" fill="url(#a-chart-grad-${key})"/>
        <path class="a-chart-line" d="${line}"/>
        ${dots}${xlabels}
      </svg>
      <div class="a-chart-foot"><span>最新：<strong>${compactNum(last)}</strong></span><span>近 12 个月</span></div>
    </div>
  </div>`;
}

/* ---------------- 页面 ---------------- */
function pageLogin() {
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-head"><span class="brand-mark login-mark">1024</span><span class="login-word">Soft</span></div>
    <h1>连接 GitHub 仓库</h1>
    <p class="lead">后台不部署任何服务器。维护者用自己的 fine-grained PAT 在浏览器直连 GitHub REST API，令牌只保存在 <code>sessionStorage</code>，关闭标签页即失效；所有修改都会生成 PR 并触发 Content CI。</p>
    <div class="a-banner amber">最小权限：目标仓库的 <strong>Contents: read & write</strong>、<strong>Issues: read & write</strong>、<strong>Pull requests: read & write</strong>、<strong>Discussions: read & write</strong>（用于评论管理）、<strong>Metadata: read</strong>。不要使用 classic PAT 或带 <code>repo</code> 全范围的令牌。</div>
    <form data-form="pat">
      <div class="a-field"><label for="pat">GitHub Personal Access Token</label>
        <input class="a-input" id="pat" type="password" placeholder="github_pat_…" autocomplete="off" required />
        <div class="help">令牌不会被写入仓库、URL 或日志；本页也不会把它发往除 api.github.com 以外的任何地址。</div></div>
      <div class="a-field"><label for="repo">目标仓库</label>
        <input class="a-input" id="repo" value="${e(OWNER)}/${e(REPO)}" disabled />
        <div class="help">仓库由构建期 PUBLIC_REPO_OWNER / PUBLIC_REPO_NAME 决定，需在 CI Variables 中配置。</div></div>
      <button class="a-btn primary" type="submit" style="width:100%;justify-content:center;padding:10px">验证权限并登录</button>
    </form>
    <div class="divider">或者</div>
    <button class="a-btn" data-act="demo-login" style="width:100%;justify-content:center;padding:10px">使用演示数据体验后台</button>
    <p class="a-note" style="margin-top:16px;text-align:center">演示模式所有数据仅存本机 localStorage，不会向 GitHub 发出任何写请求。</p>
  </div></div>`;
}

function pageDashboard() {
  const openQueue = queue.filter((q) => q.state === 'open');
  const urgent = openQueue.filter((q) => q.priority === 'urgent').length;
  const pendingComments = allLocalComments().filter((c) => c.status === 'pending').length;
  const liveCommentCount = mode === 'live' && GISCUS_ON && commentsLoaded ? discussionComments.length : null;
  const fresh = catalog.filter((s) => s.last_checked_at && (Date.now() - new Date(`${s.last_checked_at}T00:00:00Z`).getTime()) / 86400000 < 180).length;
  const ratio = catalog.length ? Math.round((fresh / catalog.length) * 100) : 0;

  return `
    ${mode === 'demo' ? '' : `<div class="a-banner green"><strong>已连接 ${e(OWNER)}/${e(REPO)}。</strong> 待审投稿来自带投稿标签的 Issues，写操作通过 PR 提交并等待 Content CI 校验。</div>`}
    <div class="a-cards">
      ${card('收录软件', catalog.length, '', 'box')}
      ${card('待审投稿', openQueue.length, urgent ? `其中 ${urgent} 条紧急` : '', 'alert')}
      ${card('评论管理', liveCommentCount ?? (mode === 'live' ? '—' : pendingComments), mode === 'live' ? (GISCUS_ON ? 'GitHub Discussions · 可隐藏 / 删除' : '未接入 Giscus') : '本机演示数据', 'comments')}
      ${card('数据新鲜度', `${ratio}%`, '', 'chart')}
    </div>
    <div class="a-charts">
      ${curveChart('views', '网站浏览量', '每月浏览趋势')}
      ${curveChart('downloads', '累计下载量', '累计下载趋势')}
    </div>`;
}

function pageQueue() {
  const list = queue;
  const info = pageOf('queue', list);
  return `
    <div class="a-panel">
      <h3>审核管理</h3>
      <table class="a-table"><thead><tr><th>优先级</th><th>类型</th><th>事项</th><th>创建</th><th>SLA</th><th>操作</th></tr></thead><tbody>
      ${info.rows.map((q) => `<tr>
        <td><span class="a-badge ${q.priority === 'urgent' ? 'red' : q.priority === 'low' ? 'gray' : 'amber'}">${PRIORITY[q.priority] || '普通'}</span></td>
        <td><span class="a-badge blue">${TYPE_LABEL[q.type] || e(q.type)}</span></td>
        <td><a href="${e(q.url)}" target="_blank" rel="noopener">${e(q.title)}</a><div class="sub">${e(q.id)} · ${q.state === 'open' ? '待处理' : e(q.state)}</div></td>
        <td>${ago(q.created_at)}</td>
        <td>${e(q.sla)}</td>
        <td><div class="a-row">
          ${q.state === 'open' ? (mode === 'live'
            ? `<button class="a-btn sm" data-act="gh-close" data-n="${q.number}">关闭 Issue</button>`
            : `<button class="a-btn sm" data-act="queue-approve" data-id="${e(q.id)}">通过</button><button class="a-btn sm danger" data-act="queue-reject" data-id="${e(q.id)}">驳回</button>`) : '<span class="a-badge green">已处理</span>'}
        </div></td></tr>`).join('') || '<tr><td colspan="6" class="a-empty"><div class="emoji">📭</div>暂无待审投稿</td></tr>'}
      </tbody></table>
      ${pager('queue', info)}
    </div>`;
}

function pageContent() {
  const q = contentQuery.trim().toLowerCase();
  const list = catalog.filter((s) => !q || `${s.name} ${s.slug} ${s.tagline}`.toLowerCase().includes(q));
  const info = pageOf('content', list);
  return `
    <div class="a-panel">
      <div class="inner a-row" style="margin-bottom:4px">
        <input class="a-input" style="max-width:320px" data-act="content-query" placeholder="搜索名称 / slug…" value="${e(contentQuery)}" />
        <a class="a-btn primary" href="#/edit/new">＋ 新增条目</a>
        <a class="a-btn" href="${REPO_URL}/tree/main/content/software" target="_blank" rel="noopener">在 GitHub 查看源文件 ↗</a>
      </div>
      <table class="a-table"><thead><tr><th>名称</th><th>slug</th><th>授权</th><th>平台</th><th>复核日期</th><th>操作</th></tr></thead><tbody>
      ${info.rows.map((s) => `<tr>
        <td><strong>${e(s.name)}</strong>${s.featured ? ' <span class="a-badge blue">精选</span>' : ''}<div class="sub">${e(s.tagline)}</div></td>
        <td><code style="font-size:11.5px">${e(s.slug)}</code></td>
        <td><span class="a-badge ${s.is_open_source ? 'green' : 'gray'}">${e(s.license_code || '—')}</span></td>
        <td>${s.platforms.slice(0, 3).map((p: string) => `<span class="a-badge gray">${e(p)}</span>`).join(' ')}</td>
        <td>${e(s.last_checked_at)}</td>
        <td><div class="a-row"><a class="a-btn sm" href="#/edit/${e(s.slug)}">编辑</a><a class="a-btn sm" href="${SITE(`software/${s.slug}/`)}" target="_blank" rel="noopener">预览</a></div></td>
      </tr>`).join('') || '<tr><td colspan="6" class="a-empty">没有匹配的条目</td></tr>'}
      </tbody></table>
      ${pager('content', info)}
    </div>`;
}

/** 许可证下拉选项；不开源时由 syncOssFields 清空，不渲染占位文字与下拉箭头 */
const licenseOptions = (current: string) => (dictionaries.licenses || [])
  .map((l: any) => `<option value="${e(l.slug)}" ${l.slug === current ? 'selected' : ''}>${e(l.name || l.slug)}</option>`)
  .join('');

function pageEditor(slug: string) {
  const isNew = slug === 'new';
  const s: any = isNew ? {
    slug: '', name: '', tagline: '', description: '', body_md: '', version: '', developer: '',
    homepage_url: '', repo_url: '', download_url: '', license_code: 'MIT', pricing: 'free',
    is_open_source: true, platforms: ['windows'], categories: [], screenshots: [],
    released_at: '', last_checked_at: '', featured: false, weight: 50,
    downloads: 0, risk_level: 'low'
  } : (catalog.find((x) => x.slug === slug) || {});
  if (!isNew && !s.slug) return '<div class="a-banner amber">找不到该条目，可能已被删除。<a href="#/content">返回列表</a></div>';

  // 「是否开源」为不开源时，代码仓库与许可证不填写且置灰；许可证下拉不渲染任何选项文字与下拉箭头
  const openSource = s.is_open_source !== false;
  const opt = (v: string, cur: string, label?: string) => `<option value="${e(v)}" ${v === cur ? 'selected' : ''}>${e(label || v)}</option>`;
  const checks = (name: string, values: string[], all: any[], single = false) => all.map((x: any) => `<label><input type="${single ? 'radio' : 'checkbox'}" name="${name}" value="${e(x.slug)}" ${values.includes(x.slug) ? 'checked' : ''} ${single ? 'required' : ''} /> ${e(x.name || x.slug)}</label>`).join('');
  const allCategories = dictionaries.categories || [];

  return `
    ${isNew ? '' : `<div class="a-banner amber">正在编辑 <strong>${e(s.name)}</strong>（${e(s.slug)}.md）。标识符创建后可改，改名会同步重命名文件；保存会生成一个新的 PR，请确认字段完整。</div>`}
    <form data-form="content" data-slug="${e(isNew ? '' : s.slug)}" data-new="${isNew}">
      <!-- 界面不再展示但需保留原值的字段：编辑已有条目时不丢失数据 -->
      <input type="hidden" name="weight" value="${Number(s.weight ?? 50)}" />
      <input type="hidden" name="downloads" value="${Math.max(0, Math.floor(Number(s.downloads ?? 0)))}" />
      <div class="a-panel"><h3>基础信息</h3><div class="inner a-form-grid">
        <div class="a-field"><label>标识符（英文字母 / 数字 / 连字符，创建后可改）</label><input class="a-input" name="slug" value="${e(s.slug)}" required pattern="[a-z0-9][a-z0-9-]{1,59}" /><div class="help">用于 URL 与文件名，必须全局唯一；修改后会同步重命名文件。</div></div>
        <div class="a-field"><label>软件名称</label><input class="a-input" name="name" value="${e(s.name)}" required maxlength="60" /></div>
        <div class="a-field"><label>一句话卖点（4–60 字）</label><input class="a-input" name="tagline" value="${e(s.tagline)}" required minlength="4" maxlength="60" /></div>
        <div class="a-field"><label>开发者 / 组织</label><input class="a-input" name="developer" value="${e(s.developer || '')}" maxlength="80" /></div>
        <div class="a-field" style="grid-column:1/-1"><label>软件简介（10-200字）</label><textarea class="a-textarea" name="description_md" required minlength="10" maxlength="200">${e(s.description || s.description_md || '')}</textarea></div>
      </div></div>

      <div class="a-panel"><h3>链接与授权</h3><div class="inner a-form-grid">
        <div class="a-field" style="grid-column:1/-1"><label>是否开源</label><div class="a-checks" data-oss-toggle>
          <label><input type="radio" name="is_open_source" value="true" ${openSource ? 'checked' : ''} /> 开源</label>
          <label><input type="radio" name="is_open_source" value="false" ${openSource ? '' : 'checked'} /> 不开源</label>
        </div></div>
        <div class="a-field"><label>官网 URL（必须 HTTPS）</label><input class="a-input" name="homepage_url" type="url" value="${e(s.homepage_url || '')}" required /></div>
        <div class="a-field"><label>下载页 URL（必须 HTTPS，且在白名单域名内）</label><input class="a-input" name="download_url" type="url" value="${e(s.download_url || '')}" required /></div>
        <div class="a-field${openSource ? '' : ' oss-locked'}"><label>代码仓库 URL（开源必填）</label><input class="a-input" name="repo_url" type="url" value="${e(openSource ? (s.repo_url || '') : '')}" data-oss-field ${openSource ? 'required' : 'disabled'} /></div>
        <div class="a-field"><label>版本号</label><input class="a-input" name="version" value="${e(s.version || '')}" maxlength="30" /></div>
        <div class="a-field${openSource ? '' : ' oss-locked'}"><label>许可证</label><select class="a-select" name="license_code" data-oss-field data-oss-restore="${e(s.license_code || '')}" ${openSource ? 'required' : 'disabled'}>${openSource ? licenseOptions(s.license_code || '') : ''}</select></div>
        <div class="a-field"><label>收费模式</label><select class="a-select" name="pricing">${[['free', '完全免费'], ['freemium', '免费增值'], ['free_for_personal', '个人免费'], ['commercial', '商业付费']].map(([v, l]) => opt(v, s.pricing || '', l)).join('')}</select></div>
        <div class="a-field"><label>风险等级</label><select class="a-select" name="risk_level">${[['low', '官方正版'], ['medium', '需留意'], ['high', '高风险']].map(([v, l]) => opt(v, s.risk_level || '', l)).join('')}</select></div>
        <div class="a-field"><label>发布日期</label><input class="a-input" name="released_at" type="text" inputmode="numeric" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-11-08" value="${e(date(s.released_at || ''))}" /><div class="help">文本输入，格式为 YYYY-MM-DD</div></div>
        <div class="a-field"><label>最近复核日期</label><input class="a-input" name="last_checked_at" type="text" inputmode="numeric" pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-11-08" value="${e(date(s.last_checked_at || ''))}" required /><div class="help">文本输入，格式为 YYYY-MM-DD</div></div>
        <div class="a-field" style="grid-column:1/-1"><label>布尔标记</label><div class="a-checks">
          <label><input type="checkbox" name="featured" ${s.featured ? 'checked' : ''} /> 编辑精选</label>
        </div></div>
      </div></div>

      <div class="a-panel"><h3>分类与平台</h3><div class="inner">
        <div class="a-field"><label>平台（至少 1 项）</label><div class="a-checks">${checks('platforms', s.platforms || [], dictionaries.platforms || [])}</div></div>
        <div class="a-field"><label>分类（至多 1 项）</label><div class="a-checks">${checks('categories', s.categories || [], allCategories, true)}</div></div>
      </div></div>

      <div class="a-panel"><h3>正文（Markdown）</h3><div class="inner">
        <div class="a-field"><textarea class="a-textarea" name="body_md" style="min-height:190px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px" placeholder="## 编辑点评&#10;&#10;…&#10;&#10;## 适用场景&#10;&#10;- …">${e(s.body_md || '')}</textarea><div class="help">支持 ## / ### 标题、无序列表、**加粗**、&#96;行内代码&#96;。不要写裸 HTML 或外部脚本。</div></div>
      </div></div>

      <div class="a-row" style="margin-top:6px">
        <button class="a-btn primary" type="submit" style="padding:10px 20px">${mode === 'live' ? '提交为 Pull Request' : '保存'}</button>
        <a class="a-btn" href="#/content">取消</a>
        <span class="a-note" style="margin-left:8px">${mode === 'live' ? '提交后请到 Pull Requests 等待 CI 校验。' : '连接 GitHub 后即可提交'}</span>
      </div>
    </form>`;
}

/** 评论分派：live 模式直管 Giscus / GitHub Discussions 真实评论；demo 模式用本地演示数据 */
function pageComments() {
  if (mode === 'live' && GISCUS_ON) return pageDiscussionComments();
  return pageDemoComments();
}

/** Live：读取并管理 GitHub Discussions 中的真实 Giscus 评论 */
function pageDiscussionComments() {
  const all = discussionComments;
  const hidden = all.filter((c) => c.isMinimized).length;
  const info = pageOf('comments', all);
  const errorBox = commentsError
    ? `<div class="a-banner amber">读取评论失败：${e(commentsError)}。请确认 PAT 已开启本仓库的 <strong>Discussions: read &amp; write</strong> 权限。<button class="a-btn sm" data-act="comment-refresh" style="margin-left:8px">重新加载</button></div>`
    : '';
  return `
    <div class="a-banner blue">评论区已接入 <strong>Giscus / GitHub Discussions</strong>，此处直接管理线上真实评论。「隐藏」会折叠评论，「删除」不可恢复；两项操作立即生效，需 PAT 具备 <strong>Discussions: read &amp; write</strong> 权限。</div>
    ${commentsLoading ? '<div class="a-banner amber">正在读取 GitHub Discussions…</div>' : ''}
    ${errorBox}
    <div class="a-cards">
      ${card('评论总数', all.length, 'Discussions 实时数据', 'users')}
      ${card('已隐藏', hidden, '在 Giscus 中折叠', 'eyeOff')}
      ${card('正常显示', all.length - hidden, '前台可见', 'check')}
      ${card('讨论数', new Set(all.map((c) => c.discussionId)).size, '对应站点页面', 'comments')}
    </div>
    <div class="a-panel"><h3>Giscus 评论管理 <button class="a-btn sm" data-act="comment-refresh" style="margin-left:8px">刷新</button></h3>
      <table class="a-table"><thead><tr><th>作者</th><th>所属页面</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
      ${info.rows.map((c) => `<tr>
        <td><strong>@${e(c.author)}</strong>${c.avatar ? `<img src="${e(c.avatar)}" alt="" width="18" height="18" style="border-radius:50%;vertical-align:middle;margin-left:4px" />` : ''}<div class="sub">👍 ${c.reactions}</div></td>
        <td><a href="${e(c.discussionUrl)}" target="_blank" rel="noopener"><code style="font-size:11.5px">${e(c.discussionTitle)}</code></a></td>
        <td style="max-width:420px">${e(c.body.slice(0, 120))}${c.body.length > 120 ? '…' : ''}</td>
        <td><span class="a-badge ${c.isMinimized ? 'gray' : 'green'}">${c.isMinimized ? '已隐藏' : '正常'}</span></td>
        <td>${ago(c.createdAt)}</td>
        <td><div class="a-row">
          ${c.isMinimized
            ? `<button class="a-btn sm" data-act="comment-unhide" data-id="${e(c.id)}">取消隐藏</button>`
            : `<button class="a-btn sm" data-act="comment-hide" data-id="${e(c.id)}">隐藏</button>`}
          <button class="a-btn sm danger" data-act="comment-delete" data-id="${e(c.id)}">删除</button>
          <a class="a-btn sm" href="${e(c.url)}" target="_blank" rel="noopener">查看 ↗</a>
        </div></td></tr>`).join('') || `<tr><td colspan="6" class="a-empty">${commentsError ? '未能读取评论' : '暂无评论（访客首次打开某页面评论区时会自动创建讨论）'}</td></tr>`}
      </tbody></table>
      ${pager('comments', info)}
    </div>`;
}

/** Demo：本地演示评论仓库，仅存浏览器 localStorage */
function pageDemoComments() {
  const all = allLocalComments().filter((c) => c.status !== 'deleted');
  const pending = all.filter((c) => c.status === 'pending');
  const info = pageOf('comments', all);
  return `
    <div class="a-cards">
      ${card('待审核', pending.length, '需优先处理', 'clock')}
      ${card('已公开', all.filter((c) => c.status === 'published').length, '前台可见', 'check')}
      ${card('已隐藏', all.filter((c) => c.status === 'hidden').length, '违规 / 重复', 'eyeOff')}
      ${card('合计', all.length, '总评论数', 'users')}
    </div>
    <div class="a-panel"><h3>反垃圾规则</h3><div class="inner a-note">
      外链 / 短链、破解 / 序列号 / 引流关键词 → 强制进入待审；60 秒内超过 3 条限流；完全相同内容拒绝重复提交。生产环境由 GitHub 账号体系天然承担身份与反垃圾。
    </div></div>
    <div class="a-panel"><h3>评论审核</h3>
      <table class="a-table"><thead><tr><th>作者</th><th>所属软件</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
      ${info.rows.map((c) => `<tr>
        <td><strong>${e(c.author_name)}</strong><div class="sub">👍 ${c.like_count || 0}</div></td>
        <td><code style="font-size:11.5px">${e(c.software_slug)}</code></td>
        <td style="max-width:420px">${e(c.body_md.slice(0, 120))}${c.body_md.length > 120 ? '…' : ''}</td>
        <td><span class="a-badge ${c.status === 'published' ? 'green' : c.status === 'hidden' ? 'gray' : 'amber'}">${c.status === 'published' ? '已公开' : c.status === 'hidden' ? '已隐藏' : '待审核'}</span></td>
        <td>${ago(c.created_at)}</td>
        <td><div class="a-row">
          ${c.status !== 'published' ? `<button class="a-btn sm" data-act="comment-approve" data-id="${e(c.id)}">通过</button>` : ''}
          ${c.status !== 'hidden' ? `<button class="a-btn sm" data-act="comment-hide" data-id="${e(c.id)}">隐藏</button>` : ''}
          <button class="a-btn sm danger" data-act="comment-delete" data-id="${e(c.id)}">删除</button>
        </div></td></tr>`).join('') || '<tr><td colspan="6" class="a-empty">暂无评论</td></tr>'}
      </tbody></table>
      ${pager('comments', info)}
    </div>`;
}

function pageAudit() {
  const rows = mode === 'live'
    ? commits.map((c) => ({ at: c.date, action: 'commit', detail: `${c.sha} ${c.message}`, actor: c.author, url: c.url }))
    : audit.map((a) => ({ ...a, url: '' }));
  const info = pageOf('audit', rows);
  return `
    ${mode === 'live' ? '<div class="a-banner blue">审计日志直接读取仓库 commit 历史：谁、何时、改了什么都可追溯，且无法被后台绕过。</div>' : ''}
    <div class="a-panel"><h3>操作记录</h3>
      <table class="a-table"><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>详情</th><th></th></tr></thead><tbody>
      ${info.rows.map((r) => `<tr><td>${e(r.at ? new Date(r.at).toLocaleString('zh-CN') : '—')}</td><td>${e(r.actor || '—')}</td><td><span class="a-badge blue">${e(r.action)}</span></td><td>${e(r.detail)}</td><td>${r.url ? `<a class="a-btn sm" href="${e(r.url)}" target="_blank" rel="noopener">查看 ↗</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="a-empty"><div class="emoji">📄</div>暂无记录，试着在队列或评论页做一次操作</td></tr>'}
      </tbody></table>
      ${pager('audit', info)}
    </div>`;
}

function pageSettings() {
  return `
    <div>
      <div class="a-panel"><h3>连接状态</h3><div class="inner">
        <dl class="a-kv">
          <dt>运行模式</dt><dd><span class="a-badge ${mode === 'live' ? 'green' : 'amber'}">${mode === 'live' ? 'Live · GitHub REST API' : 'Demo · localStorage'}</span></dd>
          <dt>目标仓库</dt><dd>${e(OWNER)}/${e(REPO)} ${gh.isPlaceholderRepo ? '<span class="a-badge amber">未配置（占位符）</span>' : ''}</dd>
          <dt>站点基路径</dt><dd><code>${e(BASE)}</code></dd>
          <dt>数据源</dt><dd>git（content/software/*.md）+ 构建期 JSON 快照</dd>
          <dt>评论区</dt><dd><span class="a-badge ${GISCUS_ON ? 'green' : 'amber'}">${GISCUS_ON ? 'Giscus / Discussions（后台可直接管理）' : '本地演示仓库'}</span></dd>
          <dt>令牌存储</dt><dd>sessionStorage（关闭标签页即失效）</dd>
          <dt>写操作</dt><dd>临时分支 → commit → PR → Content CI → 合并发布</dd>
        </dl>
        <div class="a-row" style="margin-top:18px">
          ${mode === 'live' ? '<button class="a-btn danger" data-act="signout">退出登录</button>' : '<a class="a-btn primary" href="#/login">连接 GitHub</a>'}
          <a class="a-btn" href="${SITE('data/software.json')}" target="_blank" rel="noopener">开放数据 JSON ↗</a>
          <a class="a-btn" href="${SITE('data/health.json')}" target="_blank" rel="noopener">健康报告 ↗</a>
        </div>
      </div></div>
      <div class="a-panel"><h3>权限矩阵</h3><div class="inner"><table class="a-table"><thead><tr><th>角色</th><th>内容</th><th>审核</th><th>评论</th><th>设置</th></tr></thead><tbody>
        <tr><td><strong>管理员</strong></td><td>增删改 / 合并</td><td>全部</td><td>全部</td><td>可改</td></tr>
        <tr><td><strong>审核员</strong></td><td>审核 / 下架</td><td>队列</td><td>隐藏 / 删除</td><td>—</td></tr>
        <tr><td><strong>贡献者</strong></td><td>仅提交 PR</td><td>—</td><td>发表</td><td>—</td></tr>
      </tbody></table></div></div>
    </div>`;
}

/* ---------------- 内容表单 → Markdown ---------------- */
function buildMarkdown(form: HTMLFormElement): { slug: string; content: string } | null {
  const fd = new FormData(form);
  const v = (k: string) => String(fd.get(k) || '').trim();
  const arr = (k: string) => fd.getAll(k).map(String);
  const slug = v('slug');
  const originalSlug = form.dataset.slug || '';
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) { toast('slug 格式不正确（小写字母、数字、连字符，2–60 位）', 'err'); return null; }
  // 标识符创建后可改；改名时仍需保证全局唯一（排除条目自身的原 slug）
  if (catalog.some((item) => item.slug === slug && item.slug !== originalSlug)) { toast('标识符已存在，请换一个全局唯一的 slug', 'err'); return null; }
  // 分类必填且至多 1 项（单选），平台至少 1 项且必须在字典内
  const categoryValues = arr('categories');
  if (categoryValues.length === 0) { toast('请选择 1 个分类', 'err'); return null; }
  if (categoryValues.length > 1) { toast('分类至多 1 项，请只选择 1 个分类', 'err'); return null; }
  const allowedPlatforms = new Set((dictionaries.platforms || []).map((p: any) => p.slug));
  const platformValues = allowedPlatforms.size ? arr('platforms').filter((p) => allowedPlatforms.has(p)) : arr('platforms');
  if (platformValues.length === 0) { toast('请至少选择 1 个支持平台', 'err'); return null; }
  // 「是否开源」决定仓库 / 许可证是否写入：非开源时两项禁用，不出现在 frontmatter
  const openSource = v('is_open_source') === 'true';
  if (openSource) {
    if (!v('repo_url')) { toast('开源软件必须填写代码仓库 URL', 'err'); return null; }
    if (!v('license_code')) { toast('开源软件必须选择许可证', 'err'); return null; }
  } else if (v('repo_url') || v('license_code')) {
    // 不开源时两项禁用、清空且不参与提交；这里兜底防止残留值写进 frontmatter
    toast('不开源时代码仓库与许可证不填写', 'err'); return null;
  }
  const q = (s: string) => JSON.stringify(s);
  const csv = (s: string) => `[${s.split(',').map((x) => x.trim()).filter(Boolean).join(', ')}]`;
  const lines = [
    '---', 'schema_version: 1',
    `slug: ${q(slug)}`, `name: ${q(v('name'))}`, `tagline: ${q(v('tagline'))}`,
    `description_md: ${q(v('description_md'))}`,
    v('version') ? `version: ${q(v('version'))}` : '',
    v('developer') ? `developer: ${q(v('developer'))}` : '',
    `homepage_url: ${q(v('homepage_url'))}`,
    openSource && v('repo_url') ? `repo_url: ${q(v('repo_url'))}` : '',
    `download_url: ${q(v('download_url'))}`,
    openSource && v('license_code') ? `license_code: ${q(v('license_code'))}` : '',
    `pricing: ${q(v('pricing'))}`,
    `is_open_source: ${openSource ? 'true' : 'false'}`,
    `platforms: ${csv(platformValues.join(','))}`,
    `categories: ${csv(categoryValues.join(','))}`,
    'screenshots: []',
    v('released_at') ? `released_at: ${q(v('released_at'))}` : '',
    `last_checked_at: ${q(v('last_checked_at'))}`,
    `featured: ${fd.get('featured') ? 'true' : 'false'}`,
    `weight: ${Number(v('weight') || 50)}`,
    `downloads: ${Math.max(0, Math.floor(Number(v('downloads') || 0)))}`,
    `risk_level: ${q(v('risk_level'))}`,
    `seo_title: ${q(`${v('name')} 免费软件 - 1024Soft`.slice(0, 60))}`,
    `seo_description: ${q(`${v('tagline')}。${v('description_md').slice(0, 100)}`.slice(0, 155))}`,
    '---', '', v('body_md') || '## 编辑点评\n\n待补充。'
  ].filter((x) => x !== '');
  return { slug, content: lines.join('\n') + '\n' };
}

/* ---------------- 渲染与事件 ---------------- */
/** 「是否开源」联动：不开源时代码仓库与许可证置灰、清空且不参与提交；许可证下拉不显示占位文字与下拉箭头 */
function syncOssFields() {
  const form = document.querySelector<HTMLFormElement>('form[data-form="content"]');
  if (!form) return;
  const open = form.querySelector<HTMLInputElement>('input[name="is_open_source"]:checked')?.value !== 'false';
  const repo = form.querySelector<HTMLInputElement>('input[name="repo_url"]');
  const license = form.querySelector<HTMLSelectElement>('select[name="license_code"]');
  if (repo) { repo.disabled = !open; repo.required = open; if (!open) repo.value = ''; }
  if (license) {
    license.disabled = !open; license.required = open;
    if (open) {
      // 切回开源：按字典重建选项，并尽量恢复修改前选中的许可证
      const current = license.value || license.dataset.ossRestore || '';
      license.innerHTML = licenseOptions(current);
      if (current) license.value = current;
    } else {
      // 不开源：清空全部选项，既不显示占位文字也不显示任何许可证文字；CSS 同步隐藏下拉箭头
      if (license.value) license.dataset.ossRestore = license.value;
      license.innerHTML = '';
      license.value = '';
    }
  }
  form.querySelectorAll<HTMLElement>('.a-field').forEach((f) => {
    if (f.querySelector('[data-oss-field]')) f.classList.toggle('oss-locked', !open);
  });
}

async function render() {
  const { page, arg } = currentRoute();
  const root = $('#admin-root'); if (!root) return;
  if (page === 'login') { root.innerHTML = pageLogin(); return; }
  // 评论页在 live 模式下按需拉取真实 Discussions 评论（首次进入时加载，之后走缓存）
  if (page === 'comments') await ensureDiscussionComments();
  const bodyHtml = page === 'dashboard' ? pageDashboard()
    : page === 'queue' ? pageQueue()
    : page === 'content' ? pageContent()
    : page === 'edit' ? pageEditor(arg)
    : page === 'comments' ? pageComments()
    : page === 'audit' ? pageAudit()
    : page === 'settings' ? pageSettings()
    : pageDashboard();
  const heading = page === 'edit' ? (arg === 'new' ? '新增软件条目' : `编辑 ${arg}`) : '';
  root.innerHTML = shell(bodyHtml, page === 'edit' ? 'content' : page, heading);
  syncOssFields();
  const tabTitle = NAV.find((i) => i.key === page)?.label || (page === 'edit' ? '编辑软件条目' : '管理后台');
  document.title = `${tabTitle} - 1024Soft 管理后台`;
}

async function boot() {
  audit = readLS('1024soft_admin_audit', []);
  await loadCatalog();
  if (gh.restoreSession()) {
    try {
      user = await gh.checkPermission();
      if (user.canPush) mode = 'live'; else { gh.signOut(); toast('该账号对仓库没有 push 权限，已切换到演示模式', 'err'); }
    } catch { gh.signOut(); }
  }
  await loadQueue(); await loadCommits();
  // 预加载评论数供工作台展示；失败不阻塞登录，进入评论页时会重试并给出提示
  if (mode === 'live' && GISCUS_ON) {
    ensureDiscussionComments().then(() => { if (currentRoute().page === 'dashboard') render(); });
  }
  if (!location.hash) location.hash = '#/dashboard';
  await render();

  window.addEventListener('hashchange', () => render());

  // 全局事件委托：所有 data-act / data-form 由这里统一处理
  document.addEventListener('click', async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn || busy) return;
    const act = btn.dataset.act || '';
    const id = btn.dataset.id || '';

    if (act === 'demo-login') { mode = 'demo'; gh.signOut(); location.hash = '#/dashboard'; await loadQueue(); await render(); toast('已进入演示模式', 'ok'); return; }
    if (act === 'signout') { gh.signOut(); user = null; mode = 'demo'; await loadQueue(); location.hash = '#/dashboard'; await render(); toast('已退出登录，令牌已从会话中清除', 'ok'); return; }
    if (act === 'pager') {
      const key = btn.dataset.key || '';
      const n = Number(btn.dataset.n);
      if (!(key in pageState) || !Number.isInteger(n) || n < 1) return;
      pageState[key] = n;
      await render();
      const bar = document.querySelector<HTMLElement>(`[data-pager="${key}"]`);
      bar?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      return;
    }
    if (act === 'refresh') { busy = true; await loadQueue(); await loadCommits(); busy = false; await render(); toast('已刷新', 'ok'); return; }
    if (act === 'queue-approve' || act === 'queue-reject') {
      queue = queue.map((q) => q.id === id ? { ...q, state: act === 'queue-approve' ? 'approved' : 'rejected' } : q);
      writeLS('1024soft_demo_queue', queue);
      const item = queue.find((q) => q.id === id);
      log(act === 'queue-approve' ? '审核通过' : '审核驳回', item?.title || id);
      await render(); toast(act === 'queue-approve' ? '已通过（演示）' : '已驳回（演示）', 'ok'); return;
    }
    if (act === 'comment-refresh') {
      commentsLoaded = false;
      await ensureDiscussionComments(true);
      await render(); toast('评论已刷新', 'ok'); return;
    }
    if (act === 'comment-approve' || act === 'comment-unhide' || act === 'comment-hide' || act === 'comment-delete') {
      const a = act === 'comment-hide' ? 'hide' : act === 'comment-delete' ? 'delete' : 'unhide';
      if (mode === 'live' && GISCUS_ON) {
        if (a === 'delete' && !window.confirm('确定删除这条评论？此操作不可恢复。')) return;
        busy = true; btn.textContent = '处理中…';
        try {
          await gh.moderateDiscussionComment(id, a);
          log(a === 'hide' ? '评论隐藏' : a === 'unhide' ? '评论取消隐藏' : '评论删除', id);
          commentsLoaded = false;
          await ensureDiscussionComments(true);
          await render(); toast(a === 'hide' ? '评论已隐藏' : a === 'unhide' ? '评论已取消隐藏' : '评论已删除', 'ok');
        } catch (err: any) {
          toast(`操作失败：${err.message}`, 'err');
          await render();
        }
        busy = false; return;
      }
      // demo 模式：仅改本机 localStorage
      const local = a === 'hide' ? 'hide' : a === 'delete' ? 'delete' : 'approve';
      moderateLocalComment(id, local as any);
      log(local === 'approve' ? '评论通过（演示）' : local === 'hide' ? '评论隐藏（演示）' : '评论删除（演示）', id);
      await render(); toast('评论状态已更新（演示）', 'ok'); return;
    }
    if (act === 'gh-close') {
      const n = Number(btn.dataset.n);
      busy = true; btn.textContent = '处理中…';
      try {
        await gh.closeIssue(n);
        log('关闭 Issue', `#${n}`);
        await loadQueue(); await render(); toast(`#${n} 已处理`, 'ok');
      } catch (err: any) { toast(`操作失败：${err.message}`, 'err'); await render(); }
      busy = false; return;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === 'is_open_source' && t.type === 'radio') syncOssFields();
  });

  document.addEventListener('input', async (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.act === 'content-query') {
      contentQuery = t.value;
      // 搜索结果变化后重新分页（回到第 1 页），并恢复输入框焦点与光标位置
      pageState.content = 1;
      const caret = t.selectionStart ?? t.value.length;
      await render();
      const next = document.querySelector<HTMLInputElement>('[data-act="content-query"]');
      if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch { /* 某些输入类型不支持 */ } }
    }
  });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target as HTMLFormElement;
    if (form.dataset.form === 'pat') {
      ev.preventDefault();
      const pat = (form.querySelector('#pat') as HTMLInputElement)?.value || '';
      if (!pat) return;
      busy = true; toast('正在验证 GitHub 权限…');
      try {
        gh.signIn(pat);
        const check = await gh.checkPermission();
        if (!check.canPush) throw new Error('该账号对目标仓库没有 push 权限，请检查 PAT 的仓库范围与权限');
        user = check; mode = 'live';
        await loadQueue(); await loadCommits();
        if (GISCUS_ON) ensureDiscussionComments().then(() => { if (currentRoute().page === 'dashboard') render(); });
        log('登录', `PAT 权限自检通过 (${check.login})`);
        location.hash = '#/dashboard'; await render(); toast(`已连接 ${check.scope}`, 'ok');
      } catch (err: any) {
        gh.signOut(); toast(`登录失败：${err.message}`, 'err');
      }
      busy = false; return;
    }
    if (form.dataset.form === 'content') {
      ev.preventDefault();
      const built = buildMarkdown(form);
      if (!built) return;
      // 标识符创建后可改：编辑态改名时，同一提交内新建新文件并删除旧文件
      const isNew = form.dataset.new === 'true';
      const oldSlug = form.dataset.slug || '';
      const renamed = !isNew && !!oldSlug && oldSlug !== built.slug;
      const action = isNew ? 'create' : renamed ? 'rename' : 'update';
      const path = `content/software/${built.slug}.md`;
      const deletePath = renamed ? `content/software/${oldSlug}.md` : '';
      const message = renamed ? `content: rename ${oldSlug} -> ${built.slug} via admin` : `content: ${action} ${built.slug} via admin`;
      const label = renamed ? '重命名条目 PR' : action === 'create' ? '新建条目 PR' : '更新条目 PR';
      try {
        if (mode === 'live') {
          busy = true; toast('正在创建分支与 Pull Request…');
          const res = await gh.commitAsPR({ path, content: built.content, message, action, slug: built.slug, deletePath });
          log(label, `${built.slug}${res.prUrl ? ` → ${res.prUrl}` : ''}`);
          toast(res.prUrl ? 'PR 已创建，等待 Content CI 校验' : 'commit 已创建（未能自动开 PR）', 'ok');
          if (res.prUrl) window.open(res.prUrl, '_blank', 'noopener');
        } else {
          const edits = readLS('1024soft_admin_content_edits', {});
          if (renamed) delete edits[oldSlug];
          edits[built.slug] = { content: built.content, at: new Date().toISOString() };
          writeLS('1024soft_admin_content_edits', edits);
          log(renamed ? '重命名条目（演示）' : action === 'create' ? '新建条目（演示）' : '更新条目（演示）', `${built.slug}.md`);
          toast('已保存。连接 GitHub 后保存会生成真实 PR。', 'ok');
        }
        location.hash = '#/content'; await render();
      } catch (err: any) { toast(`提交失败：${err.message}`, 'err'); }
      busy = false; return;
    }
  });
}

boot();
