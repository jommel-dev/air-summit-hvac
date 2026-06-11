import { Injectable } from '@angular/core';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import {
  DrEligibleOrder,
  DrProductItem,
  DrFonts,
} from '../interfaces/dr-generator.interfaces';
import { BusinessProfileSettings } from './business-settings.service';

@Injectable({ providedIn: 'root' })
export class DrGeneratorService {
  private readonly PAGE_WIDTH = 595;
  private readonly PAGE_HEIGHT = 842;
  private readonly MARGIN_LEFT = 40;
  private readonly MARGIN_RIGHT = 40;
  private readonly MARGIN_TOP = 40;
  private readonly MARGIN_BOTTOM = 14;
  private readonly LINE_HEIGHT = 14;
  private readonly TABLE_ROW_HEIGHT = 16;
  private readonly HEADER_FONT_SIZE = 14;
  private readonly BODY_FONT_SIZE = 9;
  private readonly LABEL_FONT_SIZE = 8;

  /**
   * Generates a DR PDF from scratch for one or more sales orders belonging to the same customer.
   */
  async generateDr(
    orders: DrEligibleOrder[],
    businessProfile: BusinessProfileSettings | null,
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const fonts: DrFonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    };

    let page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);

    // Embed logo if available (Req 6.4: skip if null/empty)
    await this.drawLogo(pdfDoc, page, businessProfile);

    let y = this.drawHeader(page, businessProfile, fonts);
    y = this.drawDetails(page, orders, y, fonts);

    const result = this.drawProductTable(pdfDoc, page, orders, y, fonts);
    page = result.page;
    y = result.y;

    this.drawSignatures(page, y, fonts);
    this.drawPaymentDetails(page, fonts);

    return pdfDoc.save();
  }

  /** Renders the header section - Left: Logo/Business Name | Right: Address & Contact */
  private drawHeader(
    page: PDFPage,
    profile: BusinessProfileSettings | null,
    fonts: DrFonts,
  ): number {
    const width = page.getWidth();
    let y = this.PAGE_HEIGHT - this.MARGIN_TOP;

    // Title centered
    const title = 'DELIVERY RECEIPT';
    const titleWidth = fonts.bold.widthOfTextAtSize(title, this.HEADER_FONT_SIZE);
    page.drawText(title, {
      x: (width - titleWidth) / 2,
      y,
      size: this.HEADER_FONT_SIZE,
      font: fonts.bold,
      color: rgb(0, 0, 0),
    });
    y -= this.LINE_HEIGHT * 2;

    // Left section: Business Name (logo is handled separately via drawLogo)
    const companyName = profile?.businessName ?? '';
    if (companyName) {
      page.drawText(companyName, {
        x: this.MARGIN_LEFT,
        y,
        size: 11,
        font: fonts.bold,
        color: rgb(0, 0, 0),
      });
    }

    // Right section: Address and contact details
    const rightX = this.PAGE_WIDTH / 2 + 20;
    let rightY = y;

    const companyAddress = profile?.businessAddress ?? '';
    if (companyAddress) {
      page.drawText(companyAddress, {
        x: rightX,
        y: rightY,
        size: this.BODY_FONT_SIZE,
        font: fonts.regular,
        color: rgb(0, 0, 0),
      });
      rightY -= this.LINE_HEIGHT;
    }

    const companyContact = profile?.businessContact ?? '';
    if (companyContact) {
      page.drawText('Tel: ' + companyContact, {
        x: rightX,
        y: rightY,
        size: this.BODY_FONT_SIZE,
        font: fonts.regular,
        color: rgb(0, 0, 0),
      });
      rightY -= this.LINE_HEIGHT;
    }

    const companyEmail = profile?.businessEmail ?? '';
    if (companyEmail) {
      page.drawText(companyEmail, {
        x: rightX,
        y: rightY,
        size: this.BODY_FONT_SIZE,
        font: fonts.regular,
        color: rgb(0, 0, 0),
      });
      rightY -= this.LINE_HEIGHT;
    }

    // Move y to the lowest point between left and right sections
    y = Math.min(y - this.LINE_HEIGHT, rightY);
    y -= this.LINE_HEIGHT;
    return y;
  }

  /** Renders the details section (date, installer, SOs) - installer-centric grouping */
  private drawDetails(
    page: PDFPage,
    orders: DrEligibleOrder[],
    y: number,
    fonts: DrFonts,
  ): number {
    const firstOrder = orders[0];
    if (!firstOrder) {
      return y;
    }

    const labelX = this.MARGIN_LEFT;
    const valueX = this.MARGIN_LEFT + 100;
    const rightLabelX = this.PAGE_WIDTH / 2 + 20;
    const rightValueX = this.PAGE_WIDTH / 2 + 100;

    // Delivery date
    const deliveryDate = firstOrder.scheduleDate
      ? this.formatDate(firstOrder.scheduleDate)
      : 'N/A';
    page.drawText('Date:', { x: labelX, y, size: this.BODY_FONT_SIZE, font: fonts.bold });
    page.drawText(deliveryDate, { x: valueX, y, size: this.BODY_FONT_SIZE, font: fonts.regular });

    // SO Number(s) on right side
    const soNumbers = orders.map((o) => o.soNumber).join(', ');
    page.drawText('SO No.:', { x: rightLabelX, y, size: this.BODY_FONT_SIZE, font: fonts.bold });
    page.drawText(soNumbers, {
      x: rightValueX,
      y,
      size: this.BODY_FONT_SIZE,
      font: fonts.regular,
      maxWidth: this.PAGE_WIDTH - rightValueX - this.MARGIN_RIGHT,
    });
    y -= this.LINE_HEIGHT;

    // Installer (the main grouping key)
    const installer = firstOrder.installer ?? 'N/A';
    page.drawText('Installer:', { x: labelX, y, size: this.BODY_FONT_SIZE, font: fonts.bold });
    page.drawText(installer, { x: valueX, y, size: this.BODY_FONT_SIZE, font: fonts.regular });
    y -= this.LINE_HEIGHT * 2;

    return y;
  }

  /**
   * Renders the product/serial table. Handles multi-page overflow.
   * Returns the current page and y position after drawing.
   */
  private drawProductTable(
    pdfDoc: PDFDocument,
    page: PDFPage,
    orders: DrEligibleOrder[],
    y: number,
    fonts: DrFonts,
  ): { page: PDFPage; y: number } {
    // Column layout
    const columns = this.getTableColumns();

    // Draw table header
    y = this.drawTableHeader(page, y, columns, fonts);

    // Draw rows
    for (const order of orders) {
      for (const item of order.productItems) {
        const rows = this.buildProductRows(order, item);
        for (const row of rows) {
          // Check if we need a new page
          if (y < this.MARGIN_BOTTOM + this.TABLE_ROW_HEIGHT * 2) {
            page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
            y = this.PAGE_HEIGHT - this.MARGIN_TOP;
            y = this.drawTableHeader(page, y, columns, fonts);
          }

          const rowHeight = this.drawTableRow(page, y, row, columns, fonts);
          y -= rowHeight;
        }
      }
    }

    // Draw bottom border line
    page.drawLine({
      start: { x: this.MARGIN_LEFT, y },
      end: { x: this.PAGE_WIDTH - this.MARGIN_RIGHT, y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });

    y -= this.LINE_HEIGHT;
    return { page, y };
  }

  /** Renders the 5 signature lines in the footer - 2 rows: top 2, bottom 3 */
  private drawSignatures(page: PDFPage, _y: number, fonts: DrFonts): void {
    const topRow = ['Warehouse Supervisor', 'Warehouse Man'];
    const bottomRow = ['HR Admin', 'Checked By', 'Received By'];

    // Position signatures just above the payment details section (which starts at y=95)
    // Payment section takes ~60pt, so signatures start above that
    let y = 195;

    const usableWidth = this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT;

    // --- Top row: 2 signatories ---
    const topColumnWidth = usableWidth / topRow.length;
    const topLineWidth = topColumnWidth - 40;

    for (let i = 0; i < topRow.length; i++) {
      const x = this.MARGIN_LEFT + i * topColumnWidth;
      const centerX = x + topColumnWidth / 2;

      const lineStartX = centerX - topLineWidth / 2;
      const lineEndX = centerX + topLineWidth / 2;
      page.drawLine({
        start: { x: lineStartX, y },
        end: { x: lineEndX, y },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });

      const labelWidth = fonts.bold.widthOfTextAtSize(topRow[i], this.LABEL_FONT_SIZE);
      page.drawText(topRow[i], {
        x: centerX - labelWidth / 2,
        y: y - 10,
        size: this.LABEL_FONT_SIZE,
        font: fonts.bold,
        color: rgb(0, 0, 0),
      });

      const subLabel = 'Printed Name Over Signature';
      const subLabelWidth = fonts.italic.widthOfTextAtSize(subLabel, 6);
      page.drawText(subLabel, {
        x: centerX - subLabelWidth / 2,
        y: y - 20,
        size: 6,
        font: fonts.italic,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    // --- Bottom row: 3 signatories ---
    y -= 40;
    const bottomColumnWidth = usableWidth / bottomRow.length;
    const bottomLineWidth = bottomColumnWidth - 30;

    for (let i = 0; i < bottomRow.length; i++) {
      const x = this.MARGIN_LEFT + i * bottomColumnWidth;
      const centerX = x + bottomColumnWidth / 2;

      const lineStartX = centerX - bottomLineWidth / 2;
      const lineEndX = centerX + bottomLineWidth / 2;
      page.drawLine({
        start: { x: lineStartX, y },
        end: { x: lineEndX, y },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });

      const labelWidth = fonts.bold.widthOfTextAtSize(bottomRow[i], this.LABEL_FONT_SIZE);
      page.drawText(bottomRow[i], {
        x: centerX - labelWidth / 2,
        y: y - 10,
        size: this.LABEL_FONT_SIZE,
        font: fonts.bold,
        color: rgb(0, 0, 0),
      });

      const subLabel = 'Printed Name Over Signature';
      const subLabelWidth = fonts.italic.widthOfTextAtSize(subLabel, 6);
      page.drawText(subLabel, {
        x: centerX - subLabelWidth / 2,
        y: y - 20,
        size: 6,
        font: fonts.italic,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  /** Renders the delivery/payment details as a compact footer - all caps, 2 columns */
  private drawPaymentDetails(page: PDFPage, fonts: DrFonts): void {
    const fontSize = 7;
    const lineSpacing = 14;
    const usableWidth = this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT;
    const colWidth = usableWidth / 2;
    const lineLength = colWidth - 100;

    // Left column labels
    const leftLabels = [
      'DELIVERED BY:',
      'GCASH DETAILS:',
      'CHECK DETAILS:',
    ];

    // Right column labels
    const rightLabels = [
      'MODE OF PAYMENT:',
      'BANK TRANSFER DETAILS:',
      'CASH RECEIVED BY:',
      'CASH WITNESSED BY:',
    ];

    // Position at bottom of the page
    let y = 95;
    const leftX = this.MARGIN_LEFT;
    const rightX = this.MARGIN_LEFT + colWidth;

    const maxRows = Math.max(leftLabels.length, rightLabels.length);

    for (let i = 0; i < maxRows; i++) {
      // Left column
      if (i < leftLabels.length) {
        const label = leftLabels[i];
        const labelWidth = fonts.bold.widthOfTextAtSize(label, fontSize);
        page.drawText(label, {
          x: leftX,
          y,
          size: fontSize,
          font: fonts.bold,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x: leftX + labelWidth + 4, y: y - 2 },
          end: { x: leftX + labelWidth + 4 + lineLength, y: y - 2 },
          thickness: 0.4,
          color: rgb(0, 0, 0),
        });
      }

      // Right column
      if (i < rightLabels.length) {
        const label = rightLabels[i];
        const labelWidth = fonts.bold.widthOfTextAtSize(label, fontSize);
        page.drawText(label, {
          x: rightX,
          y,
          size: fontSize,
          font: fonts.bold,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x: rightX + labelWidth + 4, y: y - 2 },
          end: { x: rightX + labelWidth + 4 + lineLength, y: y - 2 },
          thickness: 0.4,
          color: rgb(0, 0, 0),
        });
      }

      y -= lineSpacing;
    }

    // Red italic note below
    y -= 8;
    page.drawText('Note: Received the above items in good order and condition.', {
      x: this.MARGIN_LEFT,
      y,
      size: 7,
      font: fonts.italic,
      color: rgb(0.8, 0, 0),
    });
  }


  /**
   * Embeds and draws the company logo from businessLogo URL.
   * Skips gracefully if logo is null, empty, or cannot be loaded (Req 6.4).
   */
  private async drawLogo(
    pdfDoc: PDFDocument,
    page: PDFPage,
    profile: BusinessProfileSettings | null,
  ): Promise<void> {
    const logoUrl = profile?.businessLogo;
    if (!logoUrl) {
      return;
    }

    try {
      const response = await fetch(logoUrl);
      if (!response.ok) {
        return;
      }

      const logoBytes = new Uint8Array(await response.arrayBuffer());
      let image;

      // Attempt PNG first, fall back to JPG
      try {
        image = await pdfDoc.embedPng(logoBytes);
      } catch {
        try {
          image = await pdfDoc.embedJpg(logoBytes);
        } catch {
          return; // Skip logo if neither format works
        }
      }

      const maxLogoWidth = 100;
      const maxLogoHeight = 50;
      const scale = Math.min(
        maxLogoWidth / Math.max(1, image.width),
        maxLogoHeight / Math.max(1, image.height),
      );
      const logoWidth = image.width * scale;
      const logoHeight = image.height * scale;

      page.drawImage(image, {
        x: this.MARGIN_LEFT,
        y: this.PAGE_HEIGHT - this.MARGIN_TOP - logoHeight + 10,
        width: logoWidth,
        height: logoHeight,
      });
    } catch {
      // Skip logo gracefully on any error (per Req 6.4)
    }
  }

  private getTableColumns(): TableColumn[] {
    const contentWidth = this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT;
    return [
      { header: 'Customer', x: this.MARGIN_LEFT, width: contentWidth * 0.12 },
      { header: 'Address', x: this.MARGIN_LEFT + contentWidth * 0.12, width: contentWidth * 0.12 },
      { header: 'Description', x: this.MARGIN_LEFT + contentWidth * 0.24, width: contentWidth * 0.18 },
      { header: 'Indoor Serial', x: this.MARGIN_LEFT + contentWidth * 0.42, width: contentWidth * 0.22 },
      { header: 'Outdoor Serial', x: this.MARGIN_LEFT + contentWidth * 0.64, width: contentWidth * 0.22 },
      { header: 'Unit Price', x: this.MARGIN_LEFT + contentWidth * 0.86, width: contentWidth * 0.14 },
    ];
  }

  private drawTableHeader(
    page: PDFPage,
    y: number,
    columns: TableColumn[],
    fonts: DrFonts,
  ): number {
    const tableRight = this.PAGE_WIDTH - this.MARGIN_RIGHT;
    const headerTop = y + 2;
    const headerBottom = y - this.TABLE_ROW_HEIGHT + 2;

    // Header background
    page.drawRectangle({
      x: this.MARGIN_LEFT,
      y: headerBottom,
      width: tableRight - this.MARGIN_LEFT,
      height: this.TABLE_ROW_HEIGHT,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    // Header text
    for (const col of columns) {
      page.drawText(col.header, {
        x: col.x + 2,
        y: y - this.TABLE_ROW_HEIGHT + 6,
        size: this.LABEL_FONT_SIZE,
        font: fonts.bold,
        color: rgb(0, 0, 0),
      });
    }

    // Vertical lines for header columns
    for (let i = 1; i < columns.length; i++) {
      page.drawLine({
        start: { x: columns[i].x, y: headerTop },
        end: { x: columns[i].x, y: headerBottom },
        thickness: 0.3,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Header bottom border
    y -= this.TABLE_ROW_HEIGHT;
    page.drawLine({
      start: { x: this.MARGIN_LEFT, y },
      end: { x: tableRight, y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });

    return y;
  }

  private drawTableRow(
    page: PDFPage,
    y: number,
    row: TableRowData,
    columns: TableColumn[],
    fonts: DrFonts,
  ): number {
    const fontSize = 7.5;
    const font = fonts.regular;
    const lineSpacing = 10;

    // Wrap text for all columns that need it
    const customerLines = this.wrapText(row.customer, columns[0].width - 4, fontSize, font);
    const addressLines = this.wrapText(row.address, columns[1].width - 4, fontSize, font);
    const descriptionLines = this.wrapText(row.description, columns[2].width - 4, fontSize, font);
    const unitPriceLines = this.wrapText(row.unitPrice, columns[5].width - 4, fontSize, font);

    // Calculate dynamic row height based on tallest cell
    const maxLines = Math.max(1, customerLines.length, addressLines.length, descriptionLines.length, unitPriceLines.length);
    const rowHeight = Math.max(this.TABLE_ROW_HEIGHT, maxLines * lineSpacing + 6);

    const textY = y - lineSpacing - 1;

    // Customer (wrapped)
    for (let i = 0; i < customerLines.length; i++) {
      page.drawText(customerLines[i], {
        x: columns[0].x + 2,
        y: textY - i * lineSpacing,
        size: fontSize,
        font,
      });
    }

    // Address (wrapped)
    for (let i = 0; i < addressLines.length; i++) {
      page.drawText(addressLines[i], {
        x: columns[1].x + 2,
        y: textY - i * lineSpacing,
        size: fontSize,
        font,
      });
    }

    // Description (wrapped)
    for (let i = 0; i < descriptionLines.length; i++) {
      page.drawText(descriptionLines[i], {
        x: columns[2].x + 2,
        y: textY - i * lineSpacing,
        size: fontSize,
        font,
      });
    }

    // Indoor Serial (single line)
    page.drawText(this.truncateText(row.indoorSerial, columns[3].width - 4, fontSize, font), {
      x: columns[3].x + 2,
      y: textY,
      size: fontSize,
      font,
    });

    // Outdoor Serial (single line)
    page.drawText(this.truncateText(row.outdoorSerial, columns[4].width - 4, fontSize, font), {
      x: columns[4].x + 2,
      y: textY,
      size: fontSize,
      font,
    });

    // Unit Price (wrapped)
    for (let i = 0; i < unitPriceLines.length; i++) {
      page.drawText(unitPriceLines[i], {
        x: columns[5].x + 2,
        y: textY - i * lineSpacing,
        size: fontSize,
        font,
      });
    }

    // Draw cell borders
    const rowBottom = y - rowHeight;
    const tableRight = this.PAGE_WIDTH - this.MARGIN_RIGHT;
    const borderColor = rgb(0.7, 0.7, 0.7);

    // Bottom horizontal line
    page.drawLine({
      start: { x: this.MARGIN_LEFT, y: rowBottom },
      end: { x: tableRight, y: rowBottom },
      thickness: 0.3,
      color: borderColor,
    });

    // Vertical lines for each column
    for (const col of columns) {
      page.drawLine({
        start: { x: col.x, y },
        end: { x: col.x, y: rowBottom },
        thickness: 0.3,
        color: borderColor,
      });
    }
    // Right border
    page.drawLine({
      start: { x: tableRight, y },
      end: { x: tableRight, y: rowBottom },
      thickness: 0.3,
      color: borderColor,
    });

    return rowHeight;
  }

  /**
   * Builds table rows from a product item.
   * One row per product-capacity-serial combination.
   * Indoor serials go in Indoor Serial column, outdoor serials in Outdoor Serial column.
   */
  private buildProductRows(order: DrEligibleOrder, item: DrProductItem): TableRowData[] {
    const description = `${item.productName} ${item.capacityName}`;
    const indoorSerials = item.serialNumbers.filter(
      (s) => s.unitType === 'indoor' || s.unitType === 'window',
    );
    const outdoorSerials = item.serialNumbers.filter((s) => s.unitType === 'outdoor');

    // Format unit price with payment method
    let unitPriceStr = '';
    if (item.sellPrice) {
      const formattedPrice = item.sellPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      unitPriceStr = order.paymentMethod
        ? `${formattedPrice} / ${order.paymentMethod}`
        : formattedPrice;
    }

    const rows: TableRowData[] = [];
    const maxRows = Math.max(indoorSerials.length, outdoorSerials.length, 1);

    for (let i = 0; i < maxRows; i++) {
      rows.push({
        customer: i === 0 ? order.customerName : '',
        address: i === 0 ? order.customerAddress : '',
        description: i === 0 ? description : '',
        indoorSerial: indoorSerials[i]?.serialNumber ?? '',
        outdoorSerial: outdoorSerials[i]?.serialNumber ?? '',
        unitPrice: unitPriceStr,
      });
    }

    return rows;
  }

  private truncateText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string {
    if (!text) return '';
    if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) {
      return text;
    }
    let truncated = text;
    while (truncated.length > 0 && font.widthOfTextAtSize(truncated + '...', fontSize) > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  }

  private wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
    if (!text) return [''];
    if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) {
      return [text];
    }

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, fontSize) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        // If a single word is too long, force-break it
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          let remaining = word;
          while (remaining.length > 0) {
            let chunk = '';
            for (let i = 0; i < remaining.length; i++) {
              const test = remaining.substring(0, i + 1);
              if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
                break;
              }
              chunk = test;
            }
            if (!chunk) {
              chunk = remaining.substring(0, 1);
            }
            lines.push(chunk);
            remaining = remaining.substring(chunk.length);
          }
          currentLine = '';
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  private formatCurrency(value: number): string {
    if (!value) return '';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

/** Internal table column definition */
interface TableColumn {
  header: string;
  x: number;
  width: number;
}

/** Internal table row data */
interface TableRowData {
  customer: string;
  address: string;
  description: string;
  indoorSerial: string;
  outdoorSerial: string;
  unitPrice: string;
}
