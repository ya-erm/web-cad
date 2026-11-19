#!/usr/bin/env python3
"""Stage an API version, copying private environment settings in memory from the live version.
No secret values are accepted on argv, written to disk or included in output.
The live tag is deliberately left in place until the candidate has been checked.
"""
import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FUNCTIONS = 'https://serverless-functions.api.cloud.yandex.net/functions/v1/'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class CloudApi:
    def __init__(self, yc, config):
        self.cli = [yc, '--config', config]
        result = subprocess.run(self.cli + ['iam', 'create-token'], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Unable to obtain deployment credentials')
        self.token = result.stdout.strip()
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, url, body=None, method=None):
        allowed = {'serverless-functions.api.cloud.yandex.net', 'operation.api.cloud.yandex.net'}
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in allowed:
            raise RuntimeError('Unexpected API origin')
        request = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # API errors can echo environment values. Never print their response body.
            raise RuntimeError(f'Cloud API returned HTTP {error.code}') from None

    def by_tag(self, function, tag):
        return self.request(FUNCTIONS + 'versions:byTag?' + urllib.parse.urlencode({'functionId':function, 'tag':tag}))

    def stage(self, source, environment, tag, archive=None):
        fields = ['functionId', 'runtime', 'entrypoint', 'resources', 'executionTimeout', 'serviceAccountId',
            'namedServiceAccounts', 'concurrency', 'connectivity', 'logOptions', 'storageMounts',
            'asyncInvocationConfig', 'tmpfsSize', 'mounts', 'metadataOptions']
        body = {key:source[key] for key in fields if key in source}
        body.update(environment=environment, secrets=[], tag=[tag], description='WebCAD API: ordinary environment variables, no Lockbox')
        if archive:
            body['content'] = base64.b64encode(Path(archive).read_bytes()).decode()
        else:
            body['versionId'] = source['id']
        operation = self.request(FUNCTIONS + 'versions', body)
        deadline = time.monotonic() + 180
        while not operation.get('done'):
            if time.monotonic() >= deadline:
                raise RuntimeError('Version operation timed out; inspect its status privately before retrying')
            time.sleep(2)
            operation = self.request('https://operation.api.cloud.yandex.net/operations/' + operation['id'])
        if operation.get('error'):
            raise RuntimeError('Version operation failed')
        version = self.by_tag(source['functionId'], tag)
        if version.get('status') != 'ACTIVE' or version.get('secrets') or version.get('environment') != environment:
            raise RuntimeError('Candidate configuration verification failed')
        for key in fields:
            if version.get(key) != source.get(key):
                raise RuntimeError('Candidate runtime settings changed: ' + key)
        return {'id':version['id'], 'status':version['status'], 'tag':tag, 'lockboxReferences':0}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--yc', default='yc')
    parser.add_argument('--yc-config', required=True)
    parser.add_argument('--function-id', required=True)
    parser.add_argument('--source-tag', default='cloud-v1')
    parser.add_argument('--candidate-tag', default='bundle-check')
    parser.add_argument('--archive', required=True)
    args = parser.parse_args()
    try:
        if args.candidate_tag == args.source_tag:
            raise RuntimeError('Candidate tag must differ from the live tag')
        api = CloudApi(args.yc, args.yc_config)
        source = api.by_tag(args.function_id, args.source_tag)
        if source.get('secrets'):
            raise RuntimeError('Source still uses Lockbox: perform the explicit migration first')
        required = {'YDB_CONNECTION_STRING','S3_BUCKET','YANDEX_CLIENT_ID','YANDEX_CLIENT_SECRET','STORAGE_ACCESS_KEY_ID','STORAGE_SECRET_ACCESS_KEY'}
        if not required.issubset(source.get('environment',{})):
            raise RuntimeError('Source environment is incomplete')
        print(json.dumps(api.stage(source, source['environment'], args.candidate_tag, args.archive)))
    except Exception:
        print('Deployment failed; no environment values were logged. Check the operation and configuration privately.', file=sys.stderr)
        sys.exit(1)
