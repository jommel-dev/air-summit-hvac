import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiErrorResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return body;
        }

        const payload = body as Record<string, unknown>;
        if (payload.success !== false) {
          return body;
        }

        const message = this.extractMessage(payload);
        if (!message) {
          return body;
        }

        return {
          ...payload,
          message,
          error: typeof payload.error === 'string' && payload.error.trim() ? payload.error : message,
        };
      }),
    );
  }

  private extractMessage(payload: Record<string, unknown>): string | null {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }

    return null;
  }
}