import { lazy, Suspense, useEffect, useState } from 'react';
import { useDoc } from './store/docStore';
import { DocumentsPage } from './ui/DocumentsPage';
import { Editor } from './ui/Editor';
import { requestPersistentStorage } from './store/persistence';
import { startFolder } from './store/folderStore';
import { startVersions } from './store/versions';
import { startCompare } from './store/compare';
import { TooltipLayer } from './ui/Tooltip';
import { isHelpHash } from './help/toc';

// Help (#/help/<lang>/<page>) is a separate chunk, loaded only when opened.
const HelpPage = lazy(() => import('./help/HelpPage'));

function docIdFromHash() {
  const m = /^#\/doc\/([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

export default function App() {
  const [docId, setDocId] = useState<string | null>(docIdFromHash());
  const doc = useDoc((s) => s.doc);
  const [missing, setMissing] = useState(false);
  const [help, setHelp] = useState(isHelpHash(location.hash));

  useEffect(() => {
    void requestPersistentStorage();
    // a folder on the computer chosen earlier (Chrome / Edge): its linked documents are saved to their files
    void startFolder();
    // versions and history of the open document
    startVersions();
    startCompare();
    const onHash = () => {
      setDocId(docIdFromHash());
      setHelp(isHelpHash(location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!docId) {
      if (useDoc.getState().doc) useDoc.getState().closeDocument();
      return;
    }
    if (useDoc.getState().doc?.id === docId) return;
    void useDoc
      .getState()
      .openDocument(docId)
      .then((ok) => {
        if (!ok) {
          setMissing(true);
          location.hash = '';
        }
      });
  }, [docId]);

  useEffect(() => {
    if (help) return; // the help page sets its own title
    if (doc) document.title = `${doc.name} — WebCAD`;
    else document.title = 'WebCAD';
  }, [doc, help]);

  void missing;
  if (help)
    return (
      <Suspense fallback={null}>
        <HelpPage />
      </Suspense>
    );
  return (
    <>
      {docId && doc?.id === docId ? (
        <Editor onBack={() => (location.hash = '')} />
      ) : docId ? null : (
        <DocumentsPage onOpen={(id) => (location.hash = `#/doc/${id}`)} />
      )}
      <TooltipLayer />
    </>
  );
}
