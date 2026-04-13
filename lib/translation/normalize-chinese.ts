// @ts-expect-error opencc-js does not ship TypeScript declarations.
import { Converter } from "opencc-js";

const traditionalToSimplifiedConverter = Converter({
  from: "t",
  to: "cn",
});

export function normalizeToSimplifiedChinese(text: string) {
  return traditionalToSimplifiedConverter(text);
}
