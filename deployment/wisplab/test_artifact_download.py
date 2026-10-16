import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location('artifact_test_module', Path(__file__).with_name('artifact_download.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
URL = 'https://productionresultssa1.blob.core.windows.net/test?sig=do-not-log-this'


class Response(io.BytesIO):
    def __init__(self, data=b'abc', status=206, **headers):
        super().__init__(data)
        self.status = status
        self.headers = headers


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, members):
        path = self.root / 'test.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            for name, data in members:
                target.writestr(name, data)
        return path

    def test_range_requires_exact_206_range_total_and_encoding(self):
        good = {'Content-Range': 'bytes 3-5/9', 'Content-Length': '3'}
        a.check_range(Response(**good), 3, 5, 9)
        for status, changes in [(200, {}), (206, {'Content-Range': 'bytes 0-2/9'}),
                                (206, {'Content-Range': 'bytes 3-5/10'}),
                                (206, {'Content-Length': '4'}), (206, {'Content-Encoding': 'gzip'})]:
            with self.subTest(status=status, changes=changes), self.assertRaises(a.ArtifactError):
                a.check_range(Response(status=status, **{**good, **changes}), 3, 5, 9)

    def test_download_rejects_redirect_hosts_and_spoofs(self):
        a.download_host(URL)
        for bad in ['http://productionresultssa1.blob.core.windows.net/a',
                    'https://productionresultssa1.blob.core.windows.net.evil.test/a',
                    'https://evil.blob.core.windows.net/a',
                    'https://user:password@productionresultssa1.blob.core.windows.net/a',
                    'https://productionresultssa1.blob.core.windows.net:444/a', URL+'\nAuthorization: bad']:
            with self.subTest(url=bad), self.assertRaises(a.ArtifactError):
                a.download_host(bad)

    def test_api_credentials_are_not_forwarded_to_download(self):
        seen = []
        class API:
            def open(self, request, **kwargs):
                seen.append(request)
                raise urllib.error.HTTPError(request.full_url, 302, 'Found', {'Location': URL}, io.BytesIO())
        class Token:
            returncode=0
            stdout='fake-test-token\n'
        with patch.object(a.subprocess, 'run', return_value=Token()), patch.object(a.urllib.request, 'build_opener', return_value=API()) as make:
            self.assertEqual(a.signed_url('Gaoyuan-0423/pathology-workbench', 1), URL)
            self.assertIsInstance(make.call_args.args[0], a.NoRedirect)
        self.assertEqual(seen[0].host, 'api.github.com')
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer fake-test-token')
        class Download:
            def open(self, request, **kwargs):
                seen.append(request)
                return Response(**{'Content-Range': 'bytes 0-2/3', 'Content-Length': '3'})
        with patch.object(a.urllib.request, 'build_opener', return_value=Download()):
            a.fetch_part(URL, 0, 2, 3, self.root/'part', threading.Event())
        self.assertIsNone(seen[1].get_header('Authorization'))
        self.assertEqual((self.root/'part').read_bytes(), b'abc')

    def test_range_truncation_and_extra_bytes_are_rejected(self):
        for data in [b'ab', b'abcd']:
            class Opener:
                def open(self, *args, **kwargs):
                    return Response(data, **{'Content-Range':'bytes 0-2/3'})
            with self.subTest(data=data), patch.object(a.urllib.request, 'build_opener', return_value=Opener()), self.assertRaises(a.ArtifactError):
                a.fetch_part(URL, 0, 2, 3, self.root/'part', threading.Event())

    def test_network_failure_does_not_expose_signed_url(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise urllib.error.URLError(URL)
        with patch.object(a.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaises(a.ArtifactError) as error:
                a.fetch_part(URL, 0, 2, 3, self.root/'part', threading.Event())
        self.assertNotIn('sig=', str(error.exception))
        self.assertNotIn('do-not-log', str(error.exception))

    def test_merge_is_ordered_and_digest_is_mandatory(self):
        data = bytes(range(256)) * 3000
        ranges=[]
        def fetch(url,start,end,total,path,cancel):
            ranges.append((start,end,total))
            path.write_bytes(data[start:end+1])
            return path
        archive=self.root/'archive.zip'
        with patch.object(a,'fetch_part',side_effect=fetch):
            a.download_ranges(URL,len(data),'sha256:'+hashlib.sha256(data).hexdigest(),archive)
        self.assertEqual(archive.read_bytes(),data)
        self.assertLessEqual(len(ranges),12)
        ordered=sorted(ranges)
        self.assertEqual(ordered[0][0],0)
        self.assertEqual(ordered[-1][1],len(data)-1)
        self.assertTrue(all(left[1]+1==right[0] for left,right in zip(ordered,ordered[1:])))
        archive.unlink()
        with patch.object(a,'fetch_part',side_effect=fetch), self.assertRaisesRegex(a.ArtifactError,'SHA256'):
            a.download_ranges(URL,len(data),'sha256:'+'0'*64,archive)
        self.assertFalse(archive.exists())
        with self.assertRaises(a.ArtifactError):
            a.download_ranges(URL,len(data),None,archive)

    def test_zip_valid_content(self):
        archive=self.archive([('assets/a.js',b'console.log(1)'),('index.html',b'<html/>')])
        target=self.root/'out'
        a.safe_extract_zip(archive,target)
        self.assertEqual((target/'assets/a.js').read_bytes(),b'console.log(1)')
        self.assertEqual((target/'index.html').read_bytes(),b'<html/>')

    def test_zip_path_traversal_absolute_and_backslash(self):
        for name in ['../escape','/absolute','a/../../escape','a\\escape','C:drive','./index.html','a//b','bad\nname']:
            with self.subTest(name=name):
                archive=self.archive([(name,b'x')])
                target=self.root/'out'
                with self.assertRaises(a.ArtifactError):a.safe_extract_zip(archive,target)
                self.assertFalse(target.exists())

    def test_zip_case_and_unicode_duplicate_paths(self):
        for names in [('index.html','INDEX.html'),('é.txt','e\u0301.txt')]:
            with self.subTest(names=names):
                archive=self.archive([(name,b'x') for name in names])
                target=self.root/'out'
                with self.assertRaisesRegex(a.ArtifactError,'重复'):a.safe_extract_zip(archive,target)
                self.assertFalse(target.exists())

    def test_zip_symlink_special_file_and_directory_conflict(self):
        for kind in [stat.S_IFLNK,stat.S_IFIFO]:
            entry=zipfile.ZipInfo('index.html')
            entry.create_system=3
            entry.external_attr=(kind|0o777)<<16
            archive=self.archive([(entry,b'/etc/passwd')])
            with self.assertRaises(a.ArtifactError):a.safe_extract_zip(archive,self.root/'out')
        archive=self.archive([('file',b'x'),('file/inside',b'x')])
        with self.assertRaises(a.ArtifactError):a.safe_extract_zip(archive,self.root/'out')
        self.assertFalse((self.root/'out').exists())

    def test_zip_size_limit(self):
        archive=self.archive([('index.html',b'12345')])
        with patch.object(a,'MAX_BYTES',4),self.assertRaises(a.ArtifactError):
            a.safe_extract_zip(archive,self.root/'out')
        self.assertFalse((self.root/'out').exists())

    def test_failed_digest_never_creates_complete_destination(self):
        artifact={'id':1,'name':'web-dist','expired':False,'size_in_bytes':100,'digest':'sha256:'+'0'*64}
        with patch.object(a,'signed_url',return_value=URL),patch.object(a,'download_ranges',side_effect=a.ArtifactError('bad digest')):
            with self.assertRaises(a.ArtifactError):
                a.download_artifact('Gaoyuan-0423/pathology-workbench',artifact,self.root/'complete',required_file='index.html')
        self.assertEqual(list(self.root.iterdir()),[])

    def test_complete_artifact_atomically_appears_after_validation(self):
        original=self.archive([('index.html',b'<html/>')]).read_bytes()
        artifact={'id':1,'name':'web-dist','expired':False,'size_in_bytes':len(original),'digest':'sha256:'+hashlib.sha256(original).hexdigest()}
        target=self.root/'complete'
        def download(url,size,digest,archive,progress):
            self.assertFalse(target.exists())
            archive.write_bytes(original)
        with patch.object(a,'signed_url',return_value=URL),patch.object(a,'download_ranges',side_effect=download):
            result=a.download_artifact('Gaoyuan-0423/pathology-workbench',artifact,target,required_file='index.html')
        self.assertEqual((target/'index.html').read_bytes(),b'<html/>')
        self.assertEqual(result['digest'],artifact['digest'])
        self.assertFalse(any(p.name.startswith('.artifact-') for p in self.root.iterdir()))


if __name__=='__main__':unittest.main()
