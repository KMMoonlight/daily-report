# Tech Daily & Weekly

面向软件开发者的证据优先科技简报。系统从中英文官方来源、GitHub Trending、科技媒体与技术博主采集信息，使用云端语言模型完成筛选、聚合与中文编辑。

## Docker 直接启动

直接构建并后台运行：

```bash
docker compose up -d --build
```

启动后访问：

<http://localhost:8080>

没有 `.env` 时网站仍会启动，但自动生成日报会暂停。需要自动生成时，将 `.env.example` 复制为 `.env` 并填写模型 API 配置，然后重新执行同一条 Docker 命令。

停止：

```bash
docker compose down
```

日报、周报、候选池和缓存保存在 Docker 卷中，重启容器不会丢失。

## Docker 中的自动任务

容器会在北京时间 09:00 后自动补齐前一自然日的日报，并在周一 10:00 后生成上一周周报。报告生成后自动重建网站，不需要 Git 提交或宿主机定时任务。

如需修改模型配置，编辑 `.env` 后运行：

```bash
docker compose up -d --build --force-recreate
```

支持的配置：

- `LLM_PROVIDER`：`openai-compatible`、`anthropic` 或 `gemini`
- `LLM_API_KEY`：模型密钥
- `LLM_BASE_URL`：兼容接口地址
- `LLM_TRIAGE_MODEL`：低成本初筛模型
- `LLM_SYNTHESIS_MODEL`：高质量日报与周报模型
- `APP_PORT`：本机访问端口，默认 `8080`
- `GITHUB_TOKEN`：匿名限额成为瓶颈后再配置

编辑 `config/sources.json` 管理默认来源。来源只会从配置加载，不会因自动发现而永久加入。

## 开发者命令

```sh
npm install
npm run dev

# 指定日期生成日报
npm run generate:daily -- --date=2026-07-25

# 指定周一生成周报
npm run generate:weekly -- --week-start=2026-07-20

# 手动执行一次完整调度
npm run scheduler:run

```

## Data boundaries

- `src/content/`：可发布的日报和周报 Markdown；Docker 中映射为持久卷。
- `.cache/`：网页正文与采集响应；对应周报成功后清理。
- `.data/`：运行账本、候选池、持续主题、来源基线和日志。
- 所有来源都会保存在发布内容中，页面默认只展示关键来源。
- 已发布报告不可修改；事实错误通过后续更正条目处理。

## Deployment

Zeabur 可直接从仓库中的 `Dockerfile` 部署。配置上述模型环境变量，并为 `/app/src/content`、`/app/.data`、`/app/.cache` 挂载持久卷。容器监听 `8080` 端口。所有页面均输出 `noindex`，且站点不包含访问分析脚本。

生产运行、失败恢复和验收步骤见 [运行手册](./docs/operations.md)。
