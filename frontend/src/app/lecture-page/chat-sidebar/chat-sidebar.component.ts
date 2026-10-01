import { Component, Input, Output, EventEmitter, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { CitationListComponent } from '../citation-list/citation-list.component';
import { ChatService, Citation, QuerySSEPayload } from '../chat.service';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  citations?: Citation[];
  loading?: boolean;
}

@Component({
  selector: 'app-chat-sidebar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CitationListComponent],
  template: `
    <div class="chat-sidebar" role="region" aria-label="Lecture chat assistant">

      <!-- Header -->
      <div class="chat-header">
        <span class="chat-header-title">Ask the Lecture</span>
      </div>

      <!-- Message list -->
      <div class="message-list" #messageList aria-live="polite" aria-atomic="false">
        <div
          *ngFor="let msg of messages; let i = index"
          class="message-bubble"
          [class.message-user]="msg.role === 'user'"
          [class.message-assistant]="msg.role === 'assistant'"
          [class.message-error]="msg.role === 'error'"
          role="article"
          [attr.aria-label]="msg.role === 'user' ? 'You' : msg.role === 'error' ? 'Error' : 'Assistant'"
        >
          <div class="message-role-label">
            <span *ngIf="msg.role === 'user'">You</span>
            <span *ngIf="msg.role === 'assistant'">Assistant</span>
            <span *ngIf="msg.role === 'error'">Error</span>
          </div>

          <div class="message-content">
            <!-- Loading dots while streaming starts -->
            <span *ngIf="msg.loading && msg.content === ''" class="loading-dots" aria-label="Loading response">
              <span></span><span></span><span></span>
            </span>
            <!-- Content (streams in token by token) -->
            <span *ngIf="msg.content !== ''">{{ msg.content }}</span>
          </div>

          <!-- Citations (shown after done event) -->
          <app-citation-list
            [citations]="msg.citations || []"
            [isPlayerReady]="isPlayerReady"
            (seek)="onSeekRequest($event)"
          ></app-citation-list>
        </div>

        <!-- Empty state -->
        <div *ngIf="messages.length === 0" class="empty-state">
          Ask a question about this lecture.
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area">
        <!-- Validation error message -->
        <p
          *ngIf="questionControl.value !== null && questionControl.value !== '' && questionControl.hasError('maxlength')"
          class="input-error"
          role="alert"
        >
          Question must be 1–1000 characters.
        </p>

        <div class="input-row">
          <textarea
            [formControl]="questionControl"
            class="question-input"
            placeholder="Ask a question about this lecture…"
            rows="3"
            aria-label="Your question"
            (keydown.enter)="onEnterKey($event)"
          ></textarea>

          <button
            class="submit-button"
            [disabled]="questionControl.invalid || isLoading"
            (click)="onSubmit()"
            aria-label="Send question"
          >
            <span *ngIf="!isLoading">Send</span>
            <span *ngIf="isLoading" class="button-spinner" aria-hidden="true"></span>
          </button>
        </div>

        <p class="char-count" [class.char-count-warn]="(questionControl.value?.length ?? 0) > 900">
          {{ questionControl.value?.length ?? 0 }} / 1000
        </p>
      </div>

    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .chat-sidebar {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-surface-2);
      overflow: hidden;
    }

    /* ── Header ── */
    .chat-header {
      padding: 1rem 1.25rem 0.875rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .chat-header-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-faint);
    }

    /* ── Message list ── */
    .message-list {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .empty-state {
      text-align: center;
      color: var(--color-text-faint);
      font-size: 0.85rem;
      margin-top: 3rem;
      line-height: 1.6;
    }

    /* ── Bubbles ── */
    .message-bubble {
      max-width: 92%;
      padding: 0.625rem 0.875rem;
      border-radius: var(--radius-md);
      font-size: 0.875rem;
      line-height: 1.6;
      word-break: break-word;
    }

    .message-user {
      align-self: flex-end;
      background: var(--color-accent);
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .message-assistant {
      align-self: flex-start;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      border-bottom-left-radius: 4px;
    }

    .message-error {
      align-self: flex-start;
      background: var(--color-error-dim);
      border: 1px solid rgba(239,68,68,0.2);
      color: var(--color-error);
    }

    .message-role-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.3rem;
      opacity: 0.6;
    }

    .message-content { white-space: pre-wrap; }

    /* ── Loading dots ── */
    .loading-dots {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }

    .loading-dots span {
      display: inline-block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--color-text-faint);
      animation: dot-bounce 1.2s infinite ease-in-out;
    }

    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes dot-bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
      40%           { transform: scale(1);   opacity: 1;   }
    }

    /* ── Input area ── */
    .input-area {
      padding: 0.875rem 1rem;
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
      flex-shrink: 0;
    }

    .input-error {
      color: var(--color-error);
      font-size: 0.75rem;
      margin: 0 0 0.375rem;
    }

    .input-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
    }

    .question-input {
      flex: 1;
      padding: 0.625rem 0.75rem;
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text);
      font-size: 0.85rem;
      font-family: inherit;
      resize: none;
      line-height: 1.5;
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    .question-input::placeholder { color: var(--color-text-faint); }

    .question-input:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--color-accent-dim);
    }

    .submit-button {
      padding: 0.625rem 1rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-md);
      font-size: 0.85rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      min-width: 3.5rem;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition), opacity var(--transition);
      flex-shrink: 0;
    }

    .submit-button:hover:not(:disabled) { background: var(--color-accent-hover); }
    .submit-button:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Button spinner */
    .button-spinner {
      display: inline-block;
      width: 13px;
      height: 13px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .char-count {
      font-size: 0.68rem;
      color: var(--color-text-faint);
      text-align: right;
      margin: 0.3rem 0 0;
    }

    .char-count-warn { color: var(--color-warning); }
  `],
})
export class ChatSidebarComponent implements OnDestroy {
  @Input() courseId: string = '';
  @Input() lectureId: string = '';
  @Input() isPlayerReady = false;
  @Output() seekRequest = new EventEmitter<number>();

