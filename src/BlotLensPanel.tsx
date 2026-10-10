import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, ExternalLink } from 'lucide-react';

/** Keep this component mounted across navigation so its independent analysis survives. */
export function BlotLensPanel({ active, english }: { active: boolean; english: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = import.meta.env.DEV ? './reviewer/index.html' : './blotlens/index.html';
  const text = (zh: string, en: string) => english ? en : zh;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.version !== 1) return;
      if (event.data.type === 'blotlens:ready') setReady(true);
      if (event.data.type === 'blotlens:state' && typeof event.data.hasAnalysis === 'boolean') setHasAnalysis(event.data.hasAnalysis);
      if (event.data.type === 'blotlens:import-result' && event.data.requestId === pending.current) {
        pending.current = null;
        if (timer.current) clearTimeout(timer.current);
        setStatus(event.data.ok ? '截图已载入，请在下方识别或手工取样。 / Image loaded.' : '导入失败，请查看下方提示。 / Import failed.');
      }
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (!hasAnalysis) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [hasAnalysis]);
  const sendImage = async (file: File) => {
    if (!ready || !frame.current?.contentWindow) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size === 0 || file.size > 15 * 1024 * 1024) {
      setStatus('请选择不超过 15 MB 的 PNG/JPEG 截图。 / Choose a PNG/JPEG up to 15 MB.'); return;
    }
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    if (timer.current) clearTimeout(timer.current);
    setStatus('正在载入截图… / Loading image…');
    try {
      const bytes = await file.arrayBuffer();
      if (pending.current !== requestId) return;
      frame.current?.contentWindow?.postMessage({ type: 'blotlens:import-image', version: 1, requestId, name: file.name, mimeType: file.type, bytes }, window.location.origin, [bytes]);
      timer.current = setTimeout(() => { if (pending.current === requestId) { pending.current = null; setStatus('模块未响应，可在下方直接导入截图。 / Import directly in the module below.'); } }, 20000);
    } catch { pending.current = null; setStatus('读取图片失败。 / Could not read image.'); }
  };
  return <section hidden={!active} className="blotlens-workflow" aria-label={text('截图趋势核对流程', 'Screenshot review workflow')}>
    <div className="blotlens-workflow-heading">
      <div><h1>{text('截图趋势核对', 'Screenshot trend review')} <small>BlotLens</small></h1>
        <p>{text('导入截图 → 识别或手工取样 → 核对趋势 → 导出分析。切换工作台页面会保留当前分析。', 'Import → recognize or select ROIs → review trends → export. Navigation preserves your analysis.')}</p></div>
      <div className="blotlens-workflow-actions">
        <button className="button primary" disabled={!ready} onClick={() => input.current?.click()}><ArrowUpFromLine size={16} />{text('导入核对截图', 'Import screenshot')}</button>
        <a className="button" href={source} target="_blank" rel="noreferrer"><ExternalLink size={15} />{text('独立打开', 'Open separately')}</a>
      </div>
    </div>
    <p className="blotlens-workflow-note">{text('截图分析通过下方的 JSON 单独保存，不包含在工作台实验项目包内。刷新或关闭前请导出。AI 识别会将图片发送到你配置的服务；静态演示支持手工分析，AI 需本机服务。', 'Export screenshot analyses separately as JSON below; the experiment project archive does not contain them. Export before refreshing. AI sends the image to your configured provider and requires the local service; static demos support manual analysis.')}</p>
    <input ref={input} type="file" accept="image/png,image/jpeg" className="visually-hidden" aria-label="导入工作台核对截图" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void sendImage(file); }} />
    {status && <p role="status" className="blotlens-import-status">{status}</p>}
    <iframe ref={frame} src={source} title="BlotLens 截图趋势核对" className="blotlens-frame" />
  </section>;
}
