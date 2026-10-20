import importlib.util
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("platform_packager", ROOT / "package-release.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
deploy_spec = importlib.util.spec_from_file_location("platform_deploy", ROOT / "deploy.py")
deploy = importlib.util.module_from_spec(deploy_spec)
deploy_spec.loader.exec_module(deploy)


class PlatformReleaseTests(unittest.TestCase):
    def files(self):
        assets = {"client.js": b"client", "wisplab.js": b"interface", "wisplab.css": b"style"}
        manifest = {"schemaVersion": 1, "sourceRepository": "Gaoyuan-0423/blot-workbench", "sourceDirectory": "platform",
                    "files": {name: hashlib.sha256(data).hexdigest() for name, data in assets.items()}}
        return {**{f"platform/{name}": data for name, data in assets.items()}, "platform/manifest.json": json.dumps(manifest).encode()}

    def test_complete_generated_assets_are_accepted_but_tampering_and_omissions_fail(self):
        files = self.files()
        for site in ("wb", "pathology", "pcr"):
            packager.validate_ci_layout(site, files)
        with self.assertRaises(packager.PackageError):
            packager.validate_platform({**files, "platform/client.js": b"changed"})
        with self.assertRaises(packager.PackageError):
            packager.validate_platform({k: v for k, v in files.items() if not k.endswith("wisplab.css")})
        with self.assertRaises(packager.PackageError):
            packager.validate_ci_layout("wb", {**files, "platform/extra.js": b"unapproved"})

    def test_suite_cannot_mix_shared_account_versions(self):
        files = self.files()
        suite = {f"{site}/{name}": data for site in ("portal", "wb", "pathology", "pcr") for name, data in files.items()}
        packager.validate_platform_suite(suite)
        packager.validate_platform_suite({})  # Historical releases remain valid.
        with self.assertRaises(packager.PackageError):
            packager.validate_platform_suite({**suite, "pcr/platform/manifest.json": b"different"})
        with self.assertRaises(packager.PackageError):
            packager.validate_platform_suite({"portal/platform/manifest.json": files["platform/manifest.json"]})

    def test_cloud_import_is_optional_and_only_on_portal(self):
        config = deploy.caddy_snippet(Path("/srv/wisplab")).decode()
        self.assertEqual(config.count("import /etc/caddy/wisplab-cloud/*.caddy"), 1)
        self.assertIn("wisplab.top {\n    import /etc/caddy/wisplab-cloud/*.caddy", config)
        snippet = (ROOT.parents[1] / "services/cloud/ubuntu/cloud.caddy").read_text()
        self.assertIn("handle /api/* {", snippet)
        self.assertNotIn("route /api/*", snippet)  # Would follow the static catch-all in Caddy's order.


if __name__ == "__main__":
    unittest.main()
