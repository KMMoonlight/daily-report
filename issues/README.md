# Tech Daily & Weekly — Implementation Issues

这些 Issue 按纵向切片组织。每个切片都应交付一条可独立演示或验证的端到端能力。

## Issues

1. [上线首个可浏览的日报网站](./001-first-browsable-daily-site.md)
2. [从 RSS 自动生成一条可发布日报内容](./002-rss-to-published-daily-item.md)
3. [生成五类日报栏目与专业化展示](./003-five-daily-sections.md)
4. [合并信息簇并追踪持续主题](./004-clusters-and-developing-stories.md)
5. [执行候选池、核验与部分发布质量门](./005-quality-gates.md)
6. [接入 GitHub、论文与技术社区来源](./006-add-source-adapters.md)
7. [自动执行每日采集、回填与 Git 发布](./007-scheduled-daily-publishing.md)
8. [生成并发布每周综合报告](./008-weekly-report.md)
9. [发布不可变历史的更正条目](./009-correction-entries.md)
10. [完成生产运行验收与故障恢复](./010-production-readiness.md)

## Dependency order

- 001 → 002
- 002 → 003、004、006
- 003 + 004 → 005
- 005 + 006 → 007、008
- 004 + 007 → 009
- 007 + 008 + 009 → 010
