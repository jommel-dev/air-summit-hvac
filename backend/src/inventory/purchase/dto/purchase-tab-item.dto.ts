export class PurchaseTabItemDto {
  id!: number;
  poNumber!: string;
  vendorId!: string | null;
  vendorName!: string;
  vendor?: {
    id: string | null;
    name: string;
    address: string | null;
    contactPerson: string | null;
    contactNumber: string | null;
  };
  totalAmount!: number;
  status!: string;
  paymentDetails?: {
    method: string | null;
    amount: number;
    terms: string | null;
    termsDueDate: string | null;
    status: string | null;
    paymentDate: string | null;
    downPayment: number;
  } | null;
  productItems?: Array<{
    id: string | number | null;
    transType: string;
    productId: string | null;
    capacityId: string | null;
    unitPrice: number;
    sellPrice: number;
    discountPrice: number;
    unitTypesQty: unknown;
    totalSetQty: number;
    purchaseId: string | null;
    salesId: string | null;
    status: string | null;
    product: {
      id: string | number | null;
      productName: string | null;
      unit: string | null;
      productType: string | null;
    } | null;
    capacity: {
      id: string | number | null;
      capacity: string | null;
      indoorModel: string | null;
      outdoorModel: string | null;
      srp: number;
      netPrice: number;
    } | null;
  }>;
  createdAt!: string | null;
  serialCount!: number;
}
