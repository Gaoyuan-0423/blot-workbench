# Desktop release / 桌面发布

桌面发布使用同一套仓库源码，但安装包需要独立构建。网页仍通过
`deployment/wisplab/release.py` 更新 GitHub Pages 与自有域名；桌面 Release
不会改变网站或账号服务器。所有命令均在 WB 正式源码目录执行：
`~/.codex/worktrees/wb-ui-release/WB分析`。

Desktop packages use the same tool repositories. Web publishing remains separate;
desktop releases do not deploy websites or the account service.

## 一键发布已测试的安装包 / Publish tested packages

1. 将桌面修改通过 PR 合并到 `main`。运行现有
   [desktop.yml](../.github/workflows/desktop.yml)，传入三个工具已经通过完整 CI
   的 40 位 SHA。等待整个构建在 macOS arm64、macOS x64 和 Windows x64 上成功，
   记录该 run ID。分支上成功的试跑不能直接正式发布，合并后必须从 `main` 构建。
2. 在 GitHub Actions 手动运行 **Publish verified desktop packages**
   （[desktop-release.yml](../.github/workflows/desktop-release.yml)），选择 `main`，
   填入构建 run ID、与 `desktop/package.json` 一致的版本 tag，以及同样的三个工具 SHA。
3. GitHub runner 下载、核验并上传文件。安装包不经过维护者本机。
   验证完成前 Release 保持 draft；全部 GitHub 资产摘要一致后，才公开为 prerelease。

Merge desktop changes to `main`, run `desktop.yml` with three pinned successful tool
CI commits, then manually dispatch `desktop-release.yml` with that completed run ID
and the same sources. Downloads and uploads run inside GitHub Actions.

```sh
gh workflow run desktop-release.yml \
  --repo Gaoyuan-0423/blot-workbench --ref main \
  -f desktop_run_id=REPLACE_WITH_SUCCESSFUL_MAIN_DESKTOP_RUN_ID \
  -f tag=wisplab-desktop-0.1.0-experimental.1 \
  -f wb_sha=02f6ebf8154fe3d26c123022a5544c56a5a8650a \
  -f pathology_sha=bb0ad5e70d37b27f56f112ad669ef8c567f5591a \
  -f pcr_sha=af1038e1daec96b6f082e91d36e5559ed8d7f79b
```

以上三个 SHA 是本次计划的工具版本；这条示例不是已发布声明。以后版本需替换为
相应通过 CI 的 SHA。桌面壳 SHA 取构建 run 的 `head_sha`，可与内置 WB 工具 SHA 不同；
发布 tag 必须指向桌面壳 SHA。仅接受 `wisplab-desktop-X.Y.Z-experimental.N`。

The example pins the currently planned tool versions, not an already published
release. Future releases must supply their tested source SHAs. The release tag
targets the desktop shell commit, which may differ from the bundled WB commit.

## 校验与公开内容 / Validation and public files

- 构建必须属于本仓库、`.github/workflows/desktop.yml`、`main`、手动触发，
  且整个 run `completed/success`。三个确切命名的工件均须有效、唯一。
- 使用现有发布器的安全下载和解压实现，验证 GitHub artifact SHA256，
  拒绝路径逃逸、链接、重复文件和超限 ZIP。单工件压缩及展开上限 2 GiB，
  单文件上限 1 GiB，文件总数上限 10,000。
- 每个工件的 `out/SHASUMS256.txt` 全部验证，包括不公开的 blockmap。
  三个 `resources/release.json` 必须逐字节一致，`mode=ci`、所有 `dirty=false`，
  壳 SHA、三个工具 SHA、来源 CI 和版本号均须匹配。
- 只公开六个安装包：macOS arm64/x64 各 DMG、ZIP；Windows x64 各 setup、portable EXE。
  另附合并的 `SHASUMS256.txt`、原始 `release.json` 和双语 `RELEASE-NOTES.md`。
  不发布 blockmap、synthetic reports、测试项目 ZIP、截图或临时 profiles。
- 所有上传资产都按 GitHub 返回的 `digest=sha256:…`、大小和 uploaded 状态核验。
  六个安装包的合并清单不混入说明文件。

Only six installers plus checksums, the source manifest and concise bilingual
notes become Release assets. Original CI reports, synthetic projects and screenshots
remain in Actions artifacts under their existing access rules. The publisher checks GitHub's artifact
and release-asset digests, source provenance and platform manifest equality.
See [GitHub release asset API](https://docs.github.com/en/rest/releases/assets)
and [workflow run API](https://docs.github.com/en/rest/actions/workflow-runs).

## 中断恢复和回退 / Resume and rollback

失败立即停止，不删除或覆盖上传文件。用**同一个 run ID、tag、三个 SHA**再次手动执行：
只有相同来源标记、目标提交、prerelease 状态的 draft 可以恢复；
已存在资产必须摘要一致，缺失资产继续上传。错误摘要、未完成资产、陌生附件、
手动改过来源说明或 tag 指向错误都会停止，需人工检查，脚本不替换。

公开过的同名 Release 一律拒绝修改，即使内容相同。最后公开步骤超时导致结果未知时，
先检查 GitHub Release；若已经公开，复核资产即可，不重新发布或覆盖。
回退是在 Releases 下载已验证的旧安装包并手动安装，不移动旧 tag。
新发布使用新版本号；不能把另一次构建替换进旧 draft。

Failures preserve the draft. Rerun with identical inputs to verify existing assets
and upload only missing ones. Public releases, mismatched drafts and conflicting
assets are never overwritten. If publishing timed out, inspect GitHub first:
it may already be public. Reinstall a previously verified package to roll back;
keep exported projects before changing versions.

## 权限与本地检查 / Permissions and local checks

Workflow 仅手动触发；默认只读，仅发布 job 有 `contents: write`、`actions: read`，
使用当前仓库 `GITHUB_TOKEN`，无服务器凭据。按 tag 串行执行，关闭中途取消。
不执行下载安装包；只核验字节和来源。

```sh
python3 -m unittest discover -s desktop/test -p 'test_*.py'
python3 desktop/scripts/publish-release.py --help
```

本地脚本默认仅验证，必须明确传入 `--publish` 才产生 GitHub 写入。
本地验证同样下载大工件；日常发布应使用上述 GitHub workflow。
测试全部用合成文件和模拟 GitHub 元数据，不上传、不创建 tag/Release。

Unsigned experimental packages may trigger OS warnings. This workflow does not
add signing, notarization, automatic app updates, cloud project sync or scientific
validation. 核心离线使用、可选账号及实验数据本地保存的范围不变。
