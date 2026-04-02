# Sales Order Daily Release Migration Rules (MVP)

## Accepted Source Columns
- DATE
- DAILY SALES/TEAM
- CUSTOMER NAME
- UNIT/HP
- SALES NAME
- INDOOR SERIAL
- OUTDOOR SERIAL
- REMARKS

## Auto-Mapping Rules
1. `DATE` -> `scheduleDate` (ISO date)
2. `DAILY SALES/TEAM` -> `salesType`
- contains `sub dealer` => `sub-dealer`
- otherwise => `sales`
3. `CUSTOMER NAME` -> `customer.name`
- if exact customer name exists, `customer_id` is populated
- if not, payload still includes `customer.name` for create-on-import flow
4. `UNIT/HP` -> `productItems[0].productId` + `capacityId`
- parser extracts capacity key from left side (`1.5HP`, `3TR`)
- parser uses right side hint (brand/product words) to match catalog
5. `SALES NAME` -> `installer`
6. `INDOOR SERIAL`, `OUTDOOR SERIAL` -> `productItems[0].serialNumbers`
- indoor placed in `serialNumbers.indoor[]`
- outdoor placed in `serialNumbers.outdoor[]`
7. `REMARKS` -> `remarks` and payment hint
- cash => method `Cash`
- bank transfer/online/gcash => method `Bank Transfer`
- terms/terms with dp/check/credit/installment => mapped accordingly

## Confidence Buckets
- `high`: fully matched and import-ready
- `medium`: partial match, needs review
- `rejected`: missing required values or no product-capacity match

## New Preview API
- Endpoint: `POST /sales-order/migration/preview`
- Body:
```json
{
  "rows": [
    {
      "DATE": "2026-02-24",
      "DAILY SALES/TEAM": "CJ",
      "CUSTOMER NAME": "ARVIE BANGAYAN",
      "UNIT/HP": "2.0HP/AIRIT QDDI",
      "SALES NAME": "MYLYN CARREON",
      "INDOOR SERIAL": "88550E508060N00357",
      "OUTDOOR SERIAL": "A8771E508060W00425",
      "REMARKS": "CASH"
    }
  ]
}
```

## Current Status
- Preview/mapping endpoint is implemented.
- Import-commit endpoint (bulk create from approved preview rows) is the next step.
