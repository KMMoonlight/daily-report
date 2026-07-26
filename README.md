# Tech Daily & Weekly

面向软件开发者的证据优先科技简报。系统从中英文官方来源、GitHub、论文与技术社区采集信息，在本机使用云端语言模型完成筛选、聚合与中文编辑，生成 Astro Markdown 内容并通过 Git 推送触发 Zeabur 部署。

## Requirements

- macOS（定时任务使用 `launchd`）
- Node.js 24+
- Git，且当前分支已连接可推送的 GitHub 远端
- Zeabur 项目已连接该私有 GitHub 仓库
- 一个受支持的云端模型 API

## Setup

```sh
npm install
cp .env.example .env
npm run check
npm test
npm run build
```

编辑 `.env`：

- `LLM_PROVIDER`：`openai-compatible`、`anthropic` 或 `gemini`
- `LLM_API_KEY`：仅保存在本机
- `LLM_BASE_URL`：可选的兼容接口地址
- `LLM_TRIAGE_MODEL`：低成本初筛模型
- `LLM_SYNTHESIS_MODEL`：高质量日报与周报模型
- `AUTO_PUBLISH`：调度任务是否自动提交并推送
- `GITHUB_TOKEN`：匿名限额成为瓶颈后再配置

编辑 `config/sources.json` 管理默认来源。来源只会从配置加载，不会因自动发现而永久加入。

## Commands

```sh
# 本地网站
npm run dev

# 指定日期生成日报
npm run generate:daily -- --date=2026-07-25

# 指定周一生成周报
npm run generate:weekly -- --week-start=2026-07-20

# 手动执行一次完整调度
npm run scheduler:run

# 安装 / 删除 macOS 定时任务
npm run scheduler:install
npm run scheduler:install -- --uninstall
```

定时任务每天北京时间 09:00 生成前一自然日的日报，并在周一 10:00 生成上一自然周周报。错过运行时会逐日回填；首次运行只从前一自然日开始。

## Data boundaries

- `src/content/`：可发布的日报和周报 Markdown，提交到 Git。
- `.cache/`：网页正文与采集响应，仅保存在本机；对应周报成功后清理。
- `.data/`：运行账本、候选池、持续主题、来源基线和日志，仅保存在本机。
- 所有来源都会保存在发布内容中，页面默认只展示关键来源。
- 已发布报告不可修改；事实错误通过后续更正条目处理。

## Deployment

仓库包含用于 Zeabur 的多阶段 `Dockerfile`，最终以 Nginx 在 8080 端口提供 Astro 静态输出。设置构建参数 `SITE_URL` 为公开地址，并保持仓库为私有、网站为公开。所有页面均输出 `noindex`，且站点不包含访问分析脚本。

生产运行、失败恢复和验收步骤见 [运行手册](./docs/operations.md)。
