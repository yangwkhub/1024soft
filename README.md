# 1024Soft

> 1024soft致力于寻找免费、好用、开源的软件，这是一个本人开发的开源网站。

> https://yangwkhub.github.io/1024soft

> 欢迎共建者和用户加入，网站交流QQ群为1132949100。

---

## 1. 它是什么 / 不是什么

| 是 | 不是 |
| --- | --- |
| 静态站点（Astro 5 SSG），每条软件是仓库里的一个 Markdown 文件 | 软件下载站，本站**不托管任何安装包** |
| Git 即数据库，GitHub Actions 即构建期后端 | 需要 Node 服务 / 数据库才能跑的应用 |
| Issue / PR 即投稿审核流，Discussions 即评论存储 | 自建账号体系 |
| `/admin` 静态 SPA，浏览器直连 GitHub REST API | 带后端的管理系统 |

所有下载链接都经过 `/go/<slug>/` 确认页并显示目标域名，且域名必须在 `data/allowed-download-hosts.json` 白名单内。

### v1.0 功能

- **前台**：首页、分类 / 平台 / 许可证归档、多维筛选（URL 可分享）、全文搜索（Pagefind + JSON 降级）、详情页（JSON-LD）、跳转确认页、热门榜单、RSS、Sitemap、开放数据 JSON、深浅色主题、移动端适配。
- **评论区**：生产态用 [Giscus](https://giscus.app/) 挂到 GitHub Discussions（GitHub 账号登录、点赞、回复、举报）；未配置 ID 时自动降级为**本机演示模式**（发表 / 回复 / 排序 / 点赞 / 先审后发 / 反垃圾）。
- **管理后台**：`/admin/` hash 路由 SPA，含工作台、投稿审核、软件条目增删改、评论审核、审计日志、设置与连接。维护者用自己的 fine-grained PAT 登录，**令牌只存 sessionStorage**，所有写操作创建临时分支 → commit → PR → 触发 Content CI。

### 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Astro 5（SSG）+ TypeScript + 原生 CSS（Tailwind 4 Vite 插件可选） |
| 内容 | `content/software/*.md` + `data/*.json` 字典，Zod schema 在 `src/content.config.ts` |
| 校验 | `scripts/validate-content.mjs`（跨文件校验：slug 唯一、字典引用、白名单域名、字段联动） |
| 搜索 | Pagefind 客户端索引，`data/search-index.json` 降级 |
| 评论 | Giscus → GitHub Discussions；未配置时 localStorage 演示仓库 |
| 后台 | 静态 SPA（`src/scripts/admin.ts`）+ Octokit 直连 GitHub REST API |
| 部署 | GitHub Actions → GitHub Pages（Source = GitHub Actions） |
| 成本 | **0 元/月**（可选自定义域名的 DNS 费用除外） |

---

## 2. 本地运行

```bash
# Node.js >= 20（建议 22）
npm install
cp .env.example .env       # 可选；不配置也能以演示模式跑起来
npm run validate           # 校验全部内容与字典
npm run dev                # 本机开发（仅回环）：http://localhost:4321
npm run build              # 校验 → SSG → CSP 哈希 → HTTPS 守卫 → Pagefind 索引
npm run serve              # 全站 HTTPS 预览：https://127.0.0.1:4321/
```

> `npm run build` 的五步分别是 `validate-content.mjs`（内容校验）、`astro build`（SSG）、`csp-hashes.mjs`（为 Astro 内联到 HTML 的小脚本计算 SHA-256 并写回 CSP meta，从而**不放开 `unsafe-inline`** 也能让筛选 / 跳转倒计时 / 搜索快捷键正常执行）、`check-https.mjs`（全站 HTTPS 守卫）、`pagefind`（客户端索引）。顺序不能颠倒。

`npm run serve` 会用 OpenSSL 自签证书把 `dist/` 跑在 HTTPS 上，同时把 `http://127.0.0.1:4322/` 的明文请求 301 升级到 HTTPS；首次访问浏览器会提示「不安全」，点「高级 → 继续前往」即可（线上 GitHub Pages 使用 GitHub 签发的正式证书，不会有此提示）。仅本机排障时可 `npm run serve:http` 临时回退到明文 HTTP，`npm run preview` 同理。服务只绑定 `127.0.0.1`，不暴露到局域网。

部分内置预览面板无法校验自签证书，可 `SERVE_PREVIEW_PORT=4323 npm run serve` 额外开启一个**只读回环 HTTP 镜像**（默认关闭，仅供界面展示，不是站点对外服务，线上 GitHub Pages 不存在此通道）。


### 全站 HTTPS

站点不含任何明文 HTTP 传输，并在构建期强制校验：

| 层面 | 做法 |
| --- | --- |
| 站点 URL | `PUBLIC_SITE_URL` / `PUBLIC_REPO_URL` 一律 `https://`；误配 `http://` 时自动升级，`check-https.mjs` 在 CI 中硬性拦截 |
| 产物 | `check-https.mjs` 扫描 `dist/`，任何 `http://` 资源引用都会让构建失败；canonical / og:url / sitemap / RSS 必须是绝对 https URL |
| 浏览器 | 前台与后台 CSP 均带 `upgrade-insecure-requests`，遗留明文子资源自动升级，杜绝混合内容 |
| GitHub Pages | TLS 由 GitHub 终止，需在 Settings → Pages 勾选 **Enforce HTTPS**（静态产物无法自行发送 HSTS 响应头）；自定义域名同样由 GitHub 签发免费证书 |
| 本地预览 | `npm run serve` 用自签证书跑 HTTPS；HTTP 端口 4322 只做 301 跳转 |

`deploy.yml` / `content-ci.yml` 只新增校验步骤，`upload-pages-artifact` / `deploy-pages` / `.nojekyll` / `include-hidden-files` 一律未改动，**部署到 GitHub Pages 的方式完全不变**。

---

## 3. 目录结构

```
1024soft-site/
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml          # 内容/代码变更 → 构建 → Pages
│   │   └── content-ci.yml      # PR 关卡：校验 + 完整构建
│   ├── ISSUE_TEMPLATE/         # 投稿表单
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── content/software/*.md       # 30 条种子数据（一条软件一个文件）
├── data/                       # 分类 / 平台 / 许可证 / 下载域名白名单
├── public/                     # favicon.svg、robots.txt、站内图片
├── scripts/
│   ├── seed-content.mjs        # 重新生成示例数据
│   ├── validate-content.mjs    # 内容校验（CI 关卡）
│   ├── csp-hashes.mjs          # 为 Astro 内联脚本生成 CSP SHA-256 哈希
│   ├── check-https.mjs         # 全站 HTTPS 守卫（CI 关卡）
│   └── serve-https.mjs         # 本地 HTTPS 静态预览（OpenSSL 自签证书）
├── src/
│   ├── components/             # Header / Card / Catalog / Comments / Search …
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── data.ts             # 数据归一化、字典、筛选、排序、Markdown 渲染
│   │   ├── github-api.ts       # 后台 GitHub REST 封装（Octokit）
│   │   ├── repository/         # SoftwareRepository 抽象（git / api 可替换）
│   │   └── comments/           # CommentRepository 抽象（giscus / local）
│   ├── pages/                  # 所有 SSG 页面 + 静态 JSON / RSS 端点
│   ├── scripts/admin.ts        # 管理后台 SPA
│   └── styles/                 # global.css / admin.css
├── astro.config.mjs
├── PRD.md                      # 完整产品需求文档
└── package.json
```

---

## 4. 部署到 GitHub Pages（12 步）

1. **建仓库**：新建公开仓库（例如 `1024soft`），把本目录内容推到 `main`。公开仓库才能免费使用 GitHub Pages。
2. **本地自检**：`npm install && npm run validate && npm run build`，确认 `dist/index.html` 与 `dist/_pagefind/` 都生成。
3. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**（不要选 "Deploy from a branch"），并勾选 **Enforce HTTPS** —— 这是全站 HTTPS 的必需一步，静态产物无法自己发送 HSTS 响应头。
4. **Settings → Secrets and variables → Actions → Variables** 添加下表变量（都是公开值，**不要创建任何 Secret**）：

   | Variable | 项目站点示例 | 说明 |
   | --- | --- | --- |
   | `PUBLIC_SITE_URL` | `https://yourname.github.io` | **必须 `https://`**；自定义域名时填 `https://soft.example.com` |
   | `PUBLIC_BASE_PATH` | `/1024soft` | **必须与仓库名一致**；用户站点 / 自定义域名填 `/` |
   | `PUBLIC_REPO_OWNER` | `yourname` | 后台 API 用 |
   | `PUBLIC_REPO_NAME` | `1024soft` | 后台 API 用 |
   | `PUBLIC_REPO_URL` | `https://github.com/yourname/1024soft` | 页脚 / 投稿 / 编辑链接 |
   | `PUBLIC_GISCUS_REPO` | `yourname/1024soft` | 评论区 |
   | `PUBLIC_GISCUS_REPO_ID` | `R_kgDO...` | 从 giscus.app 获取 |
   | `PUBLIC_GISCUS_CATEGORY` | `Comments` | Discussions 分类名 |
   | `PUBLIC_GISCUS_CATEGORY_ID` | `DIC_kwDO...` | 从 giscus.app 获取 |
   | `PUBLIC_GISCUS_MAPPING` | `pathname` | **固定用 pathname**，换域名不丢评论 |
   | `PUBLIC_GISCUS_LANG` | `zh-CN` | 界面语言 |

   未填的变量由 workflow 用 `github.repository_owner` / `github.event.repository.name` 自动兜底；Giscus 留空时前台自动进入本地演示评论区。

5. **开启 Discussions**：Settings → General → Features → ✅ Discussions，并新建一个名为 `Comments` 的分类（类型选 **Announcement / 开放讨论均可**，建议 Q&A 之外的普通讨论）。
6. **装 Giscus App**：到 <https://giscus.app/> 按提示安装 GitHub App 并只授权这个仓库；页面会给出 `data-repo-id` 与 `data-category-id`，填入第 4 步的变量。
7. **分支保护**：Settings → Branches → 为 `main` 加规则，要求 `Content CI` 通过、至少 1 个审批；`CODEOWNERS` 里把 `@OWNER` 改成你的用户名。
8. **首次发布**：推送后到 Actions 查看 `Deploy to GitHub Pages`；成功后打开 `https://yourname.github.io/1024soft/`。
9. **自定义域名（可选）**：把 `public/CNAME` 写入域名，DNS 加 `CNAME → yourname.github.io`，Pages 里填同一域名并开启 Enforce HTTPS；同时把 `PUBLIC_BASE_PATH` 改成 `/`、`PUBLIC_SITE_URL` 改成新域名，重新跑一次 workflow。
10. **验收**：检查 `/rss.xml`、`/sitemap-index.xml`、`/data/software.json`、`/data/search-index.json`、`/data/health.json` 都是 200；确认地址栏为 HTTPS、无混合内容警告、`npm run check:https` 通过；用 Lighthouse 跑首页与详情页；测一次筛选、搜索、跳转确认页、评论区、后台。
11. **回滚**：`git revert <commit>` 后 Actions 会自动重新发布；静态产物无状态，回滚即刻生效。紧急情况下也可在 Actions 里重跑上一个成功的 workflow run。
12. **日常运营**：投稿走 Issue 表单或 `/admin/`，维护者在后台完成审核与上线。

### 常见故障

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 页面 404 / CSS 全丢 | `PUBLIC_BASE_PATH` 与仓库名不一致 | 改成 `/<仓库名>`，重新部署 |
| 搜索无结果 | Pagefind 索引未随产物上传 | 确认 `npm run build` 完整执行；`deploy.yml` 已设 `include-hidden-files: true` 且写了 `.nojekyll` |
| 评论区一直是演示模式 | `PUBLIC_GISCUS_REPO_ID` / `CATEGORY_ID` 为空或格式不对 | ID 应以 `R_` 与 `DIC_` 开头 |
| 后台登录提示无权限 | PAT 不是 fine-grained，或没授权到该仓库 | 见第 5 节重新签发 |
| 后台按钮点了没反应 | CSP 拦了内联脚本 / PAT 过期 | 后台脚本全部走外部 bundle；重新登录 |
| 换域名后评论「消失」 | 用了 `url` 映射 | 本项目固定 `pathname`，不要改成 `url` |

---

## 5. 管理后台使用说明

1. 打开 `/admin/`。默认是**演示模式**，可直接体验全部页面（数据仅存本机）。
2. 点右上角 **连接 GitHub** → 到 GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token：
   - Repository access：**Only select repositories** → 选本项目；
   - Permissions：`Contents: Read & Write`、`Issues: Read & Write`、`Pull requests: Read & Write`、`Metadata: Read-only`（评论管理另加 `Discussions: Read & Write`）；
   - 有效期建议 ≤ 90 天。
3. 把令牌粘进后台登录框。后台会调用 `GET /user` 与 `GET /repos/{owner}/{repo}` 做权限自检，无 `push` 权限直接拒绝。
4. 令牌仅保存在 **sessionStorage**（关闭标签页即失效），不会写入仓库、`.env`、CI、日志或 URL。
5. 登录后：
   - **投稿审核**聚合 Issues 与 PRs，按优先级 / SLA 排序，可关闭 Issue、合并 PR；
   - **软件条目**可新增 / 编辑，保存后创建 `admin/<action>-<slug>-<ts>` 临时分支 → commit → PR，等待 `Content CI` 校验；
   - **评论管理**在生产态跳转到 Discussions（Giscus 承担审核），演示态可直接通过 / 隐藏 / 删除；
   - **审计日志**直接读取仓库 commit 历史，无法被后台绕过。

> 安全边界：后台**没有**任何服务端密钥，也不存 PAT；任何人都可以在浏览器里打开 `/admin/`，但没有有效 PAT 就只能看演示数据，无法改动仓库。

---

## 6. 新增一条软件

最简单：在 GitHub 上点 **Issues → 投稿一款免费软件** 填表单；维护者审核后由后台或手动生成 Markdown。

直接提 PR：

```bash
cp content/software/7zip.md content/software/my-tool.md
# 修改 frontmatter，slug / 文件名保持一致
npm run validate
git checkout -b content/my-tool && git add . && git commit -m "content: add my-tool"
# 推上去开 PR，等 Content CI 全绿后合并，Pages 自动发布
```

字段规范见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 与 `src/content.config.ts`。关键约束：所有 URL 必须 `https://`；`is_open_source: true` 必须同时有 `repo_url` 与 `license_code`，为 false 时两者留空；`categories` 必须且只能有 1 个，且必须存在于字典；`download_url` 域名必须在白名单内。

---

## 7. 扩展到方案 B（可选）

PRD 里预留了 `SoftwareRepository` / `CommentRepository` 抽象。当出现「匿名评论、实时热度、站内投稿、> 2000 条数据」等需求时：

1. 在 `src/lib/repository/` 新增 `api.ts` 实现同一接口，`DATA_SOURCE=api` 切换；页面组件与 URL 不变。
2. 后端用 Cloudflare Workers + Hono + D1，或 Supabase Postgres + Edge Functions（免费层）。
3. 前端保留构建期 `data/software.json` 静态快照作为数据库故障时的降级数据源。

扩容前请按 PRD 第 14 节复核各平台免费额度，额度政策会变化。

---

## 8. 许可与致谢

- 代码：[MIT](./LICENSE)
- 内容（软件条目文字）：[CC BY-SA 4.0](./CONTENT_LICENSE)
- 第三方软件版权归各自作者所有；本站不托管、不修改、不分发任何安装包，也不对第三方软件安全性作担保。

站点由 Astro、Pagefind、Giscus、GitHub Actions / Pages 共同支撑，全部有可免费使用的方案。
