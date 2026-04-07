import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception);

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error: message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private extractMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string' && response.trim()) {
        return response;
      }

      if (response && typeof response === 'object') {
        const responseRecord = response as Record<string, unknown>;
        const message = responseRecord.message;

        if (Array.isArray(message)) {
          const joined = message
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
            .join(', ');

          if (joined) {
            return joined;
          }
        }

        if (typeof message === 'string' && message.trim()) {
          return message;
        }

        if (typeof responseRecord.error === 'string' && responseRecord.error.trim()) {
          return responseRecord.error;
        }
      }

      return exception.message || 'Request failed';
    }

    if (exception instanceof Error && exception.message.trim()) {
      return exception.message;
    }

    if (typeof exception === 'string' && exception.trim()) {
      return exception;
    }

    return 'Internal server error';
  }
}