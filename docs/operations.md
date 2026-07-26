# 生产运行手册

## Docker 一键运行（推荐）

```bash
docker compose up -d --build
```

Docker 容器同时提供网站、日报/周报调度和静态站重建。以下目录必须使用持久卷：

- `/app/src/content`
- `/app/.data`
- `/app/.cache`

查看日志与停止服务：

```bash
docker compose logs -f
docker compose down
```

Zeabur 直接使用仓库 `Dockerfile`，监听 8080 端口；在服务设置中配置模型环境变量和上述三个持久卷。

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

调度开始前要求工作区为空，并执行 fast-forward-only 拉取。生成后仅允许 `src/content/daily/` 和 `src/content/weekly/` 发生变化。远端分支若在生成期间改变，发布会停止；流程从不强推。

若发布停止：

1. 查看 `.data/runs.jsonl` 与 `.data/launchd.stderr.log`。
2. 手动处理远端更新或本地修改。
3. 保持工作区干净后重新运行 `npm run scheduler:run`。

## 模型与来源故障

- 模型失败：确认 API 密钥、余额、模型名称和 `LLM_BASE_URL`。
- GitHub 限额：确认确有瓶颈后再配置 `GITHUB_TOKEN`。
- 受限网页：系统不会绕过登录或付费墙；只基于公开摘要并在条目中标明。
- 异常来源：检查来源响应，确认恢复正常后再次运行；新的正常采样会恢复其基线。

## 内容更正

不要编辑已发布历史 Markdown。新增 `corrections` 条目，设置稳定的 `correctsItemId`、更正原因和关键来源。构建会拒绝缺失目标、重复 ID 和循环更正。

## 缓存与恢复

周报成功写入后，系统删除该周 `.cache/*-collected.json`。`.data/` 中的候选池、去重和持续主题状态继续保留。恢复新机器时，至少复制 `.data/ledger.json`、`stories.json`、`candidates.json` 和 `source-volumes.json`，否则系统会把前一日视为首次运行起点。

## 停止与卸载

```sh
npm run scheduler:install -- --uninstall
```

卸载只移除 LaunchAgent，不删除已发布内容、本地缓存或运行状态。
