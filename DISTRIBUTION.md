# Web release package / 网页发行包

This archive contains the built static website (`dist/`), synthetic examples (`public/examples/`), documentation, license texts, and a SHA-256 manifest. It is **not** a Windows/macOS installer and does not include a Python or Node runtime. Complete source and locked dependencies are available in the GitHub tag's **Source code** archive.

实验室用户可直接打开 README 中的在线演示，无需下载或安装。离线部署用户可以把 `dist/` 放在已有的本地静态服务器上。不要双击 `dist/index.html` 使用 `file://`；浏览器模块与安全存储要求 localhost 或 HTTPS。

If Python 3 is already installed, an example local-only command from this archive's root is:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

On Windows with the Python launcher, use `py -m http.server 8000 --bind 127.0.0.1 --directory dist`. Then open `http://127.0.0.1:8000/` in Chrome or Edge. This server is only a static file server; analysis state remains in the browser. Stop the server with Ctrl+C. Changing the port or browser creates a separate storage origin; export a project archive to migrate.

`SHA256SUMS` verifies the downloadable ZIP and its external manifest. `release-manifest.json` inside the archive records the source commit and a checksum for each payload file. The GitHub Release notes identify the actual CI build artifact used for publication.

**Synthetic workflow demo only. Not validated for research quantification. / 仅合成流程演示，不能用于科研定量。**
