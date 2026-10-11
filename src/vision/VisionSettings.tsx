import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  Monitor,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  clearVisionConfig,
  getVisionConfig,
  isLocalVisionPage,
  saveVisionConfig,
  serviceOrigin,
  testVisionConfig,
  VisionClientError,
  type VisionConfig,
  type VisionTestResult,
} from "./client";
import "./vision-settings.css";

type Operation = "loading" | "saving" | "clearing" | "testing";
type Notice = "saved" | "cleared" | "cancelled" | null;

export default function VisionSettings({
  language,
}: {
  language: "zh" | "en";
}) {
  const t = (zh: string, en: string) => (language === "zh" ? zh : en);
  const local = isLocalVisionPage();
  const [saved, setSaved] = useState<VisionConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keyEntered, setKeyEntered] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<VisionClientError | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [result, setResult] = useState<VisionTestResult | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const resultPanel = useRef<HTMLElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const busy = operation !== null;
  const origin = serviceOrigin(baseUrl);
  const changedOrigin = Boolean(
    saved?.baseUrl && origin !== serviceOrigin(saved.baseUrl),
  );
  const dirty = Boolean(
    saved &&
    (baseUrl.trim() !== saved.baseUrl ||
      model.trim() !== saved.model ||
      keyEntered),
  );
  const configured = Boolean(saved?.baseUrl && saved.model);

  const clearKeyInput = () => {
    if (keyInput.current) keyInput.current.value = "";
    setKeyEntered(false);
  };
  const acceptConfig = (config: VisionConfig) => {
    setSaved(config);
    setBaseUrl(config.baseUrl);
    setModel(config.model);
    clearKeyInput();
  };

  async function perform<T>(
    next: Operation,
    action: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void,
  ) {
    if (!local || pending.current || !mounted.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setOperation(next);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const value = await action(controller.signal);
      if (mounted.current && !controller.signal.aborted) accept(value);
    } catch (problem) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          problem instanceof VisionClientError
            ? problem
            : new VisionClientError("network"),
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (mounted.current) setOperation(null);
      }
    }
  }

  const load = () => perform("loading", getVisionConfig, acceptConfig);
  useEffect(() => {
    mounted.current = true;
    const keyField = keyInput.current;
    if (local) void load();
    return () => {
      mounted.current = false;
      pending.current?.abort();
      pending.current = null;
      if (keyField) keyField.value = "";
    };
    // Configuration is fetched only while this settings panel is mounted.
    // Language changes do not initiate new requests or discard the form.
  }, [local]);

  useEffect(() => {
    if (result) resultPanel.current?.scrollIntoView({ block: "nearest" });
    if (error) errorPanel.current?.scrollIntoView({ block: "nearest" });
  }, [result, error]);

  const changeBaseUrl = (value: string) => {
    if (serviceOrigin(value) !== serviceOrigin(baseUrl)) clearKeyInput();
    setBaseUrl(value);
    setNotice(null);
    setResult(null);
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saved || !origin || !model.trim() || !dirty || busy) return;
    const key = keyInput.current?.value.trim();
    const config = {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(key ? { apiKey: key } : {}),
    };
    void perform(
      "saving",
      (signal) => saveVisionConfig(config, signal),
      (value) => {
        acceptConfig(value);
        setNotice("saved");
      },
    );
  };
  const clear = () => {
    clearKeyInput();
    void perform("clearing", clearVisionConfig, (value) => {
      acceptConfig(value);
      setNotice("cleared");
    });
  };
  const test = () => {
    if (!saved || !configured || dirty || busy) return;
    void perform(
      "testing",
      (signal) => testVisionConfig(saved.revision, signal),
      setResult,
    );
  };
  const errorMessage = !error
    ? ""
    : error.kind === "service"
      ? error.message
      : error.kind === "invalid-response"
        ? t(
            "本机服务未返回有效响应。请确认使用 npm run local 启动，并重试。",
            "The local service did not return a valid response. Start it with npm run local and retry.",
          )
        : t(
            "无法连接本机服务。请检查本机服务是否正在运行，再重试。",
            "Could not reach the local service. Check that it is running, then retry.",
          );

  return (
    <div className="vision-settings">
      <header className="vision-heading">
        <span className="vision-heading-icon">
          <FlaskConical size={23} aria-hidden="true" />
        </span>
        <div>
          <span className="vision-eyebrow">
            VISION API · {t("可选连接", "OPTIONAL CONNECTION")}
          </span>
          <h2 id="modal-title">{t("视觉 API 设置", "Vision API settings")}</h2>
        </div>
      </header>
      <p className="vision-intro">
        {t(
          "先连接你选择的服务，再用内置合成图检查接口。当前不支持真实图像批量分析或科研定量。",
          "Connect your chosen service, then check the interface with a built-in synthetic image. Real-image batch analysis and scientific quantification are not supported.",
        )}
      </p>

      {!local ? (
        <section
          className="vision-local-only"
          aria-labelledby="vision-local-title"
        >
          <Monitor size={25} aria-hidden="true" />
          <h3 id="vision-local-title">
            {t("在本机运行后配置", "Configure from your own machine")}
          </h3>
          <p>
            {t(
              "这个在线演示没有云端 API 服务，也不会在此读取或提交配置。请在项目目录运行以下命令，再打开终端显示的本机地址。",
              "This hosted demo has no cloud API service and does not read or submit configuration here. Run these commands in the project directory, then open the local address printed in the terminal.",
            )}
          </p>
          <pre>
            <code>{"npm ci\nnpm run local"}</code>
          </pre>
          <p>
            {t(
              "密钥由本机服务保存在内存中，不会嵌入网页构建或项目包。",
              "The local service keeps the key in memory; it is not embedded in the web build or project archive.",
            )}
          </p>
        </section>
      ) : (
        <>
          <div className="vision-boundary">
            <ShieldCheck size={18} aria-hidden="true" />
            <p>
              {t(
                "仅在点击测试后发送服务器内置的 6 泳道合成 PNG；不发送当前项目、图像、样本名或泳道数据。指定服务会收到测试图及提示词，可能按用量计费。",
                "Only clicking the test button sends the server's built-in six-lane synthetic PNG. No current project, images, sample names, or lane data are sent. Your chosen service receives the test image and prompt and may charge for usage.",
              )}
            </p>
          </div>

          <form onSubmit={save} autoComplete="off" className="vision-form">
            <div className="vision-section-title">
              <h3>
                <span>01</span>
                {t("连接服务", "Connect a service")}
              </h3>
              <span className="vision-protocol">Chat Completions</span>
            </div>
            <fieldset disabled={busy || !saved}>
              <label htmlFor="vision-base-url">Base URL</label>
              <input
                id="vision-base-url"
                type="url"
                required
                value={baseUrl}
                onChange={(event) => changeBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                autoCapitalize="none"
                maxLength={2048}
                aria-describedby="vision-url-help"
              />
              <p id="vision-url-help" className="vision-help">
                {t(
                  "填写服务提供的 API 基础地址，不含密钥、查询参数或 /chat/completions。",
                  "Use your provider's API base address, without a key, query parameters, or /chat/completions.",
                )}
              </p>
              <label htmlFor="vision-model">{t("模型 ID", "Model ID")}</label>
              <input
                id="vision-model"
                required
                value={model}
                maxLength={200}
                onChange={(event) => {
                  setModel(event.target.value);
                  setNotice(null);
                  setResult(null);
                }}
                placeholder={t(
                  "填写支持图像输入的模型 ID",
                  "Enter a model ID with image support",
                )}
                autoCapitalize="none"
                spellCheck={false}
              />
              <label htmlFor="vision-api-key">
                <KeyRound size={13} aria-hidden="true" />
                API Key
              </label>
              <input
                id="vision-api-key"
                ref={keyInput}
                type="password"
                autoComplete="new-password"
                maxLength={4096}
                onChange={(event) => {
                  setKeyEntered(event.target.value.length > 0);
                  setNotice(null);
                  setResult(null);
                }}
                placeholder={
                  saved?.keyConfigured && !changedOrigin
                    ? t("已保存；留空可保留", "Key saved; leave blank to keep")
                    : t("输入服务密钥", "Enter the service key")
                }
                aria-describedby="vision-key-help"
                spellCheck={false}
                autoCapitalize="none"
              />
              <p id="vision-key-help" className="vision-help">
                {changedOrigin
                  ? t(
                      "服务来源已改变；原密钥不会沿用，请为新服务填写密钥。",
                      "The service origin changed. The old key will not be reused; enter a key for the new service.",
                    )
                  : t(
                      "同一服务留空会保留已存密钥。密钥不回显，不写入浏览器存储或项目导出；保存后清空输入框。",
                      "Leave blank to retain the key for the same service. Keys are never returned, stored in browser storage, or included in project exports. The input clears after saving.",
                    )}
              </p>
            </fieldset>
            <div className="vision-form-actions">
              <button
                className="button vision-clear"
                type="button"
                onClick={clear}
                disabled={
                  busy ||
                  !saved ||
                  (!configured && !dirty && !saved.keyConfigured)
                }
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("清除配置与密钥", "Clear configuration & key")}
              </button>
              <button
                className="button"
                type="submit"
                disabled={busy || !saved || !dirty || !origin || !model.trim()}
              >
                {operation === "saving" ? (
                  <LoaderCircle
                    size={14}
                    className="vision-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Save size={14} aria-hidden="true" />
                )}
                {t("保存到本机服务", "Save to local service")}
              </button>
            </div>
          </form>

          <section
            className="vision-test-section"
            aria-labelledby="vision-test-title"
          >
            <div className="vision-section-title">
              <h3 id="vision-test-title">
                <span>02</span>
                {t("检查合成图响应", "Check a synthetic response")}
              </h3>
            </div>
            <dl className="vision-destination">
              <div>
                <dt>{t("目的服务", "Destination")}</dt>
                <dd>{saved?.baseUrl || t("尚未保存", "Not saved yet")}</dd>
              </div>
              <div>
                <dt>{t("模型", "Model")}</dt>
                <dd>{saved?.model || "—"}</dd>
              </div>
              <div>
                <dt>{t("本机密钥", "Local key")}</dt>
                <dd>
                  {saved?.keyConfigured
                    ? t("已保存在服务内存中", "Present in service memory")
                    : t("未配置", "Not configured")}
                </dd>
              </div>
            </dl>
            <p className="vision-help">
              {t(
                "配置只保存在本机服务内存中，重启服务后需要重新填写。保存配置不会请求模型。",
                "Configuration lives only in local service memory and must be entered again after a restart. Saving does not call the model.",
              )}
            </p>
            {dirty && (
              <p className="vision-unsaved">
                {t(
                  "有未保存的修改。先保存配置，再发送测试图。",
                  "You have unsaved changes. Save before sending the test image.",
                )}
              </p>
            )}
            <div className="vision-test-actions">
              <button
                className="button primary"
                type="button"
                onClick={test}
                disabled={busy || !configured || dirty}
              >
                {operation === "testing" ? (
                  <LoaderCircle
                    size={15}
                    className="vision-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowUpRight size={15} aria-hidden="true" />
                )}
                {operation === "testing"
                  ? t("正在等待服务响应…", "Waiting for the service…")
                  : t("发送合成图并测试", "Send synthetic image & test")}
              </button>
              {operation === "testing" && (
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    pending.current?.abort();
                    setNotice("cancelled");
                  }}
                >
                  {t("取消测试", "Cancel test")}
                </button>
              )}
            </div>
          </section>

          {operation === "loading" && (
            <p className="vision-status" role="status">
              <LoaderCircle
                className="vision-spin"
                size={15}
                aria-hidden="true"
              />
              {t("正在读取本机配置…", "Reading local configuration…")}
            </p>
          )}
          {operation === "clearing" && (
            <p className="vision-status" role="status">
              {t("正在清除配置…", "Clearing configuration…")}
            </p>
          )}
          {notice && (
            <p className="vision-status" role="status">
              <Check size={15} aria-hidden="true" />
              {notice === "saved"
                ? t(
                    "配置已保存在本机服务中。尚未发送测试图。",
                    "Configuration saved in the local service. No test image has been sent.",
                  )
                : notice === "cleared"
                  ? t(
                      "本机配置与密钥已清除。",
                      "Local configuration and key cleared.",
                    )
                  : t(
                      "本机等待已取消。已发送的请求可能仍由服务处理。",
                      "Local waiting was cancelled. The service may still process a request already sent.",
                    )}
            </p>
          )}
          {error && (
            <div className="vision-error" role="alert" ref={errorPanel}>
              <TriangleAlert size={17} aria-hidden="true" />
              <div>
                <p>{errorMessage}</p>
                {error.code && <small>{error.code}</small>}
                {(!saved || error.code === "CONFIG_CHANGED") && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    {t("重新读取配置", "Retry loading configuration")}
                  </button>
                )}
              </div>
            </div>
          )}
          {result && (
            <section
              ref={resultPanel}
              className={`vision-result ${result.matchesExpectedCount ? "matched" : "mismatched"}`}
              role="status"
              aria-labelledby="vision-result-title"
            >
              <h3 id="vision-result-title">
                {t("接口返回了合法候选", "The API returned valid candidates")}
              </h3>
              <div className="vision-result-count">
                <strong>{result.bandCount}</strong>
                <span>
                  {t("个候选条带 / 预期 6 个", "candidate bands / 6 expected")}
                </span>
              </div>
              <p>
                {result.matchesExpectedCount
                  ? t(
                      "数量与合成图预期一致。",
                      "The count matches the synthetic expectation.",
                    )
                  : t(
                      "数量与合成图预期不一致，请检查模型和接口行为。",
                      "The count differs from the synthetic expectation. Check the model and API behavior.",
                    )}
              </p>
              <p className="vision-result-limit">
                {t(
                  "数量为 6 不代表定位正确或科研定量准确；这是接口测试，不是算法验证。",
                  "A count of 6 does not establish correct localization or scientific accuracy. This is an interface check, not algorithm validation.",
                )}
              </p>
              <div className="vision-result-meta">
                <span>{result.promptVersion}</span>
                <span>{Math.round(result.elapsedMs)} ms</span>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