  messages: Message[] = [];
  isLoading = false;
  pendingCitations: Citation[] = [];

  questionControl = new FormControl('', [
    Validators.required,
    Validators.minLength(1),
    Validators.maxLength(1000),
  ]);

  /** Holds the active generator so it can be cancelled on destroy */
  private activeStream: AsyncGenerator<QuerySSEPayload> | null = null;

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly chatService = inject(ChatService);

  ngOnDestroy(): void {
    // Cancel any in-flight stream when the component is torn down
    this.activeStream?.return(undefined);
    this.activeStream = null;
  }

  /** Forward seek request from CitationListComponent up to the parent */
  onSeekRequest(seconds: number): void {
    this.seekRequest.emit(seconds);
  }

  /** Allow Shift+Enter for newline; plain Enter submits */
  onEnterKey(event: Event): void {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      if (!this.questionControl.invalid && !this.isLoading) {
        this.onSubmit();
      }
    }
  }

  async onSubmit(): Promise<void> {
    if (this.questionControl.invalid || this.isLoading) return;

    const question = (this.questionControl.value ?? '').trim();
    if (!question) return;

    // Append user message
    this.messages.push({ role: 'user', content: question });

    // Append assistant bubble immediately (ready for token streaming)
    this.messages.push({ role: 'assistant', content: '', loading: true });

    this.isLoading = true;
    this.pendingCitations = [];
    this.questionControl.reset('');
    this.cdr.detectChanges();

    await this.runStream(question);
  }

  private async runStream(question: string): Promise<void> {
    const stream = this.chatService.streamQuery(this.courseId, this.lectureId, question);
    this.activeStream = stream;

    try {
      for await (const payload of stream) {
        this.handleSSEPayload(payload);
        this.cdr.detectChanges();
      }
    } catch (err: unknown) {
      // Network or parse error — not an SSE error event
      const message =
        err instanceof Error ? err.message : 'Connection failed. Please try again.';
      this.finishWithError(message);
    } finally {
      this.activeStream = null;
    }
  }

  private handleSSEPayload(payload: QuerySSEPayload): void {
    switch (payload.type) {
      case 'token':
        this.appendToLastMessage(payload.content ?? '');
        break;

      case 'citations':
        this.pendingCitations = payload.items ?? [];
        break;

      case 'done':
        this.finishStream();
        break;

      case 'error':
        this.finishWithError(
          payload.message ?? `An error occurred (${payload.status ?? 'unknown'}).`
        );
        break;
    }
  }

  private appendToLastMessage(content: string): void {
    if (this.messages.length === 0) return;
    const last = this.messages[this.messages.length - 1];
    if (last.role === 'assistant') {
      last.content += content;
      last.loading = false; // clear loading dots once first token arrives
    }
  }

  private finishStream(): void {
    this.isLoading = false;

    const last =
      this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;

    if (last && last.role === 'assistant') {
      last.loading = false;
      if (this.pendingCitations.length > 0) {
        last.citations = this.pendingCitations.slice(0, 10);
      }
    }

    this.pendingCitations = [];
    this.cdr.detectChanges();
  }

  private finishWithError(message: string): void {
    this.isLoading = false;

    // Remove the loading assistant bubble if it has no content yet
    const last =
      this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    if (last && last.role === 'assistant' && last.loading && last.content === '') {
      this.messages.pop();
    }

    this.messages.push({ role: 'error', content: message });
    this.pendingCitations = [];
    this.cdr.detectChanges();
  }
}
