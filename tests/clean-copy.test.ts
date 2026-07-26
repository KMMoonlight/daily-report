import { describe, expect, it } from "vitest";
import { composeItemBody, withoutPopularityFiller } from "../src/presentation/clean-copy";

describe("withoutPopularityFiller", () => {
  it("removes Hacker News upvote and score phrasing", () => {
    expect(
      withoutPopularityFiller(
        "这款产品面向无障碍场景，在 Hacker News 获得 178 个赞。对开发者有启发。",
      ),
    ).toBe("这款产品面向无障碍场景。对开发者有启发。");

    expect(
      withoutPopularityFiller("相关讨论在 Hacker News 上获得 362 分，说明原生能力仍有空间。"),
    ).toBe("说明原生能力仍有空间。");

    expect(withoutPopularityFiller("社区帖子热度很高（366 分），模型表现值得关注。")).toBe(
      "模型表现值得关注。",
    );

    expect(
      withoutPopularityFiller("该文在Hacker News获得202个赞同。对于开发者很有参考价值。"),
    ).toBe("对于开发者很有参考价值。");

    expect(withoutPopularityFiller("晶体管动画工具获Hacker News 184分关注")).toBe("晶体管动画工具");
  });

  it("removes community-hot-post attribution without scores", () => {
    expect(
      withoutPopularityFiller(
        "根据 Hacker News 社区的一篇热门帖子，Opus 5 目前在排行榜上位居第一。",
      ),
    ).toBe("Opus 5 目前在排行榜上位居第一。");
  });
});

describe("composeItemBody", () => {
  it("merges summary and analysis into one body", () => {
    expect(
      composeItemBody(
        "一篇技术社区文章探讨了在代码生成成本大幅下降的背景下，工程管理实践正在如何演变。",
        "如果代码创建成本趋近于零，开发者需重新思考自身角色。",
      ),
    ).toBe(
      "一篇技术社区文章探讨了在代码生成成本大幅下降的背景下，工程管理实践正在如何演变。如果代码创建成本趋近于零，开发者需重新思考自身角色。",
    );
  });

  it("drops hollow naming shells left after score scrubbing and keeps analysis", () => {
    expect(
      composeItemBody(
        "一篇题为“Postgres LISTEN/NOTIFY actually scales”的文章在 Hacker News 上获得 362 分，引发社区对 PostgreSQL 内置异步通知机制扩展能力的讨论。",
        "高关注度反映出开发者对用数据库原生功能替代轻量消息队列、简化架构的兴趣。若该机制确能有效扩展，将降低实时通信的引入成本和运维复杂度。",
      ),
    ).toBe(
      "若该机制确能有效扩展，将降低实时通信的引入成本和运维复杂度。",
    );

    expect(
      composeItemBody(
        "一款名为 MouthPad 的舌头控制触控板在 Hacker News 获得 178 个赞，引起社区关注。",
        "该设备展示了新型交互方式，对开发者而言，可能为无障碍应用和新型用户界面设计提供参考。",
      ),
    ).toBe(
      "该设备展示了新型交互方式，对开发者而言，可能为无障碍应用和新型用户界面设计提供参考。",
    );
  });

  it("keeps useful summary substance after removing popularity filler", () => {
    expect(
      composeItemBody(
        "一篇名为《The Fedora 45 Sausage Factory》的文章在 Hacker News 上获得 146 个点赞，揭示了 Fedora 45 的开发过程与内部机制。",
        "对开发者而言，了解发行版的构建流程有助于优化系统配置。",
      ),
    ).toBe(
      "文章揭示了 Fedora 45 的开发过程与内部机制。对开发者而言，了解发行版的构建流程有助于优化系统配置。",
    );
  });
});
