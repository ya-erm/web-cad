"""Deployment checks use fake values and never contact Yandex Cloud."""
import contextlib
import importlib.util
import io
import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-cloud-api.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.source = {'id':'old','functionId':'function','runtime':'nodejs22','entrypoint':'index.handler',
            'resources':{'memory':'268435456'},'executionTimeout':'15s','serviceAccountId':'api-account',
            'concurrency':'1','logOptions':{'disabled':True}}
        self.environment = {'SECRET':'PRIVATE_TEST_VALUE'}
        self.candidate = {**self.source,'id':'new','status':'ACTIVE','environment':self.environment}
        self.calls = []
        self.api = object.__new__(deploy.CloudApi)
        def request(url, body=None):
            self.calls.append((url,body))
            if body is not None:
                return {'id':'operation','done':True,'response':{}}
            return self.candidate
        self.api.request = request

    def test_preserves_environment_and_runtime_without_logging_values(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = self.api.stage(self.source,self.environment,'candidate')
        self.assertEqual(result,{'id':'new','status':'ACTIVE','tag':'candidate','lockboxReferences':0})
        body = self.calls[0][1]
        self.assertEqual(body['environment'],self.environment)
        self.assertEqual(body['secrets'],[])
        self.assertEqual(body['versionId'],'old')
        self.assertEqual(body['logOptions'],{'disabled':True})
        self.assertNotIn('PRIVATE_TEST_VALUE',out.getvalue()+json.dumps(result))

    def test_archive_upload_keeps_configuration_outside_the_code_archive(self):
        with patch.object(deploy.Path,'read_bytes',return_value=b'code-only'):
            self.api.stage(self.source,self.environment,'candidate',archive='unused.zip')
        body = self.calls[0][1]
        self.assertEqual(body['content'],deploy.base64.b64encode(b'code-only').decode())
        self.assertNotIn('versionId',body)
        self.assertEqual(body['environment'],self.environment)

    def test_credentials_never_go_to_an_unexpected_or_insecure_origin(self):
        for url in ['https://evil.example/','http://serverless-functions.api.cloud.yandex.net/']:
            with self.assertRaisesRegex(RuntimeError,'Unexpected API origin'):
                deploy.CloudApi.request(self.api,url)

    def test_rejects_a_candidate_that_loses_private_configuration(self):
        self.candidate['environment'] = {}
        with self.assertRaisesRegex(RuntimeError,'configuration verification failed'):
            self.api.stage(self.source,self.environment,'candidate')

    def test_rejects_accidental_changes_to_runtime_settings(self):
        self.candidate['concurrency'] = '8'
        with self.assertRaisesRegex(RuntimeError,'runtime settings changed'):
            self.api.stage(self.source,self.environment,'candidate')

    def test_rejects_remaining_lockbox_references(self):
        self.candidate['secrets'] = [{'id':'old-lockbox'}]
        with self.assertRaisesRegex(RuntimeError,'configuration verification failed'):
            self.api.stage(self.source,self.environment,'candidate')

    def test_waits_for_the_operation_without_using_cli_output(self):
        original = self.api.request
        def request(url,body=None):
            if body is not None:
                self.calls.append((url,body));return {'id':'operation','done':False}
            if '/operations/' in url:
                self.calls.append((url,None));return {'id':'operation','done':True,'response':{}}
            return original(url,body)
        self.api.request = request
        with patch.object(deploy.time,'sleep'):
            self.assertEqual(self.api.stage(self.source,self.environment,'candidate')['id'],'new')
        self.assertTrue(any('operation.api.cloud.yandex.net/operations/' in url for url,_ in self.calls))

if __name__ == '__main__':
    unittest.main()
