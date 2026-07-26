/** Strip community popularity metrics so copy reads curated, not scraped. */
export function withoutPopularityFiller(value: string) {
  return tidyProse(
    value
      .replace(
        /获?\s*(?:Hacker News|Reddit|\bHN\b)\s*\d+\s*(?:分|赞|点赞|赞同|点|积分)(?:\s*关注)?/giu,
        "",
      )
      .replace(
        /[，,；;]?\s*(?:相关)?(?:帖子|讨论|文章|该文|该帖|该报告)?\s*(?:经[^，,]{0,16}转载并)?\s*(?:在\s*)?(?:Hacker News|Reddit|\bHN\b)\s*(?:上|社区)?\s*(?:获得|拿到|收获|获)?\s*\d+\s*(?:个)?(?:赞同|点赞|赞|分|点|积分|votes|upvotes?)(?:\s*关注)?/giu,
        "",
      )
      .replace(
        /(?:在\s*)?(?:Hacker News|Reddit|\bHN\b)\s*(?:上|社区)?\s*(?:获得|拿到|收获|获)?\s*\d+\s*(?:个)?(?:赞同|点赞|赞|分|点|积分|votes|upvotes?)(?:\s*关注)?/giu,
        "",
      )
      .replace(/该帖子获得\d+\s*(?:个)?(?:积分|赞|点赞|赞同|分)/giu, "")
      .replace(/\b\d+\s*(?:points?|upvotes?)\s+on\s+(?:Hacker News|Reddit|HN)\b[.!]?/giu, "")
      .replace(/[（(]\s*\d+\s*(?:分|赞|点赞|赞同|votes|upvotes?|points?)\s*[）)]/giu, "")
      .replace(/[，,；;]?\s*(?:根据|据)?\s*(?:Hacker News|Reddit|\bHN\b)\s*社区的一篇热门帖子[，,]?/giu, "")
      .replace(/[，,；;]?\s*社区(?:帖子|讨论)?热度(?:很高|较高|高)/giu, "")
      .replace(/[，,；;]?\s*引起社区关注/giu, "")
      .replace(/[，,；;]?\s*引发社区(?:讨论|对[^。！？\n]{0,40})/giu, "")
      .replace(/^高关注度[^。！？]*[。！？]/giu, "")
      .replace(/高关注度反映出/giu, "这体现了")
      .replace(
        /[，,；;]?\s*(?:据|根据)[^。！？]*(?:博客|官方|媒体|报道|声明)[^。！？]*[，,]?/giu,
        "",
      )
      .replace(
        /[。！？]?\s*(?:但)?需注意[^。！？]*(?:官方声明|有待|待验证|验证)[^。！？]*[。！？]?/giu,
        "",
      ),
  );
}

/** Drop leftover naming shells after popularity scrubbing, then merge into one body. */
export function composeItemBody(summary: string, analysis: string) {
  const cleanedSummary = dropHollowFraming(withoutPopularityFiller(summary));
  const cleanedAnalysis = dropHollowFraming(withoutPopularityFiller(analysis));

  if (!cleanedSummary) return cleanedAnalysis;
  if (!cleanedAnalysis) return cleanedSummary;
  if (cleanedAnalysis.includes(cleanedSummary)) return cleanedAnalysis;
  if (cleanedSummary.includes(cleanedAnalysis)) return cleanedSummary;

  return joinProse(cleanedSummary, cleanedAnalysis);
}

function dropHollowFraming(value: string) {
  let text = tidyProse(value);

  text = tidyProse(
    text
      // "一篇题为“X”的。" / "一款名为 X 的。"
      .replace(/^一[篇款个项](?:技术社区|技术)?(?:文章)?(?:名为|题为|叫做)\s*[《「“"']?[^》」”"']+[》」”"']?\s*的[。！？]?$/u, "")
      // "一篇名为《X》的，揭示了…" → "揭示了…"
      .replace(/^一[篇款个项](?:技术社区|技术)?(?:文章)?(?:名为|题为|叫做)\s*[《「“"'][^》」”"']+[》」”"']\s*的[，,]\s*/u, "")
      // "一位开发者在 Hacker News 上展示了…" → keep substance after platform cue if needed
      .replace(/[，,；;]?\s*在\s*(?:Hacker News|Reddit|\bHN\b)\s*上/giu, ""),
  );

  // If only a naming clause remains before a useful clause, drop the naming head.
  text = tidyProse(
    text.replace(
      /^一[篇款个项](?:名为|题为|叫做)[^。！？]{0,80}的[，,]?(?=揭示|探讨|介绍|说明|展示|指出)/u,
      "",
    ),
  );

  if (/^(?:揭示|探讨|介绍|说明|展示|指出)/u.test(text)) {
    text = `文章${text}`;
  }

  if (isHollowNamingSentence(text)) return "";
  return text;
}
function isHollowNamingSentence(value: string) {
  if (!value) return true;
  if (/^一[篇款个项](?:技术社区|技术)?(?:文章)?(?:名为|题为|叫做).{0,80}的[。！？]?$/u.test(value)) {
    return true;
  }
  // e.g. "一款名为 MouthPad 的舌头控制触控板。" — title already carries this.
  if (
    value.length <= 40 &&
    /^一[篇款个项](?:名为|题为|叫做).+的.+[。！？]?$/u.test(value)
  ) {
    return true;
  }
  return false;
}

function joinProse(left: string, right: string) {
  const start = /[。！？]$/u.test(left) ? left : `${left}。`;
  return tidyProse(`${start}${right}`);
}

function tidyProse(value: string) {
  return value
    .replace(/^[，,；;。！？\s]+/gu, "")
    .replace(/[，,；;]\s*(?=[。！？]|$)/gu, "")
    .replace(/([。！？]){2,}/gu, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([。！？，,；;])/gu, "$1")
    .trim();
}
