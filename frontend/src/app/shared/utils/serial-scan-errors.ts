export function formatReadableUnitTypeLabel(unitType: string | null | undefined): string {
  const normalized = String(unitType ?? '').trim().toLowerCase();
  if (!normalized) {
    return 'Unknown';
  }
  if (normalized === 'indoor') {
    return 'Indoor';
  }
  if (normalized === 'outdoor') {
    return 'Outdoor';
  }
  if (normalized === 'window') {
    return 'Window';
  }
  if (normalized === 'set') {
    return 'Set';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export interface SerialUnitTypeMismatchDetails {
  expectedUnitType?: string | null;
  actualUnitType?: string | null;
  serialNumber?: string | null;
}

export function buildSerialUnitTypeMismatchMessage(
  expectedUnitType: string,
  actualUnitType: string,
  serialNumber?: string,
): { title: string; message: string; inlineError: string } {
  const expectedLabel = formatReadableUnitTypeLabel(expectedUnitType);
  const actualLabel = formatReadableUnitTypeLabel(actualUnitType);
  const serialPart = serialNumber ? ` "${serialNumber}"` : '';

  return {
    title: 'Wrong Unit Type Scanned',
    message:
      `You are scanning on the ${expectedLabel} field, but serial${serialPart} is registered as an ${actualLabel} unit. ` +
      `Switch to the ${actualLabel} tab and scan there, or scan the correct ${expectedLabel} serial number instead.`,
    inlineError:
      `This serial is an ${actualLabel} unit. You are on ${expectedLabel}. Switch tabs or scan the correct serial.`,
  };
}

export function resolveSerialUnitTypeMismatchPrompt(
  result: { validationStatus?: string; message?: string; details?: Record<string, unknown> } | null | undefined,
  fallbackExpectedUnitType?: string,
  fallbackSerialNumber?: string,
): { title: string; message: string; inlineError: string } | null {
  if (result?.validationStatus !== 'error_unit_type_mismatch') {
    return null;
  }

  const details = (result.details ?? {}) as SerialUnitTypeMismatchDetails;
  const expectedUnitType =
    String(details.expectedUnitType ?? fallbackExpectedUnitType ?? '').trim() || 'unknown';
  const actualUnitType = String(details.actualUnitType ?? '').trim() || 'unknown';
  const serialNumber = String(details.serialNumber ?? fallbackSerialNumber ?? '').trim() || undefined;

  return buildSerialUnitTypeMismatchMessage(expectedUnitType, actualUnitType, serialNumber);
}
