import { useLanguage } from "./i18n";

export default function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <button
      type="button"
      className="suite-language-switch"
      aria-label={t("切换到英文", "Switch to Chinese")}
      onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
    >
      {language === "zh" ? "EN" : "中文"}
    </button>
  );
}
