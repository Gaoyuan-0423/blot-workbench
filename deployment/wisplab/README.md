# WispLab 静态发布包

这里保存自有域名首页和静态站点的打包工具。正式发布采用同一源码提交的成功 CI `web-dist` 工件：GitHub Pages 与自有域名使用同一份字节，不在本地重新构建第二份产物。`package-release.py` 只读取已解压的静态产物、校验并生成本地文件，不构建项目，也不推送 Git、上传附件或操作服务器。

## 正式发布：使用 CI 工件

统一发布程序先向 GitHub 验证三个仓库的完整提交 SHA、成功的主线 CI 及 `web-dist` 工件，再下载、校验并安全解压。打包器接受以下输入，不依赖本机仓库、`dist/` 或 `node_modules`：

```sh
python3 package-release.py --version 20261016-domain-ci \
  --wb-artifact /path/to/ci/wb \
  --pathology-artifact /path/to/ci/pathology \
  --pcr-artifact /path/to/ci/pcr \
  --ci-provenance /path/to/provenance.json \
  --output-dir releases-ci
```

加 `--check-only` 只验证、不生成文件；`--expect-wb-sha` 等参数也可用来锁定来源中的完整 SHA。CI 模式完整复制工件文件，包含 CI 生成的 `THIRD_PARTY_NOTICES.txt`，不会替换 JS/CSS、删减公开示例或重新打包浏览器资源。网站内的路径与字节保持不变。

来源 JSON 格式如下（实际必须同时包含 `wb`、`pathology`、`pcr`）：

```json
{
  "schemaVersion": 1,
  "sites": {
    "wb": {
      "repository": "Gaoyuan-0423/blot-workbench",
      "gitSha": "完整的40位小写Git提交SHA",
      "runId": 38922948490,
      "artifactName": "web-dist"
    }
  }
}
```

每项可另外记录正整数 `artifactId`、`artifactDigest`（`sha256:` 加 64 位小写摘要）和与仓库/runId 对应的 `runUrl`。正式清单会将这组身份与每个文件的 SHA-256 一起保存。打包器不自行联网；JSON 身份必须由统一发布程序先通过 GitHub 核验，不能把手填 JSON 当作 CI 成功证明。

供统一发布程序复用的 Python API：

```python
result = package_ci_release(
    version="20261016-domain-ci",
    portal=Path("portal"),
    artifact_dirs={"wb": Path("..."), "pathology": Path("..."), "pcr": Path("...")},
    provenance=provenance_json,
    output_dir=Path("releases-ci"),
    check_only=False,
)
```

返回 `archive`、`checksum`（绝对路径字符串）、`sha256`、`sizeBytes`、`manifest`。检查模式前三项为 `None`、大小为 `0`，仍返回已验证的清单。来源 JSON 顶层可另带 `portal`，指定 `repository` 为 WB 仓库、`gitSha` 与 WB 工件一致、`sourcePath` 为 `deployment/wisplab/portal`，用于记录从同一提交取出的总首页；本次初始迁移的独立首页则记录 `gitSha: null`。

## 本地目录与兼容检查

| 站点 | 默认输入 | 对应地址 |
| --- | --- | --- |
| 总首页 | `portal/` | `https://wisplab.top/` |
| WB | `/Users/kururugao/.codex/worktrees/wb-ui-release/WB分析/dist/` | `https://wb.wisplab.top/` |
| 病理 | `/Users/kururugao/Downloads/pathology-workbench/dist/` | `https://pathology.wisplab.top/` |
| PCR | `/Users/kururugao/Downloads/pcr-workbench/dist/` | `https://pcr.wisplab.top/` |

上表是兼容本机 `dist/` 模式的默认路径，便于本地排查；不应用它代替正式 CI 工件发布。此模式要求工作树干净，并核对 `origin` 是对应的公开 GitHub 仓库。两种模式都不复制仓库源码、`.git` 或 `node_modules`。

首页只有 `index.html`、`styles.css`、`favicon.svg` 三个发布文件。`portal/.qa/` 存放桌面/手机截图和检查记录，明确排除在发布包外。页面不依赖 JavaScript、CDN 或外部字体。已复查截图，三张工具卡、单条带快捷入口和手机单列布局显示正常。

## 兼容本机 dist 模式

