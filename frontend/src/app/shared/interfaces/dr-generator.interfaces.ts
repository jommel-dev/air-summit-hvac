import { PDFFont } from 'pdf-lib';

// Shared types for DR generation

export interface DrEligibleOrder {
  id: number;
  soNumber: string;
  customerName: string;
  customerAddress: string;
  customerContactPerson?: string;
  customerContactNumber?: string;
  customerType: 'regular' | 'sub_dealer';
  salesType?: string;
  installer: string | null;
  scheduleDate: string | null;
  paymentMethod: string | null;
  productItems: DrProductItem[];
}

export interface DrProductItem {
  productName: string;
  capacityName: string;
  sellPrice: number;
  serialNumbers: DrSerialEntry[];
}

export interface DrSerialEntry {
  serialNumber: string;
  unitType: 'indoor' | 'outdoor' | 'window';
}

export interface DrFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}
