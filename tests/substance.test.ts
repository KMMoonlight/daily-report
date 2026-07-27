import { describe, expect, it } from "vitest";
import { isHollowReportCopy, isHollowTrendingCandidate } from "../src/presentation/substance";

describe("substance filters", () => {
  it("rejects empty GitHub repo announcements", () => {
    expect(
      isHollowReportCopy(
        "pingdotgg 发布 TypeScript 项目 t3code",
        "pingdotgg 在 GitHub 公开了 t3code 仓库，该项目采用 TypeScript 开发。该仓库的开放为 TypeScript 开发者提供了新的代码参考，其设计思路可能通过源码体现，有助于理解相应的工程实践。",
        "",
      ),
    ).toBe(true);
  });

  it("keeps concrete product updates", () => {
    expect(
      isHollowReportCopy(
        "Claude Opus 5 正式发布",
        "Anthropic 发布 Claude Opus 5，编程与推理能力提升，输入 token 价格为每百万 5 美元。",
        "对依赖 Claude API 的开发工具有直接成本与能力影响。",
      ),
    ).toBe(false);
  });

  it("skips trending rows without a real description", () => {
    expect(
      isHollowTrendingCandidate({
        sourceId: "github-trending",
        title: "pingdotgg/t3code",
        excerpt: "Language: TypeScript · Stars gained: 800",
      }),
    ).toBe(true);

    expect(
      isHollowTrendingCandidate({
        sourceId: "github-trending",
        title: "pingdotgg/t3code: Local-first coding agents for TypeScript apps",
        excerpt: "Local-first coding agents for TypeScript apps · Language: TypeScript · Stars gained: 800",
      }),
    ).toBe(false);
  });
});