在 macOS / Linux 上使用 Python 3.9 或更新版本和 Git，无额外 Python 依赖。先在三个仓库分别完成生产构建，再从本目录运行：

```sh
python3 package-release.py --check-only
python3 package-release.py --version 20261016-domain
```

`--version` 是发布标识，可使用 1–80 个英文字母、数字、点、短横线或下划线，首字符须是字母或数字；不传时使用 UTC 时间。已存在的同名输出不会覆盖。

明确锁定准备发布的三个提交时，可以附加：

```sh
python3 package-release.py --version 20261016-domain \
  --expect-wb-sha FULL_40_CHARACTER_WB_SHA \
  --expect-pathology-sha FULL_40_CHARACTER_PATHOLOGY_SHA \
  --expect-pcr-sha FULL_40_CHARACTER_PCR_SHA
```

路径迁移后，可用 `--wb-repo`、`--pathology-repo`、`--pcr-repo` 指定各仓库根目录，用 `--portal` 指定首页目录，用 `--output-dir` 指定输出目录。这些参数都可以通过 `--help` 查看。

默认生成：

```text
releases/
  wisplab-20261016-domain.tar.gz
  wisplab-20261016-domain.tar.gz.sha256
```

压缩包内仅有以下内容：

```text
release.json
portal/index.html
portal/styles.css
portal/favicon.svg
wb/index.html
wb/assets/...
wb/examples/...                 # 已提交的公开合成示例，含 ZIP/图像/预期结果
pathology/index.html
pathology/assets/...
pathology/ort/...               # 本地 ONNX 浏览器运行时
pathology/screenshots/...       # 已提交的公开文档截图
pcr/index.html
pcr/assets/...
pcr/demo/...                    # 已提交的公开演示表格
...各站点的已验证静态图标或 THIRD_PARTY_NOTICES.txt
```

tar 内每项均为普通文件，不依赖目录条目、符号链接或硬链接。打包会将权限统一为 `0644`、用户/组编号为 `0`，不把本机用户名、绝对路径或工作树信息写进 tar 元数据。发布包可作为 WB GitHub Release 的公开附件供服务器下载；本脚本不执行上传。

## 清单格式

`release.json` 使用以下结构，部署程序可按 `sites.<site>.files` 逐文件校验：

```json
{
  "schemaVersion": 1,
  "version": "20261016-domain-ci",
  "generatedAtUtc": "2026-10-16T15:00:00Z",
  "sites": {
    "portal": {
      "sourceKind": "portal",
      "gitSha": null,
      "files": { "index.html": "64-character-sha256" }
    },
    "wb": {
      "sourceKind": "github-actions-artifact",
      "repository": "Gaoyuan-0423/blot-workbench",
      "gitSha": "40-character-commit-sha",
      "runId": 38922948490,
      "artifactName": "web-dist",
      "files": { "index.html": "64-character-sha256" }
    }
  },
  "validation": "..."
}
```

示例为了简短省略了其余文件及 `pathology`、`pcr` 条目；实际清单包含四站的全部文件、三个完整 Git 提交 SHA 以及每个文件的 SHA-256。清单不对自身做递归散列，外部 `.tar.gz.sha256` 校验整个压缩包（包括清单）。服务器需要在使用前检查压缩包校验值和清单。

## 输入校验及边界

打包会拒绝：

- 符号链接、硬链接输入、设备/FIFO 等特殊文件，以及绝对路径、`..`、隐藏文件、控制字符等不安全路径；首页唯一例外是整目录排除的 `.qa/`。
- `.env`、私钥文件名/格式、常见访问令牌签名、源码后缀、source map、测试/私有目录等。
- 不在允许的站点静态目录中的临时文件。CI 模式按明确的 `assets/`、公开示例、文档截图和 ONNX 运行时路径校验；本地兼容模式另核对公开静态素材与已提交源码、截图和安装运行时是否逐字节一致。
- 未按 Vite 带 hash 命名的未知 `assets/` 文件、缺少 `index.html`、首页引用缺失或远程的脚本/样式/图标等。
- 公开示例 ZIP 中的路径逃逸、链接/特殊文件、加密、嵌套压缩包及超限内容。ZIP 内同样扫描文件名和常见密钥签名。

