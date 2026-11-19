"""Keep application sources readable; bundle SDK dependencies without shipping node_modules."""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node', default='node', help='Node.js executable (22 or newer recommended)')
args = parser.parse_args()
project = Path(__file__).resolve().parent.parent
source = project / 'cloud' / 'api'
output = project / 'temp' / 'webcad-api.zip'
if not (source / 'node_modules' / 'esbuild').is_dir():
    raise SystemExit('Run npm ci --ignore-scripts --prefix cloud/api (including devDependencies) first')
application = ('index.js', 'index.mjs', 'probes.mjs', 'auth.mjs', 'cloud.mjs', 'cloud-store.mjs',
               'cloud-storage.mjs', 'auth-store.mjs', 'auth-policy.mjs', 'yandex.mjs')
output.parent.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory(prefix='cloud-api-package-', dir=output.parent) as work:
    staging = Path(work)
    subprocess.run([args.node, str(project / 'scripts' / 'bundle-cloud-vendor.mjs'), str(staging)], check=True)
    for name in (*application, 'auth-schema.sql', 'cloud-schema.sql'):
        path = source / name
        if path.is_symlink():
            raise SystemExit(f'Unexpected symlink: {path}')
        if name in application:
            for dependency in re.findall(r'''from\s+['"]([^'"]+)['"]''', path.read_text()):
                if not dependency.startswith(('./', 'node:')):
                    raise SystemExit(f'{name}: route SDK imports through vendor.mjs: {dependency}')
        shutil.copyfile(path, staging / name)
    # Prevent the platform from reinstalling the SDK dependency tree over the bundle.
    original = json.loads((source / 'package.json').read_text())
    manifest = {key: original[key] for key in ('name', 'version', 'private', 'type', 'engines')}
    (staging / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')
    lock = {'name': manifest['name'], 'version': manifest['version'], 'lockfileVersion': 3,
            'requires': True, 'packages': {'': {key: manifest[key] for key in ('name', 'version', 'engines')}}}
    (staging / 'package-lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    # Optional gRPC admin/ORCA services still find their runtime descriptors after bundling.
    shutil.copytree(source / 'node_modules' / '@grpc' / 'grpc-js' / 'proto', staging / 'runtime' / 'grpc' / 'proto')
    (staging / 'README.md').write_text(
        '# WebCAD API\n\n'
        'Application source: index.js / index.mjs, auth*.mjs, yandex.mjs, cloud*.mjs, probes.mjs.\n'
        'These files match the repository source and remain readable in the cloud editor.\n\n'
        'vendor.mjs contains the prebuilt YDB and S3 SDK dependencies.\n'
        'runtime/grpc/proto contains optional gRPC descriptors.\n'
        'THIRD_PARTY_LICENSES.txt contains dependency license notices.\n\n'
        'No node_modules installation is needed. Entry point: index.handler (Node.js 22).\n'
        'Repository: https://github.com/ya-erm/web-cad\n', encoding='utf-8')
    files = sorted(path for path in staging.rglob('*') if path.is_file())
    if len(files) >= 1000 or any('node_modules' in path.relative_to(staging).parts for path in files):
        raise SystemExit('Unexpected dependency tree or excessive deployment file count')
    for name in application:
        if (source / name).read_bytes() != (staging / name).read_bytes():
            raise SystemExit(f'Application source unexpectedly transformed: {name}')
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for path in files:
            if path.is_symlink():
                raise SystemExit(f'Unexpected staged symlink: {path}')
            archive.write(path, path.relative_to(staging).as_posix())
    # Test the actual ZIP contents, rather than the development modules with node_modules nearby.
    extracted = staging / '_check'
    with ZipFile(output) as archive:
        archive.extractall(extracted)
    subprocess.run([args.node, str(project / 'scripts' / 'check-cloud-api-package.mjs'), str(extracted)], check=True)
print(f'{output.relative_to(project)}: {len(files)} files, {output.stat().st_size:,} bytes')
