import { Test, TestingModule } from '@nestjs/testing';
import * as fc from 'fast-check';
import { SerialNumberService } from './serial-number.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SerialEventLogService } from './serial-event-log.service';
import { ScanFileLoggerService } from './scan-file-logger.service';

// ─── Fast-check Configuration ───────────────────────────────────────────────
const FC_NUM_RUNS = 100;

// ─── Reusable Arbitraries ───────────────────────────────────────────────────

/** Generates a positive integer ID suitable for database record IDs */
const arbId = () => fc.integer({ min: 1, max: 100_000 });

/** Generates a valid sales order ID */
const arbSalesId = () => fc.integer({ min: 1, max: 100_000 });

/** Generates a valid product ID */
const arbProductId = () => fc.integer({ min: 1, max: 10_000 });

/** Generates a valid capacity ID */
const arbCapacityId = () => fc.integer({ min: 1, max: 10_000 });

/** Generates a valid branch ID */
const arbBranchId = () => fc.integer({ min: 1, max: 1_000 });

/** Generates a valid purchase ID */
const arbPurchaseId = () => fc.integer({ min: 1, max: 100_000 });

/** Generates a non-empty serial number string (alphanumeric with optional dashes) */
const arbSerialNumber = () =>
  fc
    .stringMatching(/^[A-Z0-9][A-Z0-9\-]{2,19}$/)
    .filter((s) => s.trim().length > 0);

/** Generates a product name string */
const arbProductName = () =>
  fc.constantFrom(
    'Carrier 24ACC636',
    'Trane XR15',
    'Lennox XC21',
    'Daikin DX20VC',
    'Goodman GSX16',
    'Rheem RA17',
  );

/** Generates a capacity name string */
const arbCapacityName = () =>
  fc.constantFrom('1.5 Ton', '2 Ton', '2.5 Ton', '3 Ton', '3.5 Ton', '4 Ton', '5 Ton');

/** Generates a unit type string */
const arbUnitType = () =>
  fc.constantFrom('indoor', 'outdoor', 'set', 'lineset', 'thermostat');

/** Generates a customer name */
const arbCustomerName = () =>
  fc.constantFrom(
    'John Smith',
    'Jane Doe',
    'ACME Corp',
    'Cool Air LLC',
    'Pacific HVAC',
    'Desert Climate Inc',
  );

/** Generates a SO number string */
const arbSoNumber = () =>
  fc.stringMatching(/^SO-[0-9]{4,8}$/);

/** Generates a PO number string */
const arbPoNumber = () =>
  fc.stringMatching(/^PO-[0-9]{4,8}$/);

/**
 * Generates a serial record as returned by the database query in scanSalesOrder.
 * Mirrors the SELECT alias shape from the service's serial lookup query.
 */
const arbSerialRecord = () =>
  fc.record({
    id: arbId(),
    serialNumber: arbSerialNumber(),
    status: fc.constantFrom('in-stock', 'scanned', 'reserved', 'sold', 'released'),
    salesId: fc.oneof(fc.constant(null), arbSalesId().map(String)),
    purchaseId: fc.oneof(fc.constant(null), arbPurchaseId().map(String)),
    productId: arbProductId().map(String),
    capacityId: arbCapacityId().map(String),
    branchId: fc.oneof(fc.constant(null), arbBranchId().map(String)),
    unitType: arbUnitType(),
    productName: arbProductName(),
    unit: fc.constant('set'),
    capacity: arbCapacityName(),
    isDefective: fc.boolean(),
  });

/** Generates a pair of (expected, actual) product IDs that are guaranteed to differ */
const arbMismatchedProductIds = () =>
  fc
    .tuple(arbProductId(), arbProductId())
    .filter(([a, b]) => a !== b);

/** Generates a pair of (expected, actual) capacity IDs that are guaranteed to differ */
const arbMismatchedCapacityIds = () =>
  fc
    .tuple(arbCapacityId(), arbCapacityId())
    .filter(([a, b]) => a !== b);

/** Generates a pair of different sales IDs for reassignment scenarios */
const arbDifferentSalesIds = () =>
  fc
    .tuple(arbSalesId(), arbSalesId())
    .filter(([a, b]) => a !== b);

// ─── Mock Factories ─────────────────────────────────────────────────────────

function createMockDatabaseService() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    withTransaction: jest.fn().mockImplementation(async (cb) => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
      return cb(mockClient);
    }),
  };
}

function createMockAuditLogService() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockSerialEventLogService() {
  return {
    logEvent: jest.fn().mockResolvedValue(undefined),
    getHistoryBySerialId: jest.fn().mockResolvedValue([]),
    getHistoryBySerialNumber: jest.fn().mockResolvedValue([]),
  };
}

function createMockScanFileLoggerService() {
  return {
    logSalesScan: jest.fn(),
    logPurchaseScan: jest.fn(),
  };
}

// ─── Test Module Setup ──────────────────────────────────────────────────────

