# WispLab 更新与回滚

三套分析工具各自只有一个 GitHub 源码仓库。自有域名与 GitHub Pages 使用同一提交、同一次完整 CI 通过后保存的 `web-dist`，不维护域名专用的分析代码分支。域名导航根据访问地址切换。

## 修改哪里

| 工具 | 本机编辑目录 | 唯一源码仓库 |
| --- | --- | --- |
| WB | `/Users/kururugao/.codex/worktrees/wb-ui-release/WB分析` | `Gaoyuan-0423/blot-workbench` |
| 病理 | `/Users/kururugao/Downloads/pathology-workbench` | `Gaoyuan-0423/pathology-workbench` |
| PCR | `/Users/kururugao/Downloads/pcr-workbench` | `Gaoyuan-0423/pcr-workbench` |

原 `/Users/kururugao/Downloads/WB分析` 有尚未整理的旧修改，本次没有覆盖。后续 WB 开发使用上表的发布工作树，不同时在旧目录维护另一份版本。

总首页、发布脚本、服务器更新脚本和说明统一保存在 WB 仓库的 `deployment/wisplab/`。部署暂存目录和服务器上的 release 目录是构建产物，不是另一套开发源码。

## 一次代码修改怎样更新两个地址

1. 在对应工具目录修改、测试并提交代码，将审核通过的提交推送到该仓库 `main`。GitHub 自动执行完整 CI；仅 `git push` 不会立即发布网站。
2. 在 WB 仓库 `deployment/wisplab/` 运行：

   ```sh
   python3 release.py publish --version 20261016-example
   ```

   每次换一个清晰、唯一的版本名。需要 Python 3 和已登录本人 GitHub 账号的 `gh` 命令。

3. 脚本锁定三个仓库的 `main` 提交，等待完整 CI，通过后下载其原始构建产物，更新三个 GitHub Pages。随后发布同一批产物的 WispLab 发布包，服务器定时拉取并切换；脚本检查四个新域名的版本后才报告成功。

相同版本名重新执行可用于恢复中断的发布；以脚本输出的恢复命令为准。它会保留已锁定的提交，不把失败重试悄悄换成更新的 `main`。

同一时间只运行一个发布版本，避免两个操作交错更新 Pages。服务器约每两分钟检查一次新发布，无需每次登录阿里云。服务器固定安装的部署程序不随网站发布包执行或替换；以后若修改部署程序本身，需要单独测试并安装。

发布涉及 GitHub 和阿里云两处系统，不能保证同一瞬间完成切换。正常流程有短暂传播窗口；发布入口会核对最终版本。若某一步失败，不把两个地址都标成成功，应根据日志恢复同一批发布，或执行双端回滚。

如只想准备发布包、查看将发布的版本，不改变线上内容：

```sh
python3 release.py plan --version 20261016-example
```

## 版本与回滚

WispLab GitHub release 的标签以 `wisplab-deploy-` 开头。每次发布保存三个源码 SHA、完整 CI 与 Pages 执行记录、静态归档、逐文件校验和及部署清单。自有域名 `/release.json` 可查看当前生效的版本和源码 SHA。

双端回滚通过统一入口执行，而不是只改服务器的链接：

```sh
python3 release.py rollback wisplab-deploy-原发布版本 --version rollback-20261016-example
```

回滚先验证旧版 CI 产物与保存的发布包一致，再恢复 GitHub Pages，最后创建新的回滚发布记录供服务器应用。服务器保留旧发布目录、Caddy 配置备份和失败回滚日志。

GitHub 的 CI 产物目前保留 30 天。若原产物已过期，双端回滚会停止：应重新运行原提交的完整 CI，再核对构建字节与旧发布包，不跳过测试。服务器本身保留的版本不受这 30 天限制，但单独回退服务器不会同步回退 GitHub Pages。

## 数据与范围

迁移验收后，病理已通过统一流程发布 IHC／常规与特殊染色／IF 场景入口；后续功能更新仍使用同一发布流程。

浏览器本地数据按域名隔离，新域名不会自动读到旧 GitHub Pages 的项目。旧网址继续保留用于导出。WB 项目模式可使用项目包迁移；病理与 PCR 应保留原始文件并导出重要结果，再在新域重建分析。

## 中英文内容维护

首页和三个工具提供「中文 / EN」切换。有效的 `?lang=zh` 或 `?lang=en` 优先于本域保存的 `localStorage['wisplab.lang']`，默认中文；跨站导航携带语言参数，保留工具原有的模式参数。各域分别记住用户选择。浏览器禁止存储时仍可使用语言参数。

新增界面文案应同时维护两种语言，包括按钮、帮助、状态、错误、结果和无障碍标签。用户输入的文件名、样本名、分组名等保持原文。算法及项目标识不应按语言变化；系统消息保留原始值，在显示时翻译。

- 首页：`deployment/wisplab/portal/locale.js` 字典，HTML 用显式 `data-i18n` 标记。发布器从锁定的 WB 提交取得语言文件，同时兼容早期无此文件的发布包。
- WB：`src/i18n.ts` 统一语言状态，集中消息与现有组件的显式中英文对照一起维护。
- 病理：`src/i18n/messages.ts` 与 `src/i18n.ts`，详见病理仓库 `docs/bilingual-ui.md`。
- PCR：`src/i18n/messages.ts` 与 `src/i18n/` 中的语言状态和翻译入口。

发布前验证两种语言、刷新记忆、跨站导航以及切换后图像/数据/结果保留，并检查英文在手机宽度下的布局。完成测试后仍运行本说明的统一发布命令，不单独复制某个网站文件。
