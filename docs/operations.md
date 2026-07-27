# 生产运行手册

## Docker 一键运行（推荐）

```bash
docker compose up -d --build
```

Docker 容器同时提供网站、日报/周报调度和静态站重建。

查看日志与停止服务：

```bash
docker compose logs -f
docker compose down
```

Zeabur 直接使用仓库 `Dockerfile`，监听 8080 端口。

自动拉取依赖运行时环境变量（不是构建参数）：

- `LLM_API_KEY`
- `LLM_TRIAGE_MODEL`
- `LLM_SYNTHESIS_MODEL`
- 可选：`LLM_PROVIDER`、`LLM_BASE_URL`、`SCHEDULER_MIN_HOUR`

内容持久化（推荐 Git 方式）：

- 生成 `src/content/daily/`、`src/content/weekly/` 后，容器会自动 `git commit` 并 `git push` 回仓库。
- 需要设置 `GH_TOKEN`：一个能写仓库的 GitHub Personal Access Token（classic 选 `repo` scope）。
- 可选设置 `GIT_USER_NAME`、`GIT_USER_EMAIL`（默认分别为 `Tech Daily Bot`、`bot@techdaily.local`）。
- 可选设置 `GIT_BRANCH` 指定推送分支；默认取当前分支，处于 detached HEAD（如 Zeabur 按提交检出）时自动回退到远端默认分支。
- 如不想自动推送，设置 `AUTO_PUBLISH=false`。

这样重新部署时，已生成的日报会随仓库代码一起进入镜像，不再依赖平台持久卷。

容器启动后每 15 分钟检查一次；北京时间达到 `SCHEDULER_MIN_HOUR`（默认 9 点）后才会生成**前一自然日**日报。打开 `/api/scheduler-status` 可查看是否因缺密钥或未到点而暂停。

## 宿主机 Git 发布（备选）

1. 确认 `.env` 中模型密钥、初筛模型和综合模型均已配置。
2. 运行 `npm run check && npm test && npm run build`。
3. 确认 `git status` 为空，当前分支已跟踪 GitHub 远端。
4. 在 Zeabur 连接私有仓库，以 `Dockerfile` 部署。
5. 运行一次 `AUTO_PUBLISH=false npm run scheduler:run` 检查本地输出。
6. 删除测试输出或正式提交后，执行 `npm run scheduler:install`。

## 正常运行

- 09:00：处理前一北京时间自然日。
- 周一 10:00：处理上一周一至周日。
- 每次失败静默重试三次；最终失败只写入 `.data/runs.jsonl`。
- 下次成功启动根据 `.data/ledger.json` 逐日回填。
- 来源数量超过其近期平均值五倍且至少超过 50 条时，该次运行隔离该来源。

## 安全发布

### 宿主机运行 `scheduler:run`

调度开始前要求工作区为空，并执行 fast-forward-only 拉取。生成后仅允许 `src/content/daily/` 和 `src/content/weekly/` 发生变化。远端分支若在生成期间改变，发布会停止；流程从不强推。

若发布停止：

1. 查看 `.data/runs.jsonl` 与 `.data/launchd.stderr.log`。
2. 手动处理远端更新或本地修改。
3. 保持工作区干净后重新运行 `npm run scheduler:run`。

### 容器模式

容器在站点重建成功后，仅当存在 `GH_TOKEN` 且 `AUTO_PUBLISH !== false` 时，才会把 `src/content/` 的变更提交并推回仓库。推送前会检查工作区，只允许 `src/content/daily/` 和 `src/content/weekly/` 发生变化。

## 模型与来源故障

- 模型失败：确认 API 密钥、余额、模型名称和 `LLM_BASE_URL`。
- GitHub 限额：确认确有瓶颈后再配置 `GITHUB_TOKEN`。
- 受限网页：系统不会绕过登录或付费墙；只基于公开摘要并在条目中标明。
- 异常来源：检查来源响应，确认恢复正常后再次运行；新的正常采样会恢复其基线。

## 内容更正

不要编辑已发布历史 Markdown。新增 `corrections` 条目，设置稳定的 `correctsItemId`、更正原因和关键来源。构建会拒绝缺失目标、重复 ID 和循环更正。

## 缓存与恢复

周报成功写入后，系统删除该周 `.cache/*-collected.json`。`.data/` 中的候选池、去重和持续主题状态继续保留。

使用 Git 持久化时，日报/周报 Markdown 会随仓库保留，重新部署后内容自然恢复。但 `.data/ledger.json`、`.data/stories.json`、`.data/candidates.json`、`.data/source-volumes.json` 仍在容器本地；若希望回填、去重和主题追踪状态在重新部署后不变，需要把这些文件也纳入持久化（如挂载卷或定期备份）。

如使用本地 Docker 卷，恢复新机器时至少复制上述四个 `.data` 文件，否则系统会把前一日视为首次运行起点。

## 停止与卸载

```sh
npm run scheduler:install -- --uninstall
```

卸载只移除 LaunchAgent，不删除已发布内容、本地缓存或运行状态。
