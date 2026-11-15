// The embedded viewer's side of the protocol: the page's messages taken one at a time — a file shown at once, its
// answer sent when it is drawn (or why it is not), a repeated request answered again without showing it twice.

import { t } from '../i18n';
import {
  errorMessage,
  loadedMessage,
  progressMessage,
  readIncoming,
  readyMessage,
  type EmbedErrorCode,
  type EmbedFile,
  type EmbedParams,
  type EmbedStage,
  type OutgoingMessage,
} from './protocol';

/** Why a file is not shown, for the page: its code and a message for people (in the interface language). */
export class EmbedError extends Error {
  readonly code: EmbedErrorCode;
  constructor(code: EmbedErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface EmbedHost {
  /** To the page around the viewer (its origin exactly). */
  post(msg: OutgoingMessage): void;
  /**
   * Show the file: resolves once its model is drawn; an `EmbedError` says why not (anything else: it failed to
   * build). `stage` tells the page what it is doing meanwhile.
   */
  show(file: EmbedFile, stage: (s: EmbedStage) => void): Promise<void>;
}

/** What the page is told of each stage (in the interface language). */
const STAGE_TEXT: Record<EmbedStage, string> = { kernel: 'Loading geometry kernel…', building: 'Building the model…' };

/** What became of a message (for tests and the console). */
export type Received = 'ignored' | 'waiting' | 'repeated' | 'answered' | 'busy' | 'started';

export class EmbedSession {
  /** The request being shown now (one at a time). */
  private busy: string | null = null;
  /** The answers sent, by request: a repeated request gets its answer again. */
  private answers = new Map<string, OutgoingMessage>();
  private readonly params: EmbedParams;
  private readonly parent: unknown;
  private readonly host: EmbedHost;

  constructor(params: EmbedParams, parent: unknown, host: EmbedHost) {
    this.params = params;
    this.parent = parent;
    this.host = host;
  }

  /** The viewer listens and can take a file. */
  ready() {
    this.host.post(readyMessage(this.params.channel));
  }

  receive(ev: { source: unknown; origin: string; data: unknown }): Received {
    const m = readIncoming(ev, this.parent, this.params);
    if (m.kind === 'ignored') return 'ignored';
    const sent = this.answers.get(m.requestId);
    if (sent) {
      this.host.post(sent);
      return 'repeated';
    }
    // being shown: its answer comes once it is drawn
    if (this.busy === m.requestId) return 'waiting';
    if (m.kind === 'invalid') {
      this.answer(m.requestId, errorMessage(this.params.channel, m.requestId, m.code, t(m.message)));
      return 'answered';
    }
    if (this.busy) {
      // not remembered: the same request may come again once the viewer is free
      this.host.post(errorMessage(this.params.channel, m.requestId, 'BUSY', t('Another file is being opened: try again once it is shown')));
      return 'busy';
    }
    this.busy = m.requestId;
    void this.show(m.requestId, m.file);
    return 'started';
  }

  private async show(requestId: string, file: EmbedFile) {
    let msg: OutgoingMessage;
    // each stage once, and only while the file is being shown (never after its answer)
    let last: EmbedStage | null = null;
    const stage = (s: EmbedStage) => {
      if (this.busy !== requestId || s === last) return;
      last = s;
      this.host.post(progressMessage(this.params.channel, requestId, s, t(STAGE_TEXT[s])));
    };
    try {
      await this.host.show(file, stage);
      msg = loadedMessage(this.params.channel, requestId);
    } catch (e) {
      if (e instanceof EmbedError) msg = errorMessage(this.params.channel, requestId, e.code, e.message);
      else {
        // its text may be anything (the kernel's): only the console has it
        console.error('The embedded viewer could not show the file', e);
        msg = errorMessage(this.params.channel, requestId, 'BUILD_FAILED', t('The model could not be built'));
      }
    }
    this.busy = null;
    this.answer(requestId, msg);
  }

  private answer(requestId: string, msg: OutgoingMessage) {
    this.answers.set(requestId, msg);
    this.host.post(msg);
  }
}
