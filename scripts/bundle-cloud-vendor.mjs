// Only SDK dependencies are bundled. Application sources are copied byte-for-byte by the packager.
import esbuild from '../cloud/api/node_modules/esbuild/lib/main.js';
import { builtinModules } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(project, 'cloud/api');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Expected an absolute staging directory');
await mkdir(output, { recursive: true });
const result = await esbuild.build({
  absWorkingDir: source,
  entryPoints: ['vendor.mjs'],
  outfile: path.join(output, 'vendor.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  minify: false, keepNames: true, metafile: true, legalComments: 'eof',
  banner: { js: [
    '// Generated SDK bundle. WebCAD business logic is in the adjacent source modules.',
    'import { createRequire as __webcadCreateRequire } from "node:module";',
    'import { fileURLToPath as __webcadFileURLToPath } from "node:url";',
    'const require = __webcadCreateRequire(import.meta.url);',
    'const __webcadGrpcDirectory = __webcadFileURLToPath(new URL("./runtime/grpc/build/src/", import.meta.url));',
  ].join('\n') },
  plugins: [{name: 'grpc-proto-paths', setup(build) {
    // These optional gRPC services load .proto assets relative to their original package directory.
    build.onLoad({filter: /[\\/]@grpc[\\/]grpc-js[\\/]build[\\/]src[\\/](?:orca|channelz)\.js$/}, async args => ({
      contents: (await readFile(args.path, 'utf8')).replaceAll('__dirname', '__webcadGrpcDirectory'), loader: 'js',
    }));
  }}],
});
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
for (const item of Object.values(result.metafile.outputs)) {
  for (const dependency of item.imports) {
    if (dependency.external && !builtins.has(dependency.path)) throw new Error(`Unbundled dependency: ${dependency.path}`);
  }
}
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  let dir = path.dirname(path.resolve(source, input));
  while (dir.startsWith(source + path.sep) && dir !== source) {
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      if (manifest.name) {packages.set(dir, manifest);break;}
    } catch { /* Continue to the package root. */ }
    dir = path.dirname(dir);
  }
}
let licenses = 'Third-party SDK dependencies included in vendor.mjs\n';
for (const [dir, manifest] of [...packages].sort((a,b) => a[1].name.localeCompare(b[1].name))) {
  licenses += `\n===== ${manifest.name} ${manifest.version} (${manifest.license ?? 'see license'}) =====\n`;
  for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE', 'NOTICE', 'NOTICE.txt']) {
    try {licenses += `\n${filename}\n${await readFile(path.join(dir, filename), 'utf8')}\n`;} catch { /* Not every package has every spelling. */ }
  }
}
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), licenses);
console.log(`Bundled ${packages.size} dependency packages into vendor.mjs`);
