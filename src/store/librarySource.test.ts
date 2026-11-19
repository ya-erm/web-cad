import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySourceSnapshot, LibrarySourceChange } from './persistence';
const f=vi.hoisted(()=>({
  records:[] as any[],snapshots:new Map<string,any>(),entries:new Map<string,any>(),current:null as {id:string}|null,
  commits:vi.fn(),load:vi.fn(),write:vi.fn(),beforeCommit:null as ((change:any)=>void)|null,
}));
vi.mock('./docStore',()=>({useDoc:{getState:()=>({doc:f.current,loadList:f.load})}}));
vi.mock('./folderStore',()=>({
  useFolder:{getState:()=>({folders:[{id:'disk',access:true,dir:{getDirectoryHandle:async()=>{throw new Error('Unexpected subfolder');},getFileHandle:async(path:string)=>f.entries.get(path)}}]})},
  readProject:(raw:any)=>{if(!raw?.units||!Array.isArray(raw.tabs))throw new Error('Invalid project file');const {versions=[],workspaces=[],thumbnail,...doc}=raw;return {doc,versions:[...versions,...workspaces.map((workspace:any)=>({...workspace,kind:'workspace'}))],thumbnail};},
}));
vi.mock('./versions',()=>({withCopiedVersions:(doc:any,ids:Map<string,string>)=>({...doc,...doc.workspace?{workspace:{...doc.workspace,...doc.workspace.base?{base:ids.get(doc.workspace.base)??doc.workspace.base}:{}}}:{}})}));
const token=(records:any[])=>records.map(record=>`${record.id}:${record.generation}`).sort().join('|');
vi.mock('./persistence',()=>({
  listLibrarySources:async()=>[...f.records],librarySourceToken:(records:any[])=>token(records),
  cloudUploadSnapshot:async(id:string)=>{const snapshot=f.snapshots.get(id);if(!snapshot)throw new Error('Document not found');return structuredClone(snapshot);},
  applyLibrarySourceChange:(change:any)=>f.commits(change),
}));
import { copyFolderFileToLibrary,librarySourceCanonical,librarySourceContent } from './librarySource';
import { t } from '../i18n';
function project(){return {id:'same-embedded-id',name:'Disk model',created:1,modified:1,version:1,units:{length:'mm',angle:'deg'},tabs:[{id:'ps',type:'partStudio',name:'Part Studio',features:[],parts:{},rollback:null}],activeTab:'ps',versions:[{id:'v1',name:'Version one',created:1,units:{length:'mm',angle:'deg'},tabs:[],activeTab:''}]};}
let raw:any;
function file(path:string,identity=path){
  const handle:any={name:path,identity,createWritable:f.write,isSameEntry:async(other:any)=>other.identity===identity,
    getFile:async()=>{const text=JSON.stringify(raw);return {size:text.length,text:async()=>text};}};
  f.entries.set(path,handle);return handle;
}
function target(){return f.snapshots.get(f.records[0].localId);}
function changeLocal(){const snapshot=target();snapshot.doc.tabs[0].name='Local tab edit';snapshot.summary.modified++;}
function changeSource(){raw.tabs[0].name='Incoming tab edit';}
beforeEach(()=>{
  f.records=[];f.snapshots.clear();f.entries.clear();f.current=null;f.beforeCommit=null;vi.clearAllMocks();raw=project();file('part.webcad.json');
  f.commits.mockImplementation(async(change:LibrarySourceChange)=>{
    f.beforeCommit?.(change);
    if(change.sourceToken!==token(f.records)||!change.canApply())return null;
    const expected=change.expected,current=expected?f.snapshots.get(expected.doc.id):undefined;
    if(expected&&(!current||current.summary.trashed!==expected.summary.trashed||(current.summary.versionsModified??0)!==(expected.summary.versionsModified??0)||
      JSON.stringify([current.doc.units,current.doc.tabs,current.doc.workspace??null])!==JSON.stringify([expected.doc.units,expected.doc.tabs,expected.doc.workspace??null])))return null;
    if(change.mode==='create'&&f.snapshots.has(change.source.localId))return null;
    if(change.mode!=='remember'){
      const replacing=change.mode==='replace',now=Math.max(Date.now(),(current?.summary.modified??0)+1);
      const doc={...change.doc,id:change.source.localId,modified:now,...replacing?{name:current.doc.name,created:current.doc.created}:{}};
      const summary=replacing?{...current.summary,modified:now,versionsModified:now}:{id:doc.id,name:doc.name,created:doc.created,modified:now,versionsModified:now};
      f.snapshots.set(doc.id,{doc,summary,versions:change.versions??[]});
    }
    f.records=f.records.filter(record=>record.id!==change.source.id);f.records.push(change.source);
    const snapshot=f.snapshots.get(change.source.localId);return {localId:snapshot.doc.id,folderId:snapshot.summary.folderId??''};
  });
});
describe('one-way managed copies of disk files',()=>{
  it('creates one independent copy without opening/linking/writing the source and reuses it',async()=>{
    const first=await copyFolderFileToLibrary('disk','part.webcad.json');expect(first?.kind).toBe('created');expect(first?.localId).not.toBe(raw.id);
    expect(target().versions[0].id).not.toBe('v1');expect(f.write).not.toHaveBeenCalled();expect(f.current).toBe(null);
    const again=await copyFolderFileToLibrary('disk','part.webcad.json');expect(again?.localId).toBe(first?.localId);expect(again?.kind).toBe('unchanged');expect(f.snapshots.size).toBe(1);
  });
  it('does not confuse two physical files which contain the same embedded document id',async()=>{
    const first=await copyFolderFileToLibrary('disk','part.webcad.json');file('other.webcad.json');
    const other=await copyFolderFileToLibrary('disk','other.webcad.json');expect(other?.localId).not.toBe(first?.localId);expect(f.snapshots.size).toBe(2);
  });
  it('matches atomic replacement at the same path, and a renamed handle at a different path',async()=>{
    const first=await copyFolderFileToLibrary('disk','part.webcad.json');file('part.webcad.json','replacement');raw.versions[0].description='External named-version change';
    expect((await copyFolderFileToLibrary('disk','part.webcad.json'))?.localId).toBe(first?.localId);
    file('renamed.webcad.json','replacement');expect((await copyFolderFileToLibrary('disk','renamed.webcad.json'))?.localId).toBe(first?.localId);expect(f.records[0].path).toBe('renamed.webcad.json');
  });
  it('refreshes a version-only source edit while preserving managed organisation, cloud identity and old versions',async()=>{
    await copyFolderFileToLibrary('disk','part.webcad.json');const current=target();current.doc.name=current.summary.name='Managed name';current.summary.folderId='managed-folder';current.summary.modified++;
    current.summary.cloudSource={userId:'owner',documentId:'cloud-id',revision:'r1',savedModified:current.summary.modified};
    const oldVersion=current.versions[0].id;raw.versions[0].name='Version renamed outside';const resolve=vi.fn();
    const result=await copyFolderFileToLibrary('disk','part.webcad.json',resolve);expect(resolve).not.toHaveBeenCalled();expect(result).toMatchObject({kind:'updated',folderId:'managed-folder'});
    expect(target().doc.name).toBe('Managed name');expect(target().summary.cloudSource.documentId).toBe('cloud-id');expect(target().versions.some((version:any)=>version.id===oldVersion)).toBe(true);expect(target().versions.some((version:any)=>version.name==='Version renamed outside')).toBe(true);
  });
  it('cancel changes neither the model nor provenance, and local choice remembers only the ignored incoming version',async()=>{
    await copyFolderFileToLibrary('disk','part.webcad.json');changeLocal();changeSource();const before=f.records[0],model=JSON.stringify(target());f.commits.mockClear();
    expect(await copyFolderFileToLibrary('disk','part.webcad.json',async()=>null)).toBe(null);expect(f.commits).not.toHaveBeenCalled();expect(f.records[0]).toBe(before);expect(JSON.stringify(target())).toBe(model);
    const choose=vi.fn(async()=> 'local' as const);await copyFolderFileToLibrary('disk','part.webcad.json',choose);expect(f.records[0].sourceHash).toBe(before.sourceHash);expect(f.records[0].targetHash).toBe(before.targetHash);expect(f.records[0].ignoredSourceHash).toBeDefined();
    await copyFolderFileToLibrary('disk','part.webcad.json',choose);expect(choose).toHaveBeenCalledTimes(1);
    raw.tabs[0].name='Another external edit';await copyFolderFileToLibrary('disk','part.webcad.json',choose);expect(choose).toHaveBeenCalledTimes(2);
  });
  it('both transfers the association to a new independent copy and leaves the old edited model untouched',async()=>{
    const original=await copyFolderFileToLibrary('disk','part.webcad.json');changeLocal();changeSource();const old=JSON.stringify(target());
    const both=await copyFolderFileToLibrary('disk','part.webcad.json',async()=> 'both');expect(both?.kind).toBe('both');expect(both?.localId).not.toBe(original?.localId);expect(JSON.stringify(f.snapshots.get(original!.localId))).toBe(old);
    expect((await copyFolderFileToLibrary('disk','part.webcad.json'))?.localId).toBe(both?.localId);expect(f.snapshots.size).toBe(2);
  });
  it('rejects unseen source changes made while the conflict decision is pending',async()=>{
    await copyFolderFileToLibrary('disk','part.webcad.json');changeLocal();changeSource();let prompts=0;
    await copyFolderFileToLibrary('disk','part.webcad.json',async()=>{if(++prompts===1)raw.tabs[0].name='Newer unseen edit';return 'incoming';});
    expect(prompts).toBe(2);expect(target().doc.tabs[0].name).toBe('Newer unseen edit');
  });
  it('rechecks a same-timestamp persisted edit at CAS and asks again instead of clobbering it',async()=>{
    await copyFolderFileToLibrary('disk','part.webcad.json');changeLocal();changeSource();let prompts=0;
    f.beforeCommit=()=>{f.beforeCommit=null;target().doc.tabs[0].name='Edit during import';};
    await copyFolderFileToLibrary('disk','part.webcad.json',async conflict=>{prompts++;if(prompts===2)expect(conflict.reason).toBe('raced');return 'incoming';});expect(prompts).toBe(2);
  });
  it('never overwrites an open target; both remains safe',async()=>{
    const initial=await copyFolderFileToLibrary('disk','part.webcad.json');f.current={id:initial!.localId};changeSource();
    await expect(copyFolderFileToLibrary('disk','part.webcad.json',async conflict=>{expect(conflict.targetOpen).toBe(true);return 'incoming';})).rejects.toThrow(t('Close the managed document before replacing it.'));
    const both=await copyFolderFileToLibrary('disk','part.webcad.json',async()=> 'both');expect(both?.kind).toBe('both');expect(f.current.id).toBe(initial!.localId);
  });
  it('creates a new independent target for a trashed/deleted destination without restoring it',async()=>{
    const initial=await copyFolderFileToLibrary('disk','part.webcad.json');target().summary.trashed=1;changeSource();
    const fresh=await copyFolderFileToLibrary('disk','part.webcad.json');expect(fresh?.localId).not.toBe(initial?.localId);expect(f.snapshots.get(initial!.localId).summary.trashed).toBe(1);
  });
  it('copies workspace snapshots and remaps their saved-version bases independently of the disk file', async () => {
    raw.workspace = {id:'active-branch',name:'Active branch',base:'v1'};
    raw.workspaces = [{id:'other-branch',name:'Other branch',base:'v1',created:1,units:raw.units,tabs:raw.tabs,activeTab:'ps'}];
    await copyFolderFileToLibrary('disk','part.webcad.json');
    const named = target().versions.find((version:any)=>version.kind!=='workspace');
    const workspace = target().versions.find((version:any)=>version.kind==='workspace');
    expect(named.id).not.toBe('v1');expect(workspace.id).toBe('other-branch');
    expect(workspace.base).toBe(named.id);expect(target().doc.workspace.base).toBe(named.id);
  });
  it('refreshes exported Main in place while preserving active branch identity and local-only branches', async () => {
    raw.workspace={id:'source-branch',name:'Source branch',base:'v1'};
    raw.workspaces=[{id:'main',name:'Main',created:1,units:raw.units,tabs:structuredClone(raw.tabs),activeTab:'ps'}];
    await copyFolderFileToLibrary('disk','part.webcad.json');
    expect(target().doc.workspace.id).toBe('source-branch');expect(target().versions.find((version:any)=>version.kind==='workspace').id).toBe('main');
    raw.workspaces[0].tabs[0].name='New source Main';
    await copyFolderFileToLibrary('disk','part.webcad.json');
    expect(target().versions.filter((version:any)=>version.kind==='workspace'&&version.id==='main')).toHaveLength(1);
    expect(target().versions.find((version:any)=>version.id==='main').tabs[0].name).toBe('New source Main');
    target().versions.push({id:'local-branch',kind:'workspace',name:'Local only',created:1,units:raw.units,tabs:[],activeTab:''});target().summary.versionsModified++;
    raw.workspaces[0].tabs[0].name='Latest source Main';
    await copyFolderFileToLibrary('disk','part.webcad.json',async()=> 'incoming');
    expect(target().versions.some((version:any)=>version.id==='local-branch')).toBe(true);
    expect(target().versions.filter((version:any)=>version.id==='main')).toHaveLength(1);
  });
  it('retains a departing active workspace when the source switches branch without exporting its previous state', async () => {
    await copyFolderFileToLibrary('disk','part.webcad.json');const oldTab=target().doc.tabs[0].name;
    raw.workspace={id:'new-branch',name:'New branch',base:'v1'};raw.tabs[0].name='New active content';
    await copyFolderFileToLibrary('disk','part.webcad.json');
    expect(target().doc.workspace.id).toBe('new-branch');expect(target().versions.find((version:any)=>version.kind==='workspace'&&version.id==='main').tabs[0].name).toBe(oldTab);
  });
  it('does not expose source JSON snippets when parsing a damaged file fails', async () => {
    f.entries.get('part.webcad.json').getFile=async()=>({size:40,text:async()=>'{"private":"do-not-show" invalid'});
    await expect(copyFolderFileToLibrary('disk','part.webcad.json')).rejects.toThrow(t('Invalid project file'));
    expect(f.commits).not.toHaveBeenCalled();
  });
  it('excludes organisation, timestamps and JSON key order from fingerprints but includes versions/workspaces',()=>{
    const doc=project(),version=doc.versions[0];const first=librarySourceCanonical(librarySourceContent(doc as any,[version as any]));
    expect(librarySourceCanonical(librarySourceContent({...doc,id:'new',name:'Renamed',modified:999,activeTab:'other'} as any,[version as any]))).toBe(first);
    expect(librarySourceCanonical(librarySourceContent(doc as any,[{...version,name:'Changed'} as any]))).not.toBe(first);
    expect(librarySourceCanonical({b:2,a:1})).toBe(librarySourceCanonical({a:1,b:2}));
  });
});

describe('persisted source target CAS comparison',()=>{
  it('ignores organisation/cloud ACKs, but detects geometry, workspace, version and trash changes',async()=>{
    const {sameLibrarySourceTarget}=await vi.importActual<typeof import('./persistence')>('./persistence');
    const doc=project() as any,expected={doc,summary:{id:doc.id,name:doc.name,created:1,modified:1,versionsModified:10},versions:[]} as LibrarySourceSnapshot;
    expect(sameLibrarySourceTarget(expected,{...doc,name:'Moved and renamed',modified:2},{...expected.summary,name:'Moved and renamed',folderId:'folder',modified:2,cloudSource:{userId:'u',documentId:'remote',revision:'new'}})).toBe(true);
    expect(sameLibrarySourceTarget(expected,{...doc,units:{length:'cm',angle:'deg'}},expected.summary)).toBe(false);
    expect(sameLibrarySourceTarget(expected,{...doc,workspace:{id:'branch',name:'Branch'}},expected.summary)).toBe(false);
    expect(sameLibrarySourceTarget(expected,doc,{...expected.summary,versionsModified:11})).toBe(false);
    expect(sameLibrarySourceTarget(expected,doc,{...expected.summary,trashed:1})).toBe(false);
  });
});
