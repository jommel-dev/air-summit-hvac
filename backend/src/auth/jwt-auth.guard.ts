import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  private toPositiveNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
  }

  private extractHeaderValue(headerValue: unknown): string | undefined {
    if (Array.isArray(headerValue)) {
      return String(headerValue[0] ?? '').trim() || undefined;
    }

    const value = String(headerValue ?? '').trim();
    return value.length > 0 ? value : undefined;
  }

  private resolveEffectiveBranchId(
    payload: Record<string, unknown>,
    request: { headers?: Record<string, unknown> },
  ): number | undefined {
    const tokenBranchId = this.toPositiveNumber(
      payload?.branchId ?? payload?.branch_id ?? payload?.branch,
    );
    const roleName = String(payload?.roleName ?? payload?.role_name ?? '')
      .trim()
      .toLowerCase();
    const isAdminOrSuperOrOwner =
      roleName.includes('admin') || roleName.includes('super') || roleName.includes('owner');

    if (!isAdminOrSuperOrOwner) {
      return tokenBranchId;
    }

    const requestedBranchRaw = this.extractHeaderValue(request.headers?.['x-active-branch-id']);
    const requestedBranchId = this.toPositiveNumber(requestedBranchRaw);

    return requestedBranchId;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const secret = this.configService.get<string>('JWT_SECRET', 'dev-secret');

    try {
      const payload = verify(token, secret);
      if (!payload || typeof payload !== 'object') {
        throw new UnauthorizedException('Invalid token payload');
      }

      const payloadRecord = payload as Record<string, unknown>;
      const tokenBranchId = this.toPositiveNumber(
        payloadRecord?.branchId ?? payloadRecord?.branch_id ?? payloadRecord?.branch,
      );
      const effectiveBranchId = this.resolveEffectiveBranchId(payloadRecord, request);

      request.user = {
        ...payloadRecord,
        tokenBranchId,
        branchId: effectiveBranchId,
        branch_id: effectiveBranchId,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
