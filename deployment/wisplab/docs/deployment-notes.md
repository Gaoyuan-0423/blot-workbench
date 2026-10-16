# WispLab 静态站部署要点

目标：`wisplab.top` 及 `wb`、`pathology`、`pcr` 子域 → `47.77.190.52`（Ubuntu 24.04）。2026-10-16 只读核对本地源码；主代理已确认 **80/443 由现有 Caddy 提供服务，HTTP IP 请求返回 308 跳转 HTTPS**，详细站点和配置归属仍待核对。本文未执行远程操作，以下操作由持有服务器访问的主代理执行。

## 先确认端口归属，再接入站点

- 继续确认现有 Caddy 的配置入口、启动参数、容器/系统服务归属、域名、证书续期方式和磁盘空间；同时核对其他服务及 Docker 端口映射。不要假定服务器为空，也不要把已有服务停掉来腾端口。
- 复用现有 Caddy，在其站点配置中增加这四个明确域名；保留原有站点、默认站点、上游及证书。不要覆盖整个 `Caddyfile`，也不要另装 Nginx 或第二个 Caddy 争抢 80/443。
- 修改前备份将触及的配置，记录现有站点 HTTP/HTTPS 响应。使用与现有服务一致的配置入口执行 `caddy validate`，成功后 reload；切换后复查原有站点。只核对证书路径与有效期，不读取私钥内容。

## 构建与路径：发布完整 dist

三仓库 `vite.config.ts` 都是 `base: './'`，构建产物可分别放在各子域根目录，不需要改成 `/仓库名/`。源码 `index.html` 中的 `/src/main.tsx` 由 Vite 构建替换；不能直接发布源码目录。

| 站点 | 必须保留的产物 / 路径 |
| --- | --- |
| WB | 完整 `dist/`，含 `assets/`、`examples/`；`/?mode=single`、`/?mode=quick`、`/?mode=project` 是查询参数入口。 |
| 病理 | `assets/` 内的模块 Worker，及构建插件复制的 `ort/ort-wasm-simd-threaded.mjs`、`.wasm`、`screenshots/`。不要只同步 HTML/CSS/JS。 |
| PCR | `assets/`、`demo/`；内置示例请求 `./demo/...`，必须与页面同源可读。 |

上线前在**最终构建工作树**检查跨站导航，在新域下应跳转至 `https://wb.wisplab.top/`、`https://pathology.wisplab.top/`、`https://pcr.wisplab.top/`；主代理正在处理 SuiteNav 域名判断，仓库/文档链接可继续指向 GitHub。WB 发布工作树是 `/Users/kururugao/.codex/worktrees/wb-ui-release/WB分析`，检查基线 `291d7c6`；不要使用旧 Downloads 工作树。病理检查基线 `83eb151`，PCR `faf3c46`；最终清单以实际发布提交为准。

三个分析站只需静态服务。不要为它们启动 Vite dev/preview、Node 后端或 PCR 可选本机分析 API，也不需要开放额外业务端口。

## 可回滚的发布布局

1. 使用独立目录，例如 `/srv/wisplab/releases/<版本>/portal|wb|pathology|pcr/`；若该目录已有用途，先核对再选路径。只上传构建产物，不包含 `.git`、`.env`、源码、私钥或实验数据。
2. 版本清单记录三个实际源码 SHA、构建时间与文件校验和。完成上传后核对 HTML 引用的每个资源；服务账号只需读取权限，禁止目录浏览。
3. 各域名 root 指向 `/srv/wisplab/current/<站点>`。记录旧 `readlink` 目标；确认 `current` 不存在或确为发布 symlink 后，在**同一父目录**用临时 symlink + rename 切换，避免逐个覆盖在线文件：

   ```sh
   # 示例占位符须替换；不要覆盖不明用途的 current/current.next。
   ln -s /srv/wisplab/releases/<新版本> /srv/wisplab/current.next
   mv -Tf /srv/wisplab/current.next /srv/wisplab/current
   ```

4. 至少保留上一版。回滚时用同样方法将 `current` 指回旧版本；配置更改也保留可恢复副本。
5. HTML 使用重新验证缓存；带内容 hash 的 `assets/` 可长缓存。**保留旧 release 目录本身不足以支持旧标签页加载旧 hash**：可将上版 hash 资源不覆盖地带入新版 `assets/`，或使用稳定的共享资源目录。`ort/`、`demo/` 等无 hash 文件不要设置永久 immutable。

## DNS、TLS 与浏览器兼容

