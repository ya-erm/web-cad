// Cloud commands share the selected WebCAD tab's authenticated browser session.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CLOUD_USAGE = `Cloud (an authenticated WebCAD tab; use WEBCAD_CDP_URL for https://cad.ya-erm.ru):
  cloud status | list
  cloud upload [local-id|name] [--folder cloud-folder-id] [--copy]
        [--expected-revision revision --expected-modified timestamp]
  cloud upload-file <project.webcad.json> [--folder cloud-folder-id]
  cloud download <cloud-id> <out.webcad.json> [--overwrite]
  cloud open <cloud-id>             download to the library and open, preserving changed local variants
  cloud mkdir <name> [--parent cloud-folder-id]
  cloud sync [--wait milliseconds] [--pause|--resume]
Uploads never silently replace a conflicting cloud version. Sync keeps its normal rate limits.
Downloads do not change the active model. Existing output files require --overwrite.`;

function parse(args, schema, count) {
  const positional = [],
    options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const type = schema[a];
    if (!type) throw new Error(`Unknown cloud option ${a}`);
    if (Object.hasOwn(options, a)) throw new Error(`Repeated cloud option ${a}`);
    if (type === 'boolean') {
      options[a] = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`Value required for ${a}`);
    if (type === 'number') {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Non-negative integer required for ${a}`);
      options[a] = n;
    } else options[a] = value;
  }
  if (positional.length < count[0] || positional.length > count[1]) throw new Error(CLOUD_USAGE);
  return { positional, options };
}

export async function runCloudCommand(args, { call, out }) {
  const [command, ...rest] = args;
  switch (command) {
    case 'status':
    case 'list': {
      parse(rest, {}, [0, 0]);
      return out(await call(command === 'status' ? 'cloudStatus' : 'cloudList'));
    }
    case 'upload': {
      const { positional, options: o } = parse(
        rest,
        { '--folder': 'string', '--copy': 'boolean', '--expected-revision': 'string', '--expected-modified': 'number' },
        [0, 1],
      );
      if ((o['--expected-revision'] === undefined) !== (o['--expected-modified'] === undefined))
        throw new Error('Supply both --expected-revision and --expected-modified');
      if (o['--copy'] && o['--expected-revision'] !== undefined) throw new Error('--copy cannot replace a cloud revision');
      const options = {
        ...(o['--folder'] !== undefined ? { folderId: o['--folder'] } : {}),
        ...(o['--copy'] ? { asCopy: true } : {}),
        ...(o['--expected-revision'] !== undefined
          ? { expectedRevision: o['--expected-revision'], expectedModified: o['--expected-modified'] }
          : {}),
      };
      return out(await call('cloudUpload', positional[0] ?? null, options));
    }
    case 'upload-file': {
      const { positional, options: o } = parse(rest, { '--folder': 'string' }, [1, 1]);
      let raw;
      try { raw = JSON.parse(readFileSync(resolve(positional[0]), 'utf8')); } catch { throw Error('Invalid project JSON or unreadable project file'); }
      return out(await call('cloudUploadFile', raw, o['--folder'] === undefined ? {} : { folderId: o['--folder'] }));
    }
    case 'download': {
      const {
        positional: [id, file],
        options: o,
      } = parse(rest, { '--overwrite': 'boolean' }, [2, 2]);
      // Reserve the destination before requesting data, so an existing file fails without a network download.
      const path = resolve(file);
      const { openSync, closeSync, unlinkSync } = await import('node:fs');
      let fd;
      if (!o['--overwrite']) fd = openSync(path, 'wx', 0o600);
      try {
        const result = await call('cloudDownload', id);
        if (result?.mime !== 'application/json' || typeof result.base64 !== 'string') throw new Error('Invalid cloud download response');
        writeFileSync(fd ?? path, Buffer.from(result.base64, 'base64'), { mode: 0o600 });
        out({ saved: path, mime: result.mime });
      } catch (error) {
        if (fd !== undefined) {
          closeSync(fd);
          fd = undefined;
          unlinkSync(path);
        }
        throw error;
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
      return;
    }
    case 'open': {
      const { positional } = parse(rest, {}, [1, 1]);
      return out(await call('cloudOpen', positional[0]));
    }
    case 'mkdir': {
      const { positional, options: o } = parse(rest, { '--parent': 'string' }, [1, 1]);
      return out(await call('cloudCreateFolder', positional[0], o['--parent'] ?? ''));
    }
    case 'sync': {
      const { options: o } = parse(rest, { '--wait': 'number', '--pause': 'boolean', '--resume': 'boolean' }, [0, 0]);
      if (o['--pause'] && o['--resume']) throw new Error('Choose --pause or --resume');
      if ((o['--wait'] ?? 0) > 120000) throw new Error('--wait must be between 0 and 120000 milliseconds');
      return out(
        await call('cloudSync', {
          ...(o['--wait'] !== undefined ? { waitMs: o['--wait'] } : {}),
          ...(o['--pause'] ? { enabled: false } : {}),
          ...(o['--resume'] ? { enabled: true } : {}),
        }),
      );
    }
    default:
      throw new Error(CLOUD_USAGE);
  }
}