describe('Feature: so-serial-scan-validation - Property Tests', () => {
  let service: SerialNumberService;
  let mockDatabaseService: ReturnType<typeof createMockDatabaseService>;
  let mockAuditLogService: ReturnType<typeof createMockAuditLogService>;
  let mockSerialEventLogService: ReturnType<typeof createMockSerialEventLogService>;
  let mockScanFileLoggerService: ReturnType<typeof createMockScanFileLoggerService>;

  beforeEach(async () => {
    mockDatabaseService = createMockDatabaseService();
    mockAuditLogService = createMockAuditLogService();
    mockSerialEventLogService = createMockSerialEventLogService();
    mockScanFileLoggerService = createMockScanFileLoggerService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialNumberService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: SerialEventLogService, useValue: mockSerialEventLogService },
        { provide: ScanFileLoggerService, useValue: mockScanFileLoggerService },
      ],
    }).compile();

    service = module.get<SerialNumberService>(SerialNumberService);
  });

  // ─── Helper: Configure mock DB to return columns and serial record ──────
  function setupMockDbForScanSalesOrder(serialRow: Record<string, unknown> | null) {
    mockDatabaseService.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlLower = sql.toLowerCase();

      // Column introspection queries
      if (sqlLower.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'serialNumber' },
            { column_name: 'salesId' },
            { column_name: 'previousSalesId' },
            { column_name: 'purchaseId' },
            { column_name: 'previousPurchaseId' },
            { column_name: 'productId' },
            { column_name: 'capacityId' },
            { column_name: 'branchId' },
            { column_name: 'unitType' },
            { column_name: 'status' },
            { column_name: 'created_by' },
            { column_name: 'isDefective' },
          ],
          rowCount: 12,
        };
      }

      // Serial number lookup query
      if (sqlLower.includes('from tblserial_numbers sn') && sqlLower.includes('left join tblproducts')) {
        if (serialRow === null) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [serialRow], rowCount: 1 };
      }

      // Product name lookup (for mismatch messages)
      if (sqlLower.includes('from tblproducts p') && sqlLower.includes('where p.id')) {
        const productId = params?.[0];
        return {
          rows: [{ productName: `Product-${productId}` }],
          rowCount: 1,
        };
      }

      // Capacity name lookup (for mismatch messages)
      if (sqlLower.includes('from tblcapacity c') && sqlLower.includes('where c.id')) {
        const capacityId = params?.[0];
        return {
          rows: [{ capacity: `Capacity-${capacityId}` }],
          rowCount: 1,
        };
      }

      // Sales order reference lookup
      if (sqlLower.includes('from tblsales_order') || sqlLower.includes('from tblsales_orders')) {
        const salesId = params?.[0];
        return {
          rows: [{ soNumber: `SO-${salesId}` }],
          rowCount: 1,
        };
      }

      // Purchase order reference lookup
      if (sqlLower.includes('from tblpurchase_orders') || sqlLower.includes('from tblpo')) {
        const purchaseId = params?.[0];
        return {
          rows: [{ poNumber: `PO-${purchaseId}` }],
          rowCount: 1,
        };
      }

      // UPDATE query (for assignment)
      if (sqlLower.includes('update tblserial_numbers')) {
        return { rows: [{ id: serialRow?.id ?? 1 }], rowCount: 1 };
      }

      // INSERT query (for force-insert)
      if (sqlLower.includes('insert into tblserial_numbers')) {
        return { rows: [{ id: 99999 }], rowCount: 1 };
      }

      // Default fallback
      return { rows: [], rowCount: 0 };
    });
  }

  // ─── Placeholder describe blocks for property tests ───────────────────────
  // Property tests will be added in subsequent tasks (2.2, 2.4, 2.6, 2.7, 2.9, 2.10, 2.12)

  it('test infrastructure is correctly set up', () => {
    expect(service).toBeDefined();
    expect(mockDatabaseService).toBeDefined();
    expect(mockSerialEventLogService).toBeDefined();
    expect(mockScanFileLoggerService).toBeDefined();
  });

  it('fast-check arbitraries generate valid data', () => {
    fc.assert(
      fc.property(arbSerialRecord(), (record) => {
        expect(record.id).toBeGreaterThan(0);
        expect(record.serialNumber.length).toBeGreaterThan(0);
        expect(record.productId).toBeDefined();
        expect(record.capacityId).toBeDefined();
      }),
      { numRuns: FC_NUM_RUNS },
    );
  });

  // Export constants and arbitraries for use in other test files if needed
  // These are available through this module's scope for subsequent property tests.
});

// ─── Exported test utilities ────────────────────────────────────────────────
// Re-export for potential use in other test files
export {
  FC_NUM_RUNS,
  arbId,
  arbSalesId,
  arbProductId,
  arbCapacityId,
  arbBranchId,
  arbPurchaseId,
  arbSerialNumber,
  arbProductName,
  arbCapacityName,
  arbUnitType,
  arbCustomerName,
  arbSoNumber,
  arbPoNumber,
  arbSerialRecord,
  arbMismatchedProductIds,
  arbMismatchedCapacityIds,
  arbDifferentSalesIds,
  createMockDatabaseService,
  createMockAuditLogService,
  createMockSerialEventLogService,
  createMockScanFileLoggerService,
};
