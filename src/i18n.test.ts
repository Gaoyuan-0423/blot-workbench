import { describe, expect, it } from "vitest";
import {
  initialLanguage,
  languageUrl,
  setLanguage,
  translate,
  translateMessage,
  formatMessage,
} from "./i18n";

describe("shared interface language", () => {
  it("gives a valid URL choice priority over storage and rejects unsupported values", () => {
    expect(initialLanguage("https://wb.wisplab.top/?lang=en", "zh")).toBe("en");
    expect(initialLanguage("https://wb.wisplab.top/?lang=zh", "en")).toBe("zh");
    expect(initialLanguage("https://wb.wisplab.top/?lang=fr", "en")).toBe("en");
    expect(initialLanguage("https://wb.wisplab.top/", "invalid")).toBe("zh");
  });
  it("carries the language without dropping workflow queries, hashes or Pages paths", () => {
    expect(
      languageUrl(
        "?mode=single#sampling",
        "en",
        "https://gaoyuan-0423.github.io/blot-workbench/",
      ),
    ).toBe(
      "https://gaoyuan-0423.github.io/blot-workbench/?mode=single&lang=en#sampling",
    );
    expect(
      languageUrl("#real", "zh", "https://wb.wisplab.top/?lang=en&keep=1"),
    ).toBe("https://wb.wisplab.top/?lang=zh&keep=1#real");
    expect(languageUrl("https://pathology.wisplab.top/?x=1", "en")).toBe(
      "https://pathology.wisplab.top/?x=1&lang=en",
    );
    expect(languageUrl("blob:test", "en", "https://wb.wisplab.top/")).toBe(
      "blob:test",
    );
  });
  it("selects the correct side of both bilingual message orders", () => {
    expect(translateMessage("Invalid archive / 项目包无效", "en")).toBe(
      "Invalid archive",
    );
    expect(translateMessage("项目包无效 / Invalid archive", "zh")).toBe(
      "项目包无效",
    );
  });
  it("retranslates existing notices and parameterized failure details after switching", () => {
    const notice = translate("已完成一次操作", "Completed an operation", "zh");
    expect(translateMessage(notice, "en")).toBe("Completed an operation");
    expect(
      translateMessage("泳道 2：缺少有效背景，无法计算净信号。", "en"),
    ).toBe("Lane 2: No valid background; net signal cannot be calculated.");
    expect(
      translateMessage(
        "导入失败：请选择有效的 8-bit PNG 或 JPEG 图片。 仍显示上一张图片。",
        "en",
      ),
    ).toBe(
      "Import failed: Choose a valid 8-bit PNG or JPEG image. The previous image is still displayed.",
    );
    expect(
      translateMessage(
        "此简易模式仅支持 8-bit PNG；当前为 16-bit。请使用 8-bit 副本，保留高位深原图。",
        "en",
      ),
    ).toContain("this image is 16-bit");
  });
  it("leaves user-supplied parameters and scientific numbers unchanged", () => {
    setLanguage("en");
    expect(formatMessage("{0}-结果.csv", "我的样本 α/β")).toBe(
      "我的样本 α/β-results.csv",
    );
    expect(formatMessage("泳道 {0}", 6)).toBe("Lane 6");
    setLanguage("zh");
  });
});
