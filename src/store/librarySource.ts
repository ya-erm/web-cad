// Explicit, one-way imports from disk. Managed copies never become writable FileLink documents.
import type { CadDocument, ProjectVersion } from '../core/types';
import { docId, uid } from '../core/ids';
import { useDoc } from './docStore';
import { readProject, useFolder } from './folderStore';
import { withCopiedVersions } from './versions';
import * as db from './persistence';
import { t } from '../i18n';

export type LibrarySourceResolution = 'local' | 'incoming' | 'both' | null;
export interface LibrarySourceConflict {
  sourceName: string;
  targetName: string;
  targetOpen: boolean;
  localId: string;
  reason: 'changed' | 'open' | 'raced';
}
export interface LibrarySourceResult {
  localId: string;
  folderId: string;
  kind: 'created' | 'updated' | 'unchanged' | 'local' | 'both';
}
export type LibrarySourceResolver = (conflict: LibrarySourceConflict) => Promise<LibrarySourceResolution>;

/** Stable JSON ignores object insertion order, preserving meaningful array order. */
export function librarySourceCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(librarySourceCanonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + librarySourceCanonical(object[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
function versionBody(version: ProjectVersion) {
  return {kind:version.kind ?? 'version',name:version.name,description:version.description,base:version.base,units:version.units,tabs:version.tabs};
}
/** Names/folders/timestamps/view state are organisation, not a model-content conflict. */
export function librarySourceContent(doc: CadDocument, versions: ProjectVersion[]) {
  return {units:doc.units,tabs:doc.tabs,workspace:doc.workspace ?? null,
    versions:versions.map(version => ({id:version.id,...versionBody(version)}))
      .sort((a,b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))};
}
export async function librarySourceFingerprint(doc: CadDocument, versions: ProjectVersion[]): Promise<string> {
  return digest(librarySourceCanonical(librarySourceContent(doc,versions)));
}
async function digest(text:string):Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function versionKey(version:ProjectVersion) {return `${version.kind ?? 'version'}:${version.id}`;}
function validateProject(doc:CadDocument, versions:ProjectVersion[]) {
  if(typeof doc.name!=='string'||!doc.units||!Array.isArray(doc.tabs)||!Number.isFinite(doc.created)||!Number.isFinite(doc.modified))throw new Error(t('Invalid project file'));
  const keys=new Set<string>();
  for(const version of versions) {
    if(!version||typeof version.id!=='string'||!version.id||typeof version.name!=='string'||(version.kind!==undefined&&version.kind!=='workspace')||!version.units||!Array.isArray(version.tabs)||!Number.isFinite(version.created))throw new Error(t('Invalid project version'));
    const key=versionKey(version);if(keys.has(key))throw new Error(t('Duplicate project version'));keys.add(key);
  }
}
async function readSourceBytes(root:FileSystemDirectoryHandle,path:string) {
  const parts=path.split('/');
  let directory=root;
  for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);
  const handle=await directory.getFileHandle(parts.at(-1)!);
  const file=await handle.getFile();
  if(file.size>100*1024*1024)throw new Error(t('The project is too large to import.'));
  const text=await file.text();
  return {text,handle};
}
async function readSource(root:FileSystemDirectoryHandle,path:string) {
  const {text,handle}=await readSourceBytes(root,path);
  let parsed: ReturnType<typeof readProject>;
  try {
    parsed = readProject(JSON.parse(text), path.split('/').at(-1)!.replace(/\.webcad\.json$/i, ''));
  } catch {
    throw new Error(t('Invalid project file'));
  }
  validateProject(parsed.doc,parsed.versions);
  return {...parsed,text,handle,hash:await librarySourceFingerprint(parsed.doc,parsed.versions)};
}
async function matchSource(records:db.LibrarySourceRecord[],folderId:string,path:string,handle:FileSystemFileHandle) {
  const matches=records.filter(record=>record.folderId===folderId&&record.path===path);
  for(const record of records)if(!matches.includes(record)&&await record.fileHandle.isSameEntry(handle).catch(()=>false))matches.push(record);
  if(matches.length>1)throw new Error(t('This file matches multiple managed copies. Choose another source file.'));
  return matches[0];
}
/** Reuse unchanged immutable snapshots; changed snapshots/dependants receive new ids. */
async function remapProject(doc:CadDocument,versions:ProjectVersion[],previous:db.LibrarySourceRecord['versionMap']) {
  const map:db.LibrarySourceRecord['versionMap']={...previous}, fresh=new Set<string>();
  for(const version of versions){
    const key=versionKey(version),hash=await digest(librarySourceCanonical(versionBody(version)));
    if(version.kind==='workspace'){
      // Workspace ids are scoped by the destination document; main must keep its reserved identity.
      map[key]={id:version.id,hash};fresh.add(key);
    }else if(!map[key]||map[key].hash!==hash){map[key]={id:uid('vr'),hash};fresh.add(key);}
  }
  const named=()=>new Map(versions.filter(version=>version.kind!=='workspace').map(version=>[version.id,map[versionKey(version)].id]));
  const remapVersion=(version:ProjectVersion):ProjectVersion=>{
    const ids=named();
    return {...version,id:map[versionKey(version)].id,tabs:withCopiedVersions({...doc,tabs:version.tabs},ids).tabs,
      ...(version.base?{base:ids.get(version.base)??version.base}:{})};
  };
  // A renamed dependency id also changes immutable snapshots which refer to it.
  for(let pass=0;pass<=versions.length;pass++){
    let changed=false;
    for(const version of versions){
      const key=versionKey(version),mappedHash=await digest(librarySourceCanonical(versionBody(remapVersion(version))));
      if(!fresh.has(key)&&map[key].mappedHash!==mappedHash){map[key]={...map[key],id:uid('vr')};fresh.add(key);changed=true;}
    }
    if(!changed)break;
  }
  const copiedVersions=versions.map(remapVersion);
  for(let index=0;index<versions.length;index++)map[versionKey(versions[index])]={...map[versionKey(versions[index])],mappedHash:await digest(librarySourceCanonical(versionBody(copiedVersions[index])))};
  const copied=withCopiedVersions(doc,named());
  if(copied.workspace){
    const workspace=map[`workspace:${copied.workspace.id}`];
    if(workspace)copied.workspace={...copied.workspace,id:workspace.id};
  }
  return {doc:copied,versions:copiedVersions,map};
}
function unionVersions(existing:ProjectVersion[],incoming:ProjectVersion[]):ProjectVersion[] {
  const out=new Map(existing.map(version=>[versionKey(version),version]));
  for(const version of incoming)if(version.kind==='workspace'||!out.has(versionKey(version)))out.set(versionKey(version),version);
  return [...out.values()];
}
/** Preserve the current branch if the incoming file switches away without exporting that branch. */
function retainedWorkspaces(target:db.LibrarySourceSnapshot,incoming:CadDocument,versions:ProjectVersion[]):ProjectVersion[] {
  const previous=target.doc.workspace??{id:'main',name:'Main'};
  const next=incoming.workspace?.id??'main';
  if(previous.id===next||versions.some(version=>version.kind==='workspace'&&version.id===previous.id))return target.versions;
  const retained:ProjectVersion={id:previous.id,kind:'workspace',name:previous.name,...previous.base?{base:previous.base}:{},created:Date.now(),units:target.doc.units,tabs:target.doc.tabs,activeTab:target.doc.activeTab};
  return unionVersions(target.versions,[retained]);
}
function publishLocalChange() {
  if(typeof window!=='undefined')window.dispatchEvent(new Event('webcad:cloud-changed'));
}

/** Reads the selected disk file, never opening it as a writable linked document. */
export async function copyFolderFileToLibrary(folderId:string,path:string,resolveConflict?:LibrarySourceResolver):Promise<LibrarySourceResult|null> {
  if(typeof folderId!=='string'||!folderId||typeof path!=='string'||!path||path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\\u0000-\u001f]/.test(path))throw new Error(t('Invalid source file path.'));
  const root=useFolder.getState().folders.find(folder=>folder.id===folderId);
  if(!root?.access)throw new Error(t('Allow access to this folder first.'));
  let raced=false;
  for(let attempt=0;attempt<5;attempt++){
    const incoming=await readSource(root.dir,path);
    const records=await db.listLibrarySources(),previous=await matchSource(records,folderId,path,incoming.handle);
    let target:db.LibrarySourceSnapshot|undefined;
    if(previous){
      try{target=await db.cloudUploadSnapshot(previous.localId);}catch{ /* A permanently deleted target becomes a new independent copy. */ }
    }
    const available=target&&!target.summary.trashed?target:undefined;
    const targetOpen=Boolean(available&&useDoc.getState().doc?.id===available.doc.id);
    const localHash=available?await librarySourceFingerprint(available.doc,available.versions):'';
    let choice:LibrarySourceResolution=available?'incoming':'both';
    let kind:LibrarySourceResult['kind']=available?'updated':'created';
    const sameIncoming=Boolean(previous&&(incoming.hash===previous.sourceHash||incoming.hash===previous.ignoredSourceHash));
    if(available&&sameIncoming){choice='local';kind=incoming.hash===previous!.ignoredSourceHash?'local':'unchanged';}
    else if(available&&(targetOpen||localHash!==previous!.targetHash)){
      if(!resolveConflict)throw new Error(t('Choose which version to keep.'));
      choice=await resolveConflict({sourceName:incoming.doc.name,targetName:available.summary.name,targetOpen,localId:available.doc.id,reason:raced?'raced':targetOpen?'open':'changed'});
      if(choice===null)return null;
      if(!['local','incoming','both'].includes(choice))throw new Error(t('Invalid conflict resolution.'));
      kind=choice==='local'?'local':choice==='both'?'both':'updated';
    }
    const source:db.LibrarySourceRecord={id:previous?.id??crypto.randomUUID(),generation:crypto.randomUUID(),localId:available?.doc.id??docId(),folderId,path,fileHandle:incoming.handle,
      sourceHash:previous?.sourceHash??incoming.hash,targetHash:previous?.targetHash??'',versionMap:previous?.versionMap??{}};
    let mode:db.LibrarySourceChange['mode']='remember',candidate:CadDocument|undefined,versions:ProjectVersion[]|undefined;
    if(choice==='local'&&available){
      if(!sameIncoming)source.ignoredSourceHash=incoming.hash;
      else if(previous?.ignoredSourceHash)source.ignoredSourceHash=previous.ignoredSourceHash;
    }else{
      if(choice==='incoming'&&useDoc.getState().doc?.id===available?.doc.id)throw new Error(t('Close the managed document before replacing it.'));
      const creating=!available||choice==='both';
      source.localId=creating?docId():available.doc.id;
      const remapped=await remapProject(incoming.doc,incoming.versions,creating?{}:source.versionMap);
      candidate={...remapped.doc,id:source.localId,created:Date.now(),modified:Date.now()};
      versions=unionVersions(creating?[]:retainedWorkspaces(available!,candidate,remapped.versions),remapped.versions);
      source.sourceHash=incoming.hash;source.targetHash=await librarySourceFingerprint(candidate,versions);source.versionMap=remapped.map;
      mode=creating?'create':'replace';
      if(!available)kind='created';
    }
    // Recheck after both the dialog and asynchronous hashing/remapping. Never acknowledge unseen file bytes.
    const fresh=await readSourceBytes(root.dir,path);
    if(fresh.text!==incoming.text){raced=true;continue;}
    source.fileHandle=fresh.handle;
    const applied=await db.applyLibrarySourceChange({sourceToken:db.librarySourceToken(records),source,expected:target,mode,doc:candidate,versions,thumbnail:incoming.thumbnail,
      canApply:()=>mode!=='replace'||useDoc.getState().doc?.id!==source.localId});
    if(!applied){raced=true;continue;}
    await useDoc.getState().loadList();publishLocalChange();
    return {...applied,kind};
  }
  throw new Error(t('The file or managed copy changed during import. Try again.'));
}
