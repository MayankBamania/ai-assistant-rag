import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
  PLATFORM_ID,
  Inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// Augment the Window interface for TypeScript
declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: {
      Player: new (elementId: string | HTMLElement, options: object) => YTPlayerInstance;
    };
  }
}

interface YTPlayerInstance {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

@Component({
  selector: 'app-video-player',
  standalone: true,
  template: `
    <div class="player-wrapper">
      <div class="player-container" [id]="playerId"></div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .player-wrapper { width: 100%; height: 100%; }
    .player-container { width: 100%; height: 100%; }
  `],
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input() videoId: string = '';
  @Output() playerReady = new EventEmitter<void>();

  private player: YTPlayerInstance | null = null;
  private isPlayerReady = false;
  private static apiLoaded = false;

  readonly playerId = `yt-player-${Math.random().toString(36).substring(2, 9)}`;

  constructor(@Inject(PLATFORM_ID) private platformId: object) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadYouTubeApi();
  }

  ngAfterViewInit(): void {
    // If the API script already finished loading (e.g. a second component instance),
    // YT.Player is available immediately — no need to wait for the callback.
    if (isPlatformBrowser(this.platformId) && window.YT?.Player && this.videoId) {
      this.initPlayer();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['videoId'] && !changes['videoId'].firstChange && this.player) {
      this.player.loadVideoById(this.videoId);
    }
  }

  ngOnDestroy(): void {
    this.player?.destroy();
    this.player = null;
    this.isPlayerReady = false;
  }

  private loadYouTubeApi(): void {
    if (VideoPlayerComponent.apiLoaded) {
      // Script tag already injected; if YT.Player is already available, init now.
      // Otherwise the global onYouTubeIframeAPIReady set below will handle it.
      if (window.YT?.Player && this.videoId) {
        this.initPlayer();
      }
      return;
    }

    VideoPlayerComponent.apiLoaded = true;

    // Chain onto any existing callback so multiple components don't clobber each other.
    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      existingCallback?.();
      if (this.videoId) {
        this.initPlayer();
      }
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
  }

  private initPlayer(): void {
    if (!this.videoId || !window.YT?.Player) return;

    this.player = new window.YT.Player(this.playerId, {
      videoId: this.videoId,
      playerVars: { autoplay: 0, rel: 0 },
      width: '80%',
      events: {
        onReady: () => {
          this.isPlayerReady = true;
          this.playerReady.emit();
        },
      },
    });
  }

  seekTo(seconds: number): void {
    if (!this.isPlayerReady || !this.player) {
      console.warn('[VideoPlayerComponent] seekTo called before player is ready');
      return;
    }
    this.player.seekTo(seconds, true);
  }
}
