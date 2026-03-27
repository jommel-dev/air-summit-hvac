import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { getAccessToken } from './auth-storage';

@Injectable({ providedIn: 'root' })
export class IdleSessionService implements OnDestroy {
  private readonly idleMs = 15 * 60 * 1000;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
  private started = false;
  private isPromptOpen = false;
  private promptDecisionResolver: ((decision: boolean) => void) | null = null;

  get idlePromptVisible(): boolean {
    return this.isPromptOpen;
  }

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }

    this.started = true;
    this.activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, this.onActivity, { passive: true }),
    );

    this.resetIdleTimer();
  }

  stop(): void {
    if (!this.started || typeof window === 'undefined') {
      return;
    }

    this.started = false;
    this.activityEvents.forEach((eventName) =>
      window.removeEventListener(eventName, this.onActivity),
    );

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private onActivity = (): void => {
    if (!this.started || this.isPromptOpen) {
      return;
    }

    this.resetIdleTimer();
  };

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      void this.handleIdleTimeout();
    }, this.idleMs);
  }

  private async handleIdleTimeout(): Promise<void> {
    if (this.isPromptOpen) {
      return;
    }

    if (!getAccessToken()) {
      this.resetIdleTimer();
      return;
    }

    this.isPromptOpen = true;
    const shouldContinue = await this.waitForPromptDecision();

    if (!shouldContinue) {
      this.authService.logout();
      await this.router.navigateByUrl('/');
      return;
    }

    try {
      const refreshed = await this.authService.refreshSession();
      if (!refreshed.success) {
        this.authService.logout();
        await this.router.navigateByUrl('/');
      }
    } catch {
      this.authService.logout();
      await this.router.navigateByUrl('/');
    } finally {
      this.resetIdleTimer();
    }
  }

  respondToIdlePrompt(shouldContinue: boolean): void {
    if (!this.isPromptOpen || !this.promptDecisionResolver) {
      return;
    }

    const resolver = this.promptDecisionResolver;
    this.promptDecisionResolver = null;
    this.isPromptOpen = false;

    resolver(shouldContinue);
  }

  private waitForPromptDecision(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.promptDecisionResolver = resolve;
    });
  }
}