- 先核对现有记录，再为 `@`、`wb`、`pathology`、`pcr` 配置 A 记录 `47.77.190.52`。仅修改这次部署相关记录；检查同名 AAAA 是否指向可用服务器，保留其他 MX/TXT 等记录。已有 CAA 时确认允许所用证书颁发机构。
- 云防火墙与主机防火墙均需允许 TCP 80/443，保留现有 SSH 与其他服务规则。复用现有 ACME 续期机制；HTTP-01 必须能经 80 到达验证路径。四个明确域名即可申请证书，无需为这次部署额外引入通配符 DNS 验证。
- 保留现有 Caddy 的自动 HTTPS/重定向机制，确认四个域名均成功签发证书后再宣布上线。首次切换不新增覆盖未知子域的 HSTS `includeSubDomains` / preload；HTTPS 也是剪贴板等浏览器能力正常工作的前提。
- 静态资源必须返回正确 MIME：JS/MJS 为 JavaScript、WASM 为 `application/wasm`。不存在的 `/assets/`、`/ort/`、`/demo/` 资源应返回 404，不能伪装成 `index.html` 的 200；当前查询参数入口不依赖 history 路由兜底。
- 不在入口统一套一个更严格 CSP。WB 已有 HTML meta CSP，额外响应头策略会叠加限制。三站需要内联样式及 `data:`/`blob:` 图像和导出；病理还使用模块 Worker、动态导入与 WASM，PCR 可选 AI 会请求用户配置的 HTTPS API。若后续加 CSP，先逐站用 Report-Only 验证这些路径；不要用全局 `connect-src 'self'` 误禁 PCR 可选功能，也不要为此直接开放普通 `unsafe-eval`。本次不擅自加 COOP/COEP。

## 换域名后的本机数据

`https://gaoyuan-0423.github.io` 与新子域是不同 origin，IndexedDB/localStorage **不会随部署、DNS 或重定向迁移**；新站显示空项目不表示旧数据被删除。

| 站点 | 当前可行迁移方式与限制 |
| --- | --- |
| WB | 原项目模式可导出 `.wbproj.zip`，在新域项目模式导入。单排/快速分析未提供完整会话存档，应保留原图、导出 CSV/图表，换域后重新导入图像。 |
| 病理 | 目前没有完整项目备份导入 UI。先导出 Excel/CSV、报告与图像结果，并保留原图及参数记录；新站重载原图、重建 ROI/标定/分组。报告 JSON 不是可自动恢复的项目包。 |
| PCR | “我的课题”目前只有本机保存/打开/重命名/删除，没有完整项目包导入。保留原始仪器文件，导出多表 Excel（含原始数据/QC/项目信息）和必要的 Prism/图表，记录对照、内参、排除与作图设置；新站从原文件重建。AI 配置也不会迁移，不把浏览器密钥搬到服务器。 |

切换初期保留旧 GitHub Pages 站点可访问，供用户完成导出；不要先用强制重定向封住旧 origin 的数据入口。

## 发布后的最小验收

逐域核对证书、靛蓝界面、导航目标与构建版本；检查实际 JS/Worker/WASM/示例资源无 404/MIME/CSP 错误。用内置或合成数据分别跑 WB 单排结果与 CSV、病理图像/Worker 分析及导出、PCR CFX 示例与图表/Prism；检查 390px 无横向页面溢出。同步确认原服务器其他站点仍正常。未加载实际 ONNX 模型时，不将“WASM 文件可下载”写成“ONNX 推理验证通过”。

## deploy.py 的执行约定

脚本只读取已下载的本地 `.tar.gz`，本身不下载、不安装服务、不修改 DNS。打包器的 `release.json` 必须列明四站每个文件的 SHA256 及三仓库完整 Git SHA；部署同时核对压缩包的已知 SHA256。先本地或服务器只校验：

```sh
python3 deploy.py --archive /tmp/wisplab-VERSION.tar.gz --sha256 SHA256 --version VERSION --check-only
```

远端正式执行使用相同参数去掉 `--check-only`，由命令助手以 root 运行。已针对实际 `/usr/bin/caddy`、`/etc/caddy/Caddyfile`、`systemctl reload caddy` 与 Caddy 2.6.2 的 `root *` 语法编写；只向主配置末尾增加 `import /etc/caddy/wisplab.caddy`，保留 `blotlens.top` 和 `www.blotlens.top` 原配置字节。生成的四站配置不启用目录浏览，也不额外添加 CSP/HSTS。

新目录 `/srv/wisplab` 带脚本管理标记；如果目录已存在但没有正确标记，脚本拒绝接管。版本号相同但归档 SHA 不同会拒绝；归档、配置与 current 已一致则不重复 reload。升级保留此前 `assets/` 文件与完整旧版本，HTML/静态响应均使用重新验证缓存。脚本不会自动清理旧资源。

变更前备份位于 `/srv/wisplab/backups/<UTC时间>-<随机后缀>/`，包括原配置及 `transaction.json`。失败会恢复配置和旧 current 并重载；若回滚也失败，保留 `/srv/wisplab/pending.json` 并阻止后续执行，先根据事务记录核对和恢复，不能直接删除日志后重试。断电/强制终止也按此日志人工核对。正常发布后仍需完成上述域名、证书和浏览器验收，脚本的进程成功不等于这些验收通过。

本地 `python3 -m unittest -v test_deploy.py` 使用临时目录及模拟命令运行，不调用真实 Caddy/systemd、不操作远程。覆盖恶意 tar、校验差异、旧站配置保留、重复发布、资源继承、权限、并发配置修改以及验证/重载/回滚失败路径。