公开合成示例和演示表格是产品的静态资源，会完整保留；临时测试输出或私有实验资料不应放入 `public/` 或 `dist/`。新增静态资源种类时，应先确认公开来源，再有针对性地更新脚本允许规则，不应取消整体检查。

**打包器不替代 GitHub 来源核验、CI 测试或内容审阅。** 正式发布由统一发布程序验证 GitHub 主线成功 CI 和下载工件来源，打包器则记录来源身份并对实际字节计算摘要。兼容本机模式只记录当前提交，不能证明 `dist/` 来自该提交，不用于两个地址的统一正式发布。常见签名扫描不能证明没有任意形式的敏感信息，不应把未经审阅的用户数据加入站点资源。

## 统一发布入口

后续维护以 WB 仓库 `deployment/wisplab/` 为唯一部署源码目录。`release.py` 使用 Python 3.9+ 标准库和已认证的 GitHub CLI，不构建本机 `dist`，不推送源码；先将三个工具各自的改动提交并推送到 `main`。

```sh
# 预览：锁定各 main SHA、等待完整 CI、下载 web-dist 并生成本地产物；不发布
python3 release.py plan --version 20261017-update

# 一条命令发布；也可直接执行，不必先 plan。相同版本可恢复中断
python3 release.py publish --version 20261017-update

# 回退两个部署端：引用旧发布包，另建一条回滚记录
python3 release.py rollback wisplab-deploy-20261017-update --version rollback-20261018
```

正式发布从锁定的 WB 提交读取 `deployment/wisplab/portal/` 内三个首页文件，不混用本机未提交内容。`--portal PATH` 仅为第一次迁移尚未提交首页时使用。`--output-dir` 指定本地状态目录；`--timeout` 默认等待 CI/Pages 7200 秒，`--server-timeout` 默认等待服务器 600 秒。

每个版本保留 `state.json`、三个 CI 产物、逐文件 `release.json` 清单、CI 来源记录和 `deployment.json`。步骤为：三个完整 CI 成功 → 下载同 SHA 的 `web-dist` → 同一份产物构包 → 以同 SHA 派发三个现有 Pages workflow → 全部 Pages 成功 → 创建并核对公开 Release → 等待四个自有域 `/release.json` 的版本、提交及完整文件清单全部一致。只有最后一步通过才以退出码 0 报告发布完成；这是按顺序更新多个主机，**不是跨主机原子发布**。

发布仓库固定为 `Gaoyuan-0423/blot-workbench`，tag 前缀固定 `wisplab-deploy-`；附件为 `deployment.json` 和 `wisplab-<bundle-version>.tar.gz`。不会覆盖既有版本。失败时输出每个 Pages、自有域和公开 Release 的当前状态，以及同一条恢复命令；保留原状态目录后重试即可。若 Pages 派发后网络响应丢失，脚本会停在 `dispatch-pending`，应先在 Actions 找到准确 run ID 并填回提示的本地状态，避免重复派发；若 Pages 失败，按错误提示重跑该 run 后恢复。

回滚复用原归档，逐文件核对当前可下载的同 SHA CI 产物，重新派发三个 Pages，然后公开新的回滚记录供服务器拉取。回滚操作 tag 可为新版本，`deployment.version` 保持原归档版本。现有 CI 产物保留约 30 天；过期时脚本会停止并给出 `gh run rerun <旧 CI run> --repo <仓库>`。该操作在旧 SHA 重新执行完整 CI；若重新生成的字节与原归档不同，脚本拒绝把它当作同版本回滚，应调查依赖变化并另发新版本。

发布脚本的离线验证：`python3 -m unittest test_release.py -v`。测试覆盖失败 CI、过期产物、Pages 失败、未知派发结果不重复执行、回滚逐文件差异、真实打包器对接，以及四域清单不一致时不得报成功。

Pages 成功后，发布器还读取该次 verify job 日志中的实际 `DEPLOY_COMMIT`，下载该次 `github-pages` artifact，并将其中每个静态文件与服务器包清单逐项比对。这样即使准备期间同 SHA 的 CI 被重跑，也不会把不同构建误报成两端一致。附件上传后要求 GitHub 返回的 SHA-256 与本地附件一致，缺少摘要时保留草稿并停止。归档写完但状态尚未保存时，可以核对当前输入后复用遗留归档恢复。
