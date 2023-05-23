/**
 * Copyright 2021 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');

var AWS = require('aws-sdk');
AWS.config.update({region:'eu-west-1'});

async function getEconomic(accessToken) {
    
    const appToken = 'Si7VAOfmXW2hkHhe6GSscgMGrrxNga5adYkQf2NGqRA1';
    
    let economic = axios.create({
            baseURL: 'https://restapi.e-conomic.com/',
    		headers: { 'X-AppSecretToken': appToken, 'X-AgreementGrantToken': accessToken, 'Content-Type': 'application/json' }
    	});
    	
	economic.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			console.log(JSON.stringify(error));
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});
		
    return economic;
}

async function getIMS() {
	
    const authUrl = "https://auth.thetis-ims.com/oauth2/";
    const apiUrl = "https://api.thetis-ims.com/2/";

	var clientId = process.env.ClientId;   
	var clientSecret = process.env.ClientSecret; 
	var apiKey = process.env.ApiKey;  
	
    let data = clientId + ":" + clientSecret;
	let base64data = Buffer.from(data, 'UTF-8').toString('base64');	
	
	var imsAuth = axios.create({
			baseURL: authUrl,
			headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
			responseType: 'json'
		});
    
    var response = await imsAuth.post("token", 'grant_type=client_credentials');
    var token = response.data.token_type + " " + response.data.access_token;
    
    var ims = axios.create({
    		baseURL: apiUrl,
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
    	});

	ims.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			console.log(JSON.stringify(error));
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

	return ims;
}

async function postEventMessage(ims, eventId, type, text) {
    let message = new Object();
	message.time = Date.now();
	message.source = "EconomicIntegration";
	message.messageType = type;
	message.messageText = text;
	await ims.post("events/" + eventId + "/messages", message);
}

async function pushProduct(ims, economic, eventId, productGroups, economicProduct) {

	// Lookup product group
	
	let i = 0;
	let found = false;
	let productGroupName = economicProduct.productGroup.name;
	while (i < productGroups.length && !found) {
		if (productGroups[i].productGroupName == productGroupName) {
			found = true;
		} else {
			i++;
		}
	}
	
	let response;

	// Create if non existant				
	
	let productGroup;
	if (found) {
		productGroup = productGroups[i];
	} else {
		response = await ims.post('productGroups', { productGroupName: productGroupName, itemLabelReportId: 506203569 });
		productGroup = response.data;
		productGroups.push(productGroup);
	}

	// Lookup GTI using SKU
	
	response = await ims.get('globalTradeItems', { params: { stockKeepingUnitMatch: economicProduct.productNumber, onlyActive: false }});
	let globalTradeItems = response.data;
	
	let globalTradeItem;
	if (globalTradeItems.length == 0) {
		
		// Lookup product
	
		response = await ims.get('products', { params: { productNumberMatch: economicProduct.productNumber }});
		let products = response.data;
		
		let product;
		if (products.length == 0) {
			product = new Object();
			product.productNumber = economicProduct.productNumber;
			product.productName = economicProduct.name;
			product.productGroupId = productGroup.id;
			response = await ims.post('products', product);
			product = response.data;
		} else {
			product = products[0];
		}
	
		globalTradeItem = new Object();
		globalTradeItem.productId = product.id;
		globalTradeItem.stockKeepingUnit = economicProduct.productNumber;
		globalTradeItem.globalTradeItemNumber = economicProduct.barCode != null ? economicProduct.barCode : '++';
		globalTradeItem.dataDocument = JSON.stringify({ "EconomicIntegration": { "recommendedPrice": economicProduct.recommendedPrice, "salesPrice": economicProduct.salesPrice } });
		response = await ims.post('globalTradeItems', globalTradeItem, { validateStatus: function (status) {
				    return status >= 200 && status < 300 || status == 422; 
				}});
		if (response.status == 422) {
			let message =  response.data;
			await postEventMessage(ims, eventId, message.messageType, message.messageText);	
		} else {
			globalTradeItem = response.data;
		}
		
	} else {
		
		globalTradeItem = globalTradeItems[0];
		let dataDocument = globalTradeItem.dataDocument != null ? JSON.parse(globalTradeItem.dataDocument) : new Object();
		let prices = dataDocument.EconomicIntegration;
		let patch = new Object();
		if (prices == undefined || prices.recommendedPrice != economicProduct.recommendedPrice) {
			patch.recommendedPrice = economicProduct.recommendedPrice;
		}
		if (prices == undefined || prices.salesPrice != economicProduct.salesPrice) {
			patch.salesPrice = economicProduct.salesPrice;
		}
		if (patch.salesPrice != undefined || patch.recommendedPrice != undefined) {
			await ims.patch('globalTradeItems/' + globalTradeItem.id + '/dataDocument', { EconomicIntegration: patch });
		}
	}

	if (globalTradeItem.globalTradeItemNumber != null) {
		if (economicProduct.barCode == undefined || economicProduct.barCode == null) {
			economicProduct.barCode = globalTradeItem.globalTradeItemNumber;
			await economic.put('products/' + economicProduct.productNumber, economicProduct);
		}
	}
}

exports.pullAndPushProduct = async (event, x) => {
	
	console.log(JSON.stringify(event));
	
    let ims = await getIMS();
    
    let response = await ims.get('contexts/' + process.env.ContextId);
    let context = response.data;
    if (context.dataDocument != null) {
    	
        let dataDocument = JSON.parse(context.dataDocument);
        let setup = dataDocument.EconomicIntegration;
        if (setup != null) {
            
            let economic = await getEconomic(setup.accessToken);
        
        	response = await ims.get('productGroups');
			let productGroups = response.data;

			response = await economic.get('products/' + event.productNumber);
			let economicProduct = response.data;
			
			await pushProduct(ims, economic,'SINGLETON', productGroups, economicProduct);

        }
    }
};

exports.pushProducts = async (event, x) => {
	
	console.log(JSON.stringify(event));
	
    let ims = await getIMS();
    
    let response = await ims.get('contexts/' + process.env.ContextId);
    let context = response.data;
    if (context.dataDocument != null) {
    	
        let dataDocument = JSON.parse(context.dataDocument);
        let setup = dataDocument.EconomicIntegration;
        if (setup != null) {
            
            let economic = await getEconomic(setup.accessToken);
        
        	response = await ims.get('productGroups');
			let productGroups = response.data;

			for (let record of event.Records) {
				let products = JSON.parse(record.body);
				for (let economicProduct of products) {
					await pushProduct(ims, economic, record.attributes.MessageGroupId, productGroups, economicProduct);
				}	
			}
	
        }
    }
};

exports.pullProducts = async (event, x) => {
	
	console.log(JSON.stringify(event));
	
    let ims = await getIMS();
    
    let response = await ims.get('contexts/' + process.env.ContextId);
    let context = response.data;
    if (context.dataDocument != null) {
    	
        let dataDocument = JSON.parse(context.dataDocument);
        let setup = dataDocument.EconomicIntegration;
        if (setup != null) {
            
            let economic = await getEconomic(setup.accessToken);
            
			let sqs = new AWS.SQS();
			
			for (let record of event.Records) {
				
				let request = JSON.parse(record.body);
				let requestId = request.requestContext.requestId;
	
				response = await economic.get('products', { params: { pagesize: 100 }});
				let page = response.data;
				let i = 0;
				let done = false;
				while (!done) {
					let products = page.collection;
			        let params = {
			            MessageBody: JSON.stringify(products),
			            MessageDeduplicationId: requestId + '-' + i,
			            MessageGroupId: requestId,
			            QueueUrl: process.env.ProductQueue
			        };
			
			        await sqs.sendMessage(params).promise();
			        
			        if (page.pagination.nextPage != null) {
						response = await economic.get(page.pagination.nextPage, { baseUrl: "" });
						page = response.data;
						i++;
			        } else {
			        	done = true;
			        }
				}
				
			}	
			
        }
    }
};

exports.dispatch = async (event, x) => {
	
	console.log(JSON.stringify(event));
	
	let params = {
            MessageBody: JSON.stringify(event),
            MessageDeduplicationId: event.requestContext.requestId,
            MessageGroupId: 'SINGLETON',
            QueueUrl: process.env.SyncProductsRequestQueue
        };

	let sqs = new AWS.SQS();

    await sqs.sendMessage(params).promise();

	let output = new Object();
    output.body = '<html><p>Synchronization of products has started. It might take up to 15 minutes to complete. Your request id is ' + event.requestContext.requestId + '</p></html>';
    output.statusCode = 200;
    output.headers = new Object();
    output.headers['Content-Type'] = 'text/html';
	return output;

};

exports.pullOrders = async (event, x) => {
    
	console.log(JSON.stringify(event));

    let ims = await getIMS();
    
    let response = await ims.get('contexts/' + process.env.ContextId);
    let context = response.data;
    if (context.dataDocument != null) {
    	
        let dataDocument = JSON.parse(context.dataDocument);
        let setup = dataDocument.EconomicIntegration;
        if (setup != null) {
            
            if (setup.autoCreateShipments) {
            	
	            let economic = await getEconomic(setup.accessToken);
	            
	            response = await economic.get('orders/sent', { params: { pagesize: 100 }});
	 			let page = response.data;
	 			
	            let done = false;
				while (!done) {
	
					let orders = page.collection;            
		            for (let order of orders) {
		            	
		            	response = await ims.get('shipments', { params: { shipmentNumberMatch: order.orderNumber }});
		            	let shipments = response.data;
		            	
		            	if (shipments.length == 0) {
		            		
		            		response = await economic.get('orders/sent/' + order.orderNumber);
		            		order = response.data;
		            		
		            		response = await ims.get('customers', { params: { customerNumberMatch: order.customer.customerNumber }});
		            		let customers = response.data;
		            		
	            			let address = new Object();
		            		let recipient = order.recipient;
		            		let customer;
		            		if (customers.length == 0) {
		            			customer = new Object();
		            			customer.customerNumber = order.customer.customerNumber;
		            			address.addressee = recipient.name;
		            			address.streetNameAndNumber = recipient.address;
		            			address.postalCode = recipient.zip;
		            			address.cityTownOrVillage = recipient.city;
		            			customer.address = address;
		            			customer.vatNumber = recipient.cvr;
		            			response = await ims.post('customers', customer);
		            			customer = response.data;
		            		} else {
		            			customer = customers[0];
		            		}
		            		
		            		let shipment = new Object();
		            		shipment.shipmentNumber = order.orderNumber;
		            		
		            		let delivery = order.delivery;
		            		if (delivery != null) {
		            			address.addressee = delivery.name;
		            			address.streetNameAndNumber = delivery.address;
		            			address.postalCode = delivery.zip;
		            			address.cityTownOrVillage = delivery.city;
		            		}
	            			shipment.deliveryAddress = address;
	            			
		            		let shipmentLines = [];
		            		for (let orderLine of order.lines) {
		            			let shipmentLine = new Object();
		            			shipmentLine.stockKeepingUnit = orderLine.product.productNumber;
		            			shipmentLine.shipmentNumber = shipment.shipmentNumber;
		            			shipmentLine.numItemsOrdered = orderLine.quantity;
		            			shipmentLine.salesPrice = orderLine.unitNetPrice;
		            			shipmentLines.push(shipmentLine);
		            		}
		            		shipment.shipmentLines = shipmentLines;
		            		
		            		shipment.customerId = customer.id;
		            		
		            		response = await ims.post('shipments', shipment, { validateStatus: function (status) {
								    return status >= 200 && status < 300 || status == 422; 
								}});
								
		        			if (response.status == 422) {
		        				let message = response.data;
		        				let text = 'Unable to create shipment from order ' + order.orderNumber + '. Reason: ' + message.messageText;
		        				await postEventMessage(ims, event.id, message.messageType, text);
		        			}
		        			    		
		            	}
		            }	
		            
					
					if (page.pagination.nextPage != null) {
		        		response = await economic.get(page.pagination.nextPage, { baseUrl: "" });
						page = response.data;
					} else {
						done = true;
					}
				
				}
				
            }
			
        }
    }
};
