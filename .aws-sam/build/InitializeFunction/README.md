# Introduction

This application integrates Thetis IMS with the accounting system e-conomic.  

# Installation

You may install the application from the Serverless Application Repository. It is registered under the name thetis-ims-economic-integration.

## Parameters

When installing the application you must provide values for the following parameters:

- ContextId
- ThetisClientId
- ThetisClientSecret
- ApiKey
- EconomicAccessToken
- DevOpsEmail

A short explanation for each of these parameters are provided upon installation. Furthermore, most of them are explained in our [Get started manual](https://introduction.thetis-ims.com/da/docs/InstallAddOn/).

# Configuration

In the data document of the context:
```
  "EconomicIntegration": {
    "AccessToken": "as09f8a+9sd8f+09a8sdfajksdlfjæ",
    "InventoryAccount": 5830,
    "CostOfSalesAccount": 1255,
    "GoodsNotReceivedAccount": 5825,
    "CostOfProcurementAccount": 5835,
    "InventoryAdjustmentAccount": 1260,
    "CreateSupplierInvoice": true
  }

```

# Events

## Document created

When a relevant document is created within Thetis IMS the application creates corresponding transactions within e-conomic. 

The accounts used on the corresponding transactions depend on the type of the document. So does the voucher number.

### Adjustment list

The value of the document is posted against the inventory adjustment account and the inventory account.

The transaction is given 'A-' plus the number of the adjustment list as its voucher number.

### Goods receipt

The goods not received account is credited the purchase price.

The value of the document is posted against the inventory account. The value of the document is given by the standard cost price of the items receiced.

The balance is posted against the cost of procurement account.

The transaction is given 'G-' plus the number of the goods receipt as its voucher number.

If the CreateSupplierInvoice configuration is set to true, the application creates a supplier invoice within e-conomic.

### Cost of sales list

The value of the document is posted against the inventory account and the cost of sales account.

The transaction is given 'C-' plus the number of the cost of sales list as its voucher number.

### Cost variance list

The value of the document is posted against the inventory account and the cost of procurement account.

The transaction is given 'V-' plus the number of the cost variance list as its voucher number.



