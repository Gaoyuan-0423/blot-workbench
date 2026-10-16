# 单一发布包，两处静态托管

本机 `release.py` 负责确认三仓库 exact Git SHA 的 CI 与 GitHub Pages 均成功，再将相同静态产物打包发布到 **Gaoyuan-0423/blot-workbench**。服务器 `update.py` 仅接收此前缀为 `wisplab-deploy-` 的已发布、非预发布 Release，不读取 GitHub token 或 SSH key，不执行 Release 中的任何脚本。

## 发布接口

Release 包含 `deployment.json` 与一个 `.tar.gz`。`deployment.json` 协议：

```json
{
  "schemaVersion": 1,
  "version": "20261016-domain-ci",
  "archive": {"fileName": "wisplab-20261016-domain-ci.tar.gz", "sha256": "<64位小写hex>"},
  "sources": {
    "wb": {
      "repository": "Gaoyuan-0423/blot-workbench",
      "gitSha": "<40位小写hex>",
      "ci": {"conclusion": "success", "headSha": "<同gitSha>", "runId": 123},
      "pages": {"conclusion": "success", "headSha": "<同gitSha>", "runId": 456}
    },
    "pathology": {"repository": "Gaoyuan-0423/pathology-workbench", "...": "同上字段"},
    "pcr": {"repository": "Gaoyuan-0423/pcr-workbench", "...": "同上字段"}
  }
}
```

`pages.headSha` 表示实际部署目标；回滚 workflow_dispatch 可附 `workflowHeadSha` 与 `commitInput`，前者允许与目标不同，后者必须等于 `gitSha`。归档内仍使用 `release.json` 的四站文件哈希清单。更新器核对三站源 SHA 与外层 `deployment.json` 一致，再调用固定安装的 `/srv/wisplab/bin/deploy.py` 完成全部安全解包、配置验证、切换与回滚。

tag 可以不同于归档 version：新的 `wisplab-deploy-rollback-<时间>` 发布记录可引用原归档。不要替换已发布 Release 的资产；需要修正时创建新的 tag/Release。更新器按 `published_at` 选择最新记录，同一 release ID/tag 成功后不重复安装。

## 首次安装（由主代理在初始迁移成功后执行）

先检查 `/srv/wisplab` 的管理标记、`bin/` 与相应 unit 名称无未知用途。固定安装以下文件，属主 root，脚本不允许组/其他用户写入：

- `deploy.py` → `/srv/wisplab/bin/deploy.py`（0644）。
- `update.py` → `/srv/wisplab/bin/update.py`（0644）。
- `systemd/wisplab-update.service`、`.timer` → `/etc/systemd/system/`（0644）。

然后执行：

```sh
systemd-analyze verify /etc/systemd/system/wisplab-update.service /etc/systemd/system/wisplab-update.timer
systemctl daemon-reload
systemctl start wisplab-update.service
systemctl enable --now wisplab-update.timer
```

服务使用 root 调用既有 Caddy 验证和 reload，不新建用户、不监听端口。timer 在开机约两分钟后检查，之后每次任务结束约两分钟再检查；有小幅随机延迟。首次实际启动须检查 Caddy 保持 active、既有 blotlens.top 正常、四域 HTTPS 与 `/release.json` 正常，再认定自动更新安装完成。

## 状态、故障与回滚

本地状态在 `/srv/wisplab/updater/state.json`，最后失败在 `last-error.json`，轮转日志为 `update.log`（每份约 1 MiB，保留三份历史）。网络/校验/部署失败不更新成功状态，保留当前部署并在后续 timer 重试；`deploy.py` 如果生成 `pending.json`，应先按部署说明检查回滚，不要直接删除它。成功后清除上次失败记录。

```sh
systemctl status wisplab-update.timer wisplab-update.service
journalctl -u wisplab-update.service -n 30 --no-pager
python3 /srv/wisplab/bin/update.py --tag wisplab-deploy-OLD-TAG
python3 /srv/wisplab/bin/update.py --resume
```

手动 `--tag` 成功后固定该 tag，timer 保持固定，避免自动装回需要回退的新版；`--resume` 解除固定并立即检查最新发布。若有另一个任务正在运行，手动操作会报错，应等其结束再重试。正式统一回滚应由本机发布工具先让三站 Pages 回退到原 SHA，再发布新的回滚 Release；这样两处托管继续一致。

四个站点的精确 `/release.json` 路径均返回当前归档版本清单，供本机发布工具经 HTTPS 确认版本与源 SHA。只读探针不提供服务器执行入口。GitHub 公共 Release 可无认证读取；接口分页和请求额度以 [GitHub Releases 文档](https://docs.github.com/en/rest/releases/releases) 与 [REST API 限额说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) 为准，遇到限额记录失败后等待下次 timer，不增加凭据。

## 本地验证

`python3 -m unittest -v test_update.py test_deploy.py` 使用临时目录、模拟 HTTP 与模拟子进程；不访问远程服务器、不调用真实 Caddy/systemd。它覆盖发布选择、同版本跳过、手动固定/恢复、外层与归档 SHA 核对、精确 CI/Pages 记录、固定脚本调用、失败状态保留和部署回滚。macOS 本地测试不等同于服务器的 systemd/Caddy 实际验证。
