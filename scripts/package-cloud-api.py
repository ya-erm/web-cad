"""Package only the private Cloud Function and its installed production dependencies."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parent.parent
source = project / 'cloud' / 'api'
output = project / 'temp' / 'webcad-api.zip'
dependencies = source / 'node_modules'
if not dependencies.is_dir():
    raise SystemExit('Run npm ci --omit=dev --ignore-scripts --prefix cloud/api first')
files = [source / name for name in ('index.js', 'index.mjs', 'probes.mjs', 'auth.mjs',
    'cloud.mjs', 'cloud-store.mjs', 'cloud-storage.mjs', 'auth-store.mjs', 'auth-policy.mjs', 'yandex.mjs', 'package.json', 'package-lock.json')]
files += sorted(p for p in dependencies.rglob('*') if p.is_file() and '.bin' not in p.parts)
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for path in files:
        if path.is_symlink():
            raise SystemExit(f'Unexpected symlink: {path}')
        archive.write(path, path.relative_to(source).as_posix())
print(f'{output.relative_to(project)}: {output.stat().st_size:,} bytes')
